import { prisma } from '../../db/client';
import { formatReservationToRow } from './row-formatter';
import { resolveSheetTarget } from './month-resolver';
import {
  SheetsGateway,
  googleSheetsGateway,
  SHEETS_NOT_CONNECTED,
  TEMPLATE_SHEET_NOT_FOUND,
} from './sheets-client';

/**
 * sheets-sync.service.ts — orkestrasi sinkronisasi reservasi → Google Sheets.
 *
 * Alur fondasional:
 *   webhook chat → `enqueue()` (hanya tulis 1 baris outbox, non-blocking)
 *   cron worker  → `processOutbox()` → `syncReservation()` → Google API.
 *
 * Jaminan:
 * - Idempotensi: outbox unique per (tenant, reservation). Baris yang sudah pernah
 *   ditulis di-update lewat `sheets_row_index`, bukan ditambah lagi.
 * - Harga write-once: saat update, kolom H/I/J/K (ongkir, total, diskon, harga
 *   akhir) DILEWATI agar koreksi manual admin di spreadsheet tidak tertimpa.
 * - Graceful degradation: Google/DB offline → status retry/backoff; chat tetap jalan.
 *
 * Dua seam untuk uji offline:
 * - `SheetsGateway` (default menembak Google; test inject fake).
 * - `SheetsSyncStore` (default Prisma; test inject in-memory).
 */

// --- Tipe baris config & reservasi (bentuk minimal, bukan full Prisma) ---
export interface SheetsConfigRow {
  tenant_id: string;
  is_enabled: boolean;
  file_base_name: string;
  master_spreadsheet_id: string | null;
  yearly_file_ids: Record<string, string> | null;
  month_tab_names: string[];
  template_sheet_name: string;
}

export interface ReservationForSheets {
  id: string;
  tenant_id: string;
  booking_date: Date | null;
  treatment_detail: string | null;
  treatment_category: string | null;
  purchase_value: number | null;
  delivery_fee: number | null;
  discount_amount: number | null;
  payment_method: string | null;
  is_repeat_order: boolean;
  status: string;
  raw_text: string | null;
  sheets_spreadsheet_id: string | null;
  sheets_tab_name: string | null;
  sheets_row_index: number | null;
  customer: {
    name: string | null;
    kelurahan: string | null;
    kecamatan: string | null;
    kota: string | null;
    ongkir: number | null;
  } | null;
  children: Array<{ name: string | null; raw_age_text: string | null; age_months_at_registration: number | null }>;
  assigned_staff: { name: string | null } | null;
}

export interface OutboxRow {
  id: string;
  tenant_id: string;
  reservation_id: string;
  attempts: number;
}

export interface SheetsSyncStore {
  getConfig(tenantId: string): Promise<SheetsConfigRow | null>;
  getReservation(reservationId: string, tenantId: string): Promise<ReservationForSheets | null>;
  saveRowRef(
    reservationId: string,
    tenantId: string,
    ref: { spreadsheetId: string; tabName: string; rowIndex: number }
  ): Promise<void>;
  upsertOutbox(tenantId: string, reservationId: string): Promise<void>;
  listPending(tenantId: string, now: Date, limit: number): Promise<OutboxRow[]>;
  markDone(id: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
  reschedule(id: string, nextRetryAt: Date, error: string): Promise<void>;
  incrementAttempt(id: string, nextRetryAt: Date, error: string): Promise<void>;
}

export const SHEETS_CONFIG_DISABLED = 'SHEETS_CONFIG_DISABLED';
export const SHEETS_YEAR_NOT_CONFIGURED = 'SHEETS_YEAR_NOT_CONFIGURED';

/** Hasil siklus pemrosesan outbox (untuk observability/log). */
export interface ProcessOutboxResult {
  processed: number;
  succeeded: number;
  deferred: number;
  failed: number;
}

const MAX_ATTEMPTS = 10;
/** Backoff (menit) per percobaan: 1, 5, 15, lalu 60. */
function backoffMinutes(attempts: number): number {
  if (attempts <= 1) return 1;
  if (attempts === 2) return 5;
  if (attempts === 3) return 15;
  return 60;
}

/** Error yang menandakan "belum siap, coba lagi nanti" (tidak menghabiskan attempts). */
function isNotReadyError(err: unknown): boolean {
  const msg = (err as Error)?.message || '';
  return (
    msg === SHEETS_NOT_CONNECTED ||
    msg === SHEETS_CONFIG_DISABLED ||
    msg === 'INVALID_BOOKING_DATE' ||
    msg === SHEETS_YEAR_NOT_CONFIGURED
  );
}

export class SheetsSyncService {
  private gateway: SheetsGateway = googleSheetsGateway;
  private store: SheetsSyncStore = new PrismaSheetsSyncStore();

  /** Injeksi seam untuk pengujian (gateway Google & store DB). */
  public setGateway(gateway: SheetsGateway): void {
    this.gateway = gateway;
  }
  public setStore(store: SheetsSyncStore): void {
    this.store = store;
  }

  /**
   * Tandai reservasi perlu disinkronkan. Dipanggil dari hook lifecycle (setelah
   * commit) dan dari update admin. Best-effort: tidak pernah throw ke pemanggil.
   */
  public async enqueue(reservationId: string, tenantId: string): Promise<void> {
    if (!reservationId || !tenantId) return;
    try {
      const config = await this.store.getConfig(tenantId);
      if (!config || !config.is_enabled) return; // hemat: tak menumpuk saat nonaktif
      await this.store.upsertOutbox(tenantId, reservationId);
    } catch (err: any) {
      console.warn('[SHEETS] enqueue gagal (best-effort):', err?.message);
    }
  }

  /**
   * Proses antrean outbox tenant. Dipanggil worker cron. Best-effort per item.
   */
  public async processOutbox(tenantId: string, limit = 10): Promise<ProcessOutboxResult> {
    const result: ProcessOutboxResult = { processed: 0, succeeded: 0, deferred: 0, failed: 0 };
    let pending: OutboxRow[] = [];
    try {
      pending = await this.store.listPending(tenantId, new Date(), limit);
    } catch (err: any) {
      console.warn('[SHEETS] listPending gagal:', err?.message);
      return result;
    }

    for (const item of pending) {
      result.processed++;
      try {
        await this.syncReservation(item.reservation_id, tenantId);
        await this.store.markDone(item.id);
        result.succeeded++;
      } catch (err: any) {
        const message = err?.message || String(err);
        const attempts = item.attempts + 1;
        if (isNotReadyError(err)) {
          // Belum siap (belum connect / tanggal kosong / tahun belum dipetakan):
          // tunda lama tanpa menghabiskan kuota percobaan.
          await this.store.reschedule(item.id, new Date(Date.now() + 15 * 60 * 1000), message);
          result.deferred++;
        } else if (attempts >= MAX_ATTEMPTS) {
          await this.store.markFailed(item.id, message);
          result.failed++;
        } else {
          await this.store.incrementAttempt(item.id, new Date(Date.now() + backoffMinutes(attempts) * 60 * 1000), message);
          result.failed++;
        }
        console.warn(`[SHEETS] sync ${item.reservation_id} gagal (attempt ${attempts}):`, message);
      }
    }
    return result;
  }

  /**
   * Sinkronkan satu reservasi (append baris pertama atau update baris yang ada).
   * @throws saat belum siap (config nonaktif / belum connect / tanggal kosong).
   */
  public async syncReservation(reservationId: string, tenantId: string): Promise<void> {
    const config = await this.store.getConfig(tenantId);
    if (!config || !config.is_enabled) throw new Error(SHEETS_CONFIG_DISABLED);

    const reservation = await this.store.getReservation(reservationId, tenantId);
    if (!reservation) throw new Error('RESERVATION_NOT_FOUND');

    const target = resolveSheetTarget(reservation.booking_date, config.month_tab_names); // throw INVALID_BOOKING_DATE
    const spreadsheetId = this.resolveSpreadsheetId(config, target.year);

    const tab = await this.gateway.ensureMonthlyTab({
      tenantId,
      spreadsheetId,
      tabName: target.tabName,
      templateSheetName: config.template_sheet_name,
    });

    const child = reservation.children && reservation.children[0] ? reservation.children[0] : null;
    const row = formatReservationToRow({
      reservation,
      customer: reservation.customer,
      child,
      assignedStaffName: reservation.assigned_staff?.name ?? null,
      monthTabNames: config.month_tab_names,
    });

    const existingRow = reservation.sheets_row_index;
    const samePlace =
      existingRow != null &&
      reservation.sheets_tab_name === tab.tabName &&
      reservation.sheets_spreadsheet_id === spreadsheetId;

    if (samePlace && existingRow != null && existingRow >= 2) {
      // Update: TULIS ULANG semua kolom KECUALI H/I/J/K (ongkir/harga) agar
      // koreksi manual admin pada harga tidak tertimpa (write-once harga).
      const PROTECTED = new Set([7, 8, 9, 10]); // 0-based: H,Ongkir..K,Harga akhir
      const cells = row
        .map((value, idx) => ({ col: idx + 1, value }))
        .filter((c) => !PROTECTED.has(c.col - 1));
      await this.gateway.updateCells({
        tenantId,
        spreadsheetId,
        tabName: tab.tabName,
        rowIndex: existingRow,
        cells,
      });
      await this.store.saveRowRef(reservationId, tenantId, {
        spreadsheetId,
        tabName: tab.tabName,
        rowIndex: existingRow,
      });
      return;
    }

    const appended = await this.gateway.appendRow({ tenantId, spreadsheetId, tabName: tab.tabName, row });
    await this.store.saveRowRef(reservationId, tenantId, {
      spreadsheetId,
      tabName: tab.tabName,
      rowIndex: appended.rowIndex,
    });
  }

  /** Resolusi ID file untuk tahun target (peta tahun dari DB, bukan tebakan). */
  private resolveSpreadsheetId(config: SheetsConfigRow, year: number): string {
    const map = config.yearly_file_ids || {};
    const id = map[String(year)];
    if (id) return id;
    // Tanpa peta tahun: hanya boleh pakai master bila kosong (fallback aman).
    // Untuk tahun yang belum dipetakan, JANGAN tulis ke file tahun lain.
    throw new Error(SHEETS_YEAR_NOT_CONFIGURED);
  }

  /**
   * Baca konfigurasi untuk UI (aman: token/kredensial Google tidak pernah ikut).
   * DB offline → null (UI menampilkan status tidak tersedia).
   */
  public async getPublicConfig(tenantId: string): Promise<SheetsConfigRow | null> {
    try {
      return await this.store.getConfig(tenantId);
    } catch (err: any) {
      console.warn('[SHEETS] getPublicConfig gagal:', err?.message);
      return null;
    }
  }

  /**
   * Perbarui konfigurasi dari admin (partial). Hanya field yang diizinkan.
   * DB offline → throw (UI menampilkan pesan jujur, bukan diam-diam sukses).
   */
  public async updateConfig(
    tenantId: string,
    patch: {
      is_enabled?: boolean;
      file_base_name?: string;
      master_spreadsheet_id?: string | null;
      template_sheet_name?: string;
      month_tab_names?: string[];
      yearly_file_ids?: Record<string, string>;
    }
  ): Promise<void> {
    const data: any = {};
    if (patch.is_enabled !== undefined) data.is_enabled = patch.is_enabled;
    if (patch.file_base_name !== undefined) data.file_base_name = patch.file_base_name.trim() || 'Rekapan Pasien';
    if (patch.master_spreadsheet_id !== undefined) data.master_spreadsheet_id = patch.master_spreadsheet_id || null;
    if (patch.template_sheet_name !== undefined) data.template_sheet_name = patch.template_sheet_name.trim() || '_TEMPLATE';
    if (Array.isArray(patch.month_tab_names) && patch.month_tab_names.length === 12) {
      data.month_tab_names = patch.month_tab_names.map((s) => String(s).trim());
    }
    if (patch.yearly_file_ids && typeof patch.yearly_file_ids === 'object') {
      data.yearly_file_ids = patch.yearly_file_ids;
    }
    const existing = await prisma.tenantSheetsConfig.findUnique({ where: { tenant_id: tenantId } });
    if (!existing) {
      await prisma.tenantSheetsConfig.create({ data: { tenant_id: tenantId, ...data } });
    } else {
      await prisma.tenantSheetsConfig.update({ where: { tenant_id: tenantId }, data });
    }
  }

  /**
   * Uji koneksi tulis: pastikan tab bulan berjalan ada (duplikat template bila
   * perlu). TIDAK menulis baris data — hanya memverifikasi izin & template.
   * @throws SHEETS_NOT_CONNECTED / TEMPLATE_SHEET_NOT_FOUND / SHEETS_YEAR_NOT_CONFIGURED
   */
  public async testConnection(tenantId: string): Promise<{ year: number; tabName: string; created: boolean }> {
    const config = await this.store.getConfig(tenantId);
    if (!config) throw new Error(SHEETS_CONFIG_DISABLED);
    const target = resolveSheetTarget(new Date(), config.month_tab_names);
    const spreadsheetId = this.resolveSpreadsheetId(config, target.year);
    const result = await this.gateway.ensureMonthlyTab({
      tenantId,
      spreadsheetId,
      tabName: target.tabName,
      templateSheetName: config.template_sheet_name,
    });
    return { year: target.year, tabName: result.tabName, created: result.created };
  }
}

/**
 * Implementasi store default (Prisma). Semua akses DB dibungkus sehingga DB
 * offline tidak menjatuhkan pemanggil; error dipropagasi agar outbox menghitung
 * percobaan dengan benar.
 */
export class PrismaSheetsSyncStore implements SheetsSyncStore {
  async getConfig(tenantId: string): Promise<SheetsConfigRow | null> {
    const cfg = await prisma.tenantSheetsConfig.findUnique({ where: { tenant_id: tenantId } });
    if (!cfg) return null;
    return {
      tenant_id: cfg.tenant_id,
      is_enabled: cfg.is_enabled,
      file_base_name: cfg.file_base_name,
      master_spreadsheet_id: cfg.master_spreadsheet_id,
      yearly_file_ids: (cfg.yearly_file_ids as Record<string, string> | null) ?? null,
      month_tab_names: cfg.month_tab_names || [],
      template_sheet_name: cfg.template_sheet_name,
    };
  }

  async getReservation(reservationId: string, tenantId: string): Promise<ReservationForSheets | null> {
    const r: any = await prisma.reservation.findFirst({
      where: { id: reservationId, tenant_id: tenantId },
      include: {
        customer: {
          select: { name: true, kelurahan: true, kecamatan: true, kota: true, ongkir: true },
        },
        children: {
          select: { name: true, raw_age_text: true, age_months_at_registration: true },
        },
        assigned_staff: { select: { name: true } },
      },
    });
    if (!r) return null;
    return r as ReservationForSheets;
  }

  async saveRowRef(
    reservationId: string,
    tenantId: string,
    ref: { spreadsheetId: string; tabName: string; rowIndex: number }
  ): Promise<void> {
    await prisma.reservation.update({
      where: { id: reservationId },
      data: {
        sheets_spreadsheet_id: ref.spreadsheetId,
        sheets_tab_name: ref.tabName,
        sheets_row_index: ref.rowIndex,
        sheets_synced_at: new Date(),
        sheets_sync_status: 'done',
      },
    });
  }

  async upsertOutbox(tenantId: string, reservationId: string): Promise<void> {
    // Jangan reset bila sedang diproses worker (hindari tulis ganda); selain itu
    // reset ke pending agar update admin memicu sinkron ulang.
    const existing = await prisma.sheetsSyncOutbox.findUnique({
      where: { tenant_id_reservation_id: { tenant_id: tenantId, reservation_id: reservationId } },
    });
    if (existing) {
      if (existing.status !== 'processing') {
        await prisma.sheetsSyncOutbox.update({
          where: { id: existing.id },
          data: { status: 'pending', next_retry_at: null },
        });
      }
      return;
    }
    await prisma.sheetsSyncOutbox.create({
      data: { tenant_id: tenantId, reservation_id: reservationId, status: 'pending' },
    });
  }

  async listPending(tenantId: string, now: Date, limit: number): Promise<OutboxRow[]> {
    const rows = await prisma.sheetsSyncOutbox.findMany({
      where: {
        tenant_id: tenantId,
        OR: [{ status: 'pending' }, { status: 'processing' }],
        AND: [{ OR: [{ next_retry_at: null }, { next_retry_at: { lte: now } }] }],
      },
      orderBy: { created_at: 'asc' },
      take: limit,
      select: { id: true, tenant_id: true, reservation_id: true, attempts: true },
    });
    return rows;
  }

  async markDone(id: string): Promise<void> {
    await prisma.sheetsSyncOutbox.update({ where: { id }, data: { status: 'done' } });
  }

  async markFailed(id: string, error: string): Promise<void> {
    await prisma.sheetsSyncOutbox.update({
      where: { id },
      data: { status: 'failed', last_error: error.slice(0, 500) },
    });
  }

  async reschedule(id: string, nextRetryAt: Date, error: string): Promise<void> {
    await prisma.sheetsSyncOutbox.update({
      where: { id },
      data: { status: 'pending', next_retry_at: nextRetryAt, last_error: error.slice(0, 500) },
    });
  }

  async incrementAttempt(id: string, nextRetryAt: Date, error: string): Promise<void> {
    await prisma.sheetsSyncOutbox.update({
      where: { id },
      data: {
        status: 'pending',
        next_retry_at: nextRetryAt,
        last_error: error.slice(0, 500),
        attempts: { increment: 1 },
      },
    });
  }
}

export const sheetsSyncService = new SheetsSyncService();
