/**
 * scripts/verify-scorecard-period.ts
 * F8 gate: bandingkan angka raport (jalur API/service) dengan hitungan SQL mentah
 * untuk satu periode, read-only. Dipakai di server setelah migrasi diterapkan:
 *
 *   npm run verify:scorecard -- --year=2026 --month=11
 *   npm run verify:scorecard -- --year=2026 --month=11 --json
 *
 * Keluar dengan kode 1 bila ada selisih. Script ini TIDAK menulis apa pun.
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import {
  resolveScorecardPeriod,
  StaffScorecardService,
  type StaffScorecardItem,
} from '../src/services/staff-scorecard.service';
import { DEFAULT_TENANT_ID } from '../src/config/tenant';

export interface RawStaffCounts {
  staffId: string;
  totalVisits: number;
  onTime: number;
  lateMeasured: number;
  chatLate: number;
  unknown: number;
}

export interface ScorecardMismatch {
  staffId: string;
  field: string;
  api: number;
  raw: number;
}

export interface ScorecardComparison {
  ok: boolean;
  mismatches: ScorecardMismatch[];
  checkedStaff: number;
}

const FIELDS: Array<{ field: keyof RawStaffCounts; api: (item: StaffScorecardItem) => number }> = [
  { field: 'totalVisits', api: (item) => item.punctuality.total },
  { field: 'onTime', api: (item) => item.punctuality.onTime },
  { field: 'lateMeasured', api: (item) => item.punctuality.lateMeasured },
  { field: 'chatLate', api: (item) => item.punctuality.chatLate },
  { field: 'unknown', api: (item) => item.punctuality.unknown },
];

/**
 * Bandingkan item hasil service dengan hitungan SQL. Juga memeriksa invarian
 * internal yang tidak boleh dilanggar oleh kombinasi bukti apa pun.
 */
export function compareScorecardPeriod(
  apiItems: StaffScorecardItem[],
  rawCounts: RawStaffCounts[]
): ScorecardComparison {
  const rawById = new Map(rawCounts.map((row) => [row.staffId, row]));
  const mismatches: ScorecardMismatch[] = [];

  for (const item of apiItems) {
    // Bidan tanpa kunjungan tidak punya baris GROUP BY di SQL. Itu bukan
    // selisih: bandingkan dengan nol. Bila API mengklaim ada kunjungan,
    // field totalVisits akan tetap memicu mismatch.
    const raw = rawById.get(item.staffId) ?? {
      staffId: item.staffId,
      totalVisits: 0,
      onTime: 0,
      lateMeasured: 0,
      chatLate: 0,
      unknown: 0,
    };

    for (const { field, api } of FIELDS) {
      const apiValue = api(item);
      const rawValue = Number(raw[field] ?? 0);
      if (apiValue !== rawValue) {
        mismatches.push({ staffId: item.staffId, field: String(field), api: apiValue, raw: rawValue });
      }
    }

    const { onTime, lateMeasured, chatLate, unknown, assessed, total } = item.punctuality;
    if (assessed !== onTime + lateMeasured + chatLate) {
      mismatches.push({
        staffId: item.staffId,
        field: 'assessed != onTime+lateMeasured+chatLate',
        api: assessed,
        raw: onTime + lateMeasured + chatLate,
      });
    }
    if (total !== assessed + unknown) {
      mismatches.push({
        staffId: item.staffId,
        field: 'total != assessed+unknown',
        api: total,
        raw: assessed + unknown,
      });
    }
    if (unknown < 0 || chatLate < 0) {
      mismatches.push({
        staffId: item.staffId,
        field: 'negative_count',
        api: unknown,
        raw: chatLate,
      });
    }
  }

  return { ok: mismatches.length === 0, mismatches, checkedStaff: apiItems.length };
}

interface CliOptions {
  year: number;
  month: number;
  tenantId: string;
  json: boolean;
}

function parseArgs(argv: string[]): CliOptions | null {
  const wibKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  const [currentYear, currentMonth] = wibKey.split('-').map(Number);

  const get = (name: string): string | undefined => {
    const withEquals = argv.find((arg) => arg.startsWith(`--${name}=`));
    if (withEquals) return withEquals.slice(name.length + 3);
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? argv[index + 1] : undefined;
  };

  const year = Number(get('year') ?? currentYear);
  const month = Number(get('month') ?? currentMonth);
  if (!Number.isInteger(year) || year < 2020 || year > 2100) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;

  return {
    year,
    month,
    tenantId: get('tenant') || DEFAULT_TENANT_ID,
    json: argv.includes('--json'),
  };
}

async function loadRawCounts(
  prisma: any,
  params: {
    tenantId: string;
    from: Date;
    to: Date;
    staffIds: string[];
    toleranceMinutes: number;
    chatThresholdMinutes: number;
  }
): Promise<RawStaffCounts[]> {
  const { tenantId, from, to, staffIds, toleranceMinutes } = params;
  if (staffIds.length === 0) return [];

  const visitRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT r.assigned_staff_id AS staff_id,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (
              WHERE r.arrived_at IS NOT NULL
                AND EXTRACT(EPOCH FROM (r.arrived_at - r.booking_date)) / 60 <= $5
            )::int AS on_time,
            COUNT(*) FILTER (
              WHERE r.arrived_at IS NOT NULL
                AND EXTRACT(EPOCH FROM (r.arrived_at - r.booking_date)) / 60 > $5
            )::int AS late_measured,
            COUNT(*) FILTER (WHERE r.arrived_at IS NULL)::int AS unmeasured
       FROM reservations r
      WHERE r.tenant_id = $1
        AND r.status = 'completed'
        AND r.booking_date >= $2
        AND r.booking_date < $3
        AND r.assigned_staff_id = ANY($4::text[])
      GROUP BY r.assigned_staff_id`,
    tenantId,
    from,
    to,
    staffIds,
    toleranceMinutes
  );

  const chatRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT r.assigned_staff_id AS staff_id,
            COUNT(DISTINCT e.reservation_id)::int AS chat_late
       FROM visit_arrival_evidence e
       JOIN reservations r ON r.id = e.reservation_id
      WHERE e.tenant_id = $1
        AND e.source = 'CHAT'
        AND e.review_status = 'APPROVED'
        AND e.observed_minutes > $5
        AND r.arrived_at IS NULL
        AND r.status = 'completed'
        AND r.booking_date >= $2
        AND r.booking_date < $3
        AND r.assigned_staff_id = ANY($4::text[])
      GROUP BY r.assigned_staff_id`,
    tenantId,
    from,
    to,
    staffIds,
    params.chatThresholdMinutes
  );

  const chatByStaff = new Map<string, number>(
    chatRows.map((row) => [String(row.staff_id), Number(row.chat_late ?? 0)])
  );

  return visitRows.map((row) => {
    const total = Number(row.total ?? 0);
    const unmeasured = Number(row.unmeasured ?? 0);
    const chatLate = Math.min(unmeasured, chatByStaff.get(String(row.staff_id)) ?? 0);
    return {
      staffId: String(row.staff_id),
      totalVisits: total,
      onTime: Number(row.on_time ?? 0),
      lateMeasured: Number(row.late_measured ?? 0),
      chatLate,
      unknown: unmeasured - chatLate,
    };
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options) {
    console.error('Parameter tidak valid. Contoh: --year=2026 --month=11 [--tenant=default-tenant] [--json]');
    process.exit(2);
  }

  const { prisma } = await import('../src/db/client');
  const service = new StaffScorecardService();

  try {
    const period = resolveScorecardPeriod(options.year, options.month);
    // includeFrozen=false: verifikasi harus menguji hitungan live, bukan snapshot.
    const report = await service.getReport({
      tenantId: options.tenantId,
      year: options.year,
      month: options.month,
      includeFrozen: false,
    });

    const raw = await loadRawCounts(prisma, {
      tenantId: options.tenantId,
      from: period.from,
      to: period.to,
      staffIds: report.items.map((item) => item.staffId),
      toleranceMinutes: report.policy.tolerance_minutes,
      chatThresholdMinutes: report.policy.chat_evidence_minutes,
    });

    const comparison = compareScorecardPeriod(report.items, raw);

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            tenantId: options.tenantId,
            year: options.year,
            month: options.month,
            periodDays: period.periodDays,
            daysInMonth: period.daysInMonth,
            policy: {
              tolerance_minutes: report.policy.tolerance_minutes,
              chat_evidence_minutes: report.policy.chat_evidence_minutes,
            },
            items: report.items.map((item) => ({
              staffId: item.staffId,
              staffName: item.staffName,
              grade: item.grade,
              score: item.score,
              punctuality: item.punctuality,
              retention: item.retention,
              volume: item.volume,
              coveragePct: item.coveragePct,
              status: item.status,
            })),
            comparison,
          },
          null,
          2
        )
      );
    } else {
      console.log('========================================================');
      console.log(`  VERIFIKASI RAPORT BIDAN ${options.year}-${String(options.month).padStart(2, '0')}`);
      console.log('========================================================');
      console.log(`Tenant        : ${options.tenantId}`);
      console.log(`Hari berjalan : ${period.periodDays}/${period.daysInMonth}`);
      console.log(`Toleransi     : ${report.policy.tolerance_minutes} menit`);
      console.log(`Ambang chat   : ${report.policy.chat_evidence_minutes} menit`);
      console.log(`Bidan dinilai : ${report.items.length}`);
      console.log('');

      for (const item of report.items) {
        const row = raw.find((r) => r.staffId === item.staffId);
        console.log(`• ${item.staffName} — grade ${item.grade ?? '—'}, skor ${item.score ?? '—'}`);
        console.log(
          `  kunjungan ${item.punctuality.total} (SQL ${row?.totalVisits ?? 0}) · ` +
            `tepat ${item.punctuality.onTime} (${row?.onTime ?? 0}) · ` +
            `telat jam ${item.punctuality.lateMeasured} (${row?.lateMeasured ?? 0}) · ` +
            `telat chat ${item.punctuality.chatLate} (${row?.chatLate ?? 0}) · ` +
            `belum ${item.punctuality.unknown} (${row?.unknown ?? 0})`
        );
      }

      console.log('');
      if (comparison.ok) {
        console.log(`HASIL: PASS — ${comparison.checkedStaff} bidan, 0 selisih.`);
      } else {
        console.log(`HASIL: FAIL — ${comparison.mismatches.length} selisih:`);
        for (const mismatch of comparison.mismatches) {
          console.log(
            `  - ${mismatch.staffId} · ${mismatch.field}: API ${mismatch.api} vs SQL ${mismatch.raw}`
          );
        }
      }
      console.log('========================================================');
    }

    await prisma.$disconnect();
    process.exit(comparison.ok ? 0 : 1);
  } catch (error: any) {
    try {
      await prisma.$disconnect();
    } catch {
      // koneksi mungkin memang gagal; error asli yang dilaporkan.
    }
    console.error(`VERIFIKASI GAGAL: ${error?.message || error}`);
    process.exit(1);
  }
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  void main();
}
