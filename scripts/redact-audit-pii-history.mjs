#!/usr/bin/env node
/**
 * scripts/redact-audit-pii-history.mjs
 * Task D1 (keputusan owner 2026-11-19): meredaksi PII pada SELURUH baris
 * `audit_logs` historis (bukan sampel) memakai semantik yang sama dengan
 * sanitizer kanonis `src/services/audit-payload-sanitizer.ts`, ditambah
 * perluasan field yang disepakati (ipAddress, lat/lng, email, notes, dst).
 *
 * Prinsip:
 * - Dry-run default. `--apply` WAJIB disertai `--backup-ref` (bukti backup).
 * - Idempoten: menjalankan ulang tidak mengubah baris yang sudah bersih.
 * - Data komersial (`value`, `purchaseValue`, `discountAmount`, `event_id`,
 *   `currency`, `fbtrace_id`, `status`, dst.) TIDAK disentuh.
 * - Tidak mencetak nilai PII; ringkasan hanya berisi jumlah per kategori.
 *
 * Penggunaan:
 *   node scripts/redact-audit-pii-history.mjs
 *   node scripts/redact-audit-pii-history.mjs --apply --backup-ref=pre_pii_20261119_193556.dump
 *   node scripts/redact-audit-pii-history.mjs --apply --backup-ref=... --limit=500
 */
import { PrismaClient } from '@prisma/client';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const REDACTED = '[REDACTED]';

const PHONE_KEYS = new Set([
  'phone',
  'targetphone',
  'phonenumber',
  'phone_number',
  'customerphone',
  'senderphone',
  'recipientphone',
  'wa_phone',
]);

const NAME_KEYS = new Set([
  'name',
  'customername',
  'patientname',
  'childname',
  'babyname',
  'oldname',
  'newname',
  'sendername',
  'contactname',
  'displayname',
]);

/**
 * Identitas staf internal (bukan pelanggan). SENGAJA tidak disamarkan agar
 * jejak audit "siapa melakukan apa" tetap dapat dipertanggungjawabkan.
 * Pelanggan tetap terlindungi lewat `name`/`customerName`/`phone`/`address`.
 */
const STAFF_IDENTITY_KEYS = new Set(['adminname', 'staffname']);

const ADDRESS_KEYS = new Set([
  'address',
  'customeraddress',
  'alamat',
  'address_text',
  'street',
  'streetdetail',
  'locationtext',
  'landmark',
]);

const FREETEXT_KEYS = new Set([
  'notes',
  'textpreview',
  'rawtext',
  'raw_text',
  'prompt',
  'rawprompt',
  'wahapayload',
  'rawpayload',
  'text',
  'customtext',
  'newcontent',
  'content',
  'message',
  'customermessage',
  'reference',
  'idealresponse',
]);

const SECRET_KEYS = new Set([
  'apikey',
  'api_key',
  'admin_key',
  'secret',
  'token',
  'accesstoken',
  'access_token',
  'telegrambottoken',
  'telegram_bot_token',
  'capi_token',
  'capiToken'.toLowerCase(),
  'password',
]);

const EMAIL_KEYS = new Set(['email', 'customeremail', 'emailaddress', 'email_address']);

const IP_KEYS = new Set(['ipaddress', 'ip_address', 'ip', 'clientipaddress', 'remoteaddress']);

const GEO_KEYS = new Set([
  'lat',
  'lng',
  'latitude',
  'longitude',
  'primarylat',
  'primarylng',
  'submittedlat',
  'submittedlng',
  'degreeslatitude',
  'degreeslongitude',
]);

/**
 * Kunci komersial/teknis yang TIDAK boleh diubah oleh phone-in-text masking
 * agar nominal & ID transaksi tetap utuh untuk rekonsiliasi.
 */
const COMMERCIAL_KEYS = new Set([
  'value',
  'amount',
  'purchasevalue',
  'discountamount',
  'discount',
  'gross',
  'net',
  'grosstreatmentvalue',
  'puretreatmentvalue',
  'deliveryfee',
  'ongkir',
  'receiptamount',
  'expectedtotal',
  'totalfee',
  'totalexpected',
  'totalpaid',
  'sumval',
  'difference',
  'billingtotal',
  'originalprice',
  'promoprice',
  'event_id',
  'fbtrace_id',
  'bookingdate',
  'purchase_occurred_at',
  'mql_triggered_at',
  'created_at',
  'updated_at',
]);

/** Masking nomor telepon setara `maskPhoneWithTenantSuffix` (4 + **** + 4). */
export function maskPhone(value) {
  if (value === null || value === undefined) return value;
  const raw = typeof value === 'number' ? String(value) : value;
  if (typeof raw !== 'string') return value;
  const trimmed = raw.trim();
  if (!trimmed) return '(no-phone)';
  if (trimmed.includes(':')) {
    const [head, ...rest] = trimmed.split(':');
    return `${maskPhone(head)}:${rest.join(':')}`;
  }
  if (trimmed.length <= 4) return '****';
  if (trimmed.length < 8) return `${trimmed.slice(0, 2)}****${trimmed.slice(-2)}`;
  return `${trimmed.slice(0, 4)}****${trimmed.slice(-4)}`;
}

/** Buang lone surrogate (sisa pemotongan emoji) agar payload tetap valid untuk jsonb PostgreSQL. */
export function stripLoneSurrogates(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
}

/** Masking nama setara `maskName` (inisial + bintang + huruf akhir), idempoten & aman emoji. */
export function maskName(value) {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'string') return value;
  if (!value.trim()) return '(no-name)';
  const masked = value
    .trim()
    .split(/\s+/)
    .map((word) => {
      // Sudah tersamar penuh (artefak masking sebelumnya) → biarkan agar idempoten.
      if (/^\*+$/.test(word)) return word;
      const chars = Array.from(word);
      if (chars.length <= 2) return chars[0] + '*';
      return chars[0] + '*'.repeat(Math.max(1, chars.length - 2)) + chars[chars.length - 1];
    })
    .join(' ');
  return stripLoneSurrogates(masked);
}

function maskIp(value) {
  if (typeof value !== 'string') return value;
  if (value.endsWith('.*.*')) return value;
  const ipv4 = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return value ? REDACTED : value;
  return `${ipv4[1]}.${ipv4[2]}.*.*`;
}

function roundGeo(value) {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return value;
  return Math.round(num * 100) / 100;
}

/** Maskir nomor HP Indonesia di dalam teks bebas / ID pesan. */
export function maskPhonesInText(text) {
  if (typeof text !== 'string' || !text) return text;

  const maskSegment = (segment) => {
    let prefixLiteral = '';
    let numericPart = segment;
    const waPrefix = segment.match(/^wa\.me\//i);
    if (waPrefix) {
      prefixLiteral = waPrefix[0];
      numericPart = segment.slice(prefixLiteral.length);
    }
    let domain = '';
    const atIdx = numericPart.indexOf('@');
    if (atIdx !== -1) {
      domain = numericPart.slice(atIdx);
      numericPart = numericPart.slice(0, atIdx);
    }
    numericPart = numericPart.replace(/^\/+/, '');
    const digitsOnly = numericPart.replace(/\D/g, '');
    if (digitsOnly.length < 10 || digitsOnly.length > 15) return segment;
    if (digitsOnly.startsWith('0')) {
      if (digitsOnly[1] !== '8') return segment;
    } else if (digitsOnly.startsWith('62')) {
      if (digitsOnly[2] !== '8') return segment;
    } else {
      return segment;
    }
    const keepDigits = digitsOnly.length - 5;
    let digitCount = 0;
    let prefixStr = '';
    let plusIncluded = false;
    for (const ch of numericPart) {
      if (ch === '+' && digitCount === 0 && !plusIncluded) {
        if (digitCount < keepDigits || keepDigits === 0) {
          prefixStr += ch;
          plusIncluded = true;
        }
        continue;
      }
      if (/\d/.test(ch)) {
        digitCount += 1;
        if (digitCount <= keepDigits) prefixStr += ch;
        else break;
      } else if (digitCount < keepDigits) {
        prefixStr += ch;
      }
    }
    if (numericPart.trim().startsWith('+') && !prefixStr.startsWith('+')) {
      prefixStr = `+${prefixStr}`;
    }
    return `${prefixLiteral}${prefixStr}*****${domain}`;
  };

  let out = text;
  out = out.replace(/\+?\d[\d\s\-\.\(\)]*\d@(?:c\.us|s\.whatsapp\.net|lid)/gi, (m) => maskSegment(m));
  out = out.replace(/(?:https?:\/\/)?wa\.me\/\+?[\d\s\-\.\(\)]{7,}\d/gi, (m) => {
    const schemeMatch = m.match(/^(https?:\/\/)/i);
    const scheme = schemeMatch ? schemeMatch[1] : '';
    return scheme + maskSegment(scheme ? m.slice(scheme.length) : m);
  });
  out = out.replace(/(?:\+62|62|0)[\d\s\-\.\(\)]{7,}\d/g, (m) => {
    const digits = m.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 15) return m;
    if (digits.startsWith('0') && digits[1] !== '8') return m;
    if (digits.startsWith('62') && digits[2] !== '8') return m;
    if (!digits.startsWith('0') && !digits.startsWith('62')) return m;
    return maskSegment(m);
  });
  return out;
}

function redactNode(node, stats, depth = 0) {
  if (node === null || node === undefined) return node;
  if (depth > 12) return REDACTED;
  if (typeof node === 'string') return stripLoneSurrogates(node);

  if (Array.isArray(node)) {
    return node.map((item) => redactNode(item, stats, depth + 1));
  }

  if (typeof node !== 'object') return node;

  const out = {};
  for (const [key, value] of Object.entries(node)) {
    const lower = key.toLowerCase();

    if (PHONE_KEYS.has(lower)) {
      if (typeof value === 'string' || typeof value === 'number') {
        stats.phone += 1;
        out[key] = maskPhone(value);
      } else {
        out[key] = redactNode(value, stats, depth + 1);
      }
      continue;
    }

    if (STAFF_IDENTITY_KEYS.has(lower)) {
      out[key] = value;
      continue;
    }

    if (NAME_KEYS.has(lower)) {
      if (typeof value === 'string') {
        stats.name += 1;
        out[key] = maskName(value);
      } else {
        out[key] = redactNode(value, stats, depth + 1);
      }
      continue;
    }

    if (ADDRESS_KEYS.has(lower) || FREETEXT_KEYS.has(lower)) {
      if (value === null || value === undefined || value === '') {
        out[key] = value;
      } else if (typeof value === 'string' || typeof value === 'number') {
        stats.text += 1;
        out[key] = REDACTED;
      } else {
        out[key] = redactNode(value, stats, depth + 1);
      }
      continue;
    }

    if (SECRET_KEYS.has(lower)) {
      if (value !== null && value !== undefined && value !== '') stats.secret += 1;
      out[key] = value ? REDACTED : value;
      continue;
    }

    if (EMAIL_KEYS.has(lower)) {
      if (value !== null && value !== undefined && value !== '') stats.email += 1;
      out[key] = value ? REDACTED : value;
      continue;
    }

    if (IP_KEYS.has(lower)) {
      if (typeof value === 'string' && value) stats.ip += 1;
      out[key] = maskIp(value);
      continue;
    }

    if (GEO_KEYS.has(lower)) {
      if (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) {
        out[key] = roundGeo(value);
      } else {
        out[key] = value;
      }
      continue;
    }

    if (typeof value === 'string' && value && !COMMERCIAL_KEYS.has(lower)) {
      const masked = stripLoneSurrogates(maskPhonesInText(value));
      if (masked !== value) stats.phoneInText += 1;
      out[key] = masked;
      continue;
    }

    out[key] = redactNode(value, stats, depth + 1);
  }
  return out;
}

/**
 * Redaksi satu payload audit. Menerima objek maupun string JSON.
 * Mengembalikan `{ value, changed, stats }`.
 */
export function redactAuditPayload(payload) {
  const stats = { phone: 0, phoneInText: 0, name: 0, text: 0, secret: 0, email: 0, ip: 0 };

  if (payload === null || payload === undefined) {
    return { value: payload, changed: false, stats };
  }

  if (typeof payload === 'string') {
    let parsed = null;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return { value: payload, changed: false, stats };
    }
    if (parsed === null || typeof parsed !== 'object') {
      return { value: payload, changed: false, stats };
    }
    const redacted = redactNode(parsed, stats);
    const next = JSON.stringify(redacted);
    return { value: next, changed: next !== payload, stats };
  }

  if (typeof payload !== 'object') return { value: payload, changed: false, stats };

  const redacted = redactNode(payload, stats);
  return {
    value: redacted,
    changed: JSON.stringify(redacted) !== JSON.stringify(payload),
    stats,
  };
}

function parseArgs(argv) {
  const apply = argv.includes('--apply');
  const limitArg = argv.find((a) => a.startsWith('--limit='));
  const backupArg = argv.find((a) => a.startsWith('--backup-ref='));
  return {
    apply,
    limit: limitArg ? Number(limitArg.split('=')[1]) : undefined,
    backupRef: backupArg ? backupArg.split('=')[1] : undefined,
  };
}

async function main() {
  const { apply, limit, backupRef } = parseArgs(process.argv);

  if (apply && !backupRef) {
    console.error('REFUSED: --apply wajib menyertakan --backup-ref=<nama file backup> sebagai bukti backup sudah dibuat.');
    process.exit(2);
  }

  const prisma = new PrismaClient();
  const summary = {
    timestamp: new Date().toISOString(),
    dryRun: !apply,
    backupRef: backupRef || null,
    limit: limit ?? null,
    scanned: 0,
    changed: 0,
    applied: 0,
    stats: { phone: 0, phoneInText: 0, name: 0, text: 0, secret: 0, email: 0, ip: 0 },
    dbAvailable: true,
  };

  try {
    const batchSize = 400;
    let skip = 0;
    let processed = 0;

    for (;;) {
      const remaining = limit ? Math.max(0, limit - processed) : batchSize;
      if (limit && remaining === 0) break;
      const take = Math.min(batchSize, remaining);

      const rows = await prisma.auditLog.findMany({
        orderBy: { created_at: 'asc' },
        skip,
        take,
        select: { id: true, payload: true },
      });
      if (!rows.length) break;

      const updates = [];
      for (const row of rows) {
        summary.scanned += 1;
        processed += 1;
        if (row.payload == null) continue;

        const result = redactAuditPayload(row.payload);
        for (const key of Object.keys(summary.stats)) {
          summary.stats[key] += result.stats[key] || 0;
        }
        if (!result.changed) continue;

        summary.changed += 1;
        updates.push(
          apply
            ? prisma.auditLog.update({ where: { id: row.id }, data: { payload: result.value } })
            : null
        );
      }

      if (apply && updates.length) {
        await prisma.$transaction(updates);
        summary.applied += updates.length;
      }

      skip += rows.length;
      console.log(`[progress] scanned=${summary.scanned} changed=${summary.changed} applied=${summary.applied}`);
    }
  } catch (err) {
    summary.dbAvailable = false;
    summary.error = err.message;
  } finally {
    await prisma.$disconnect().catch(() => {});
  }

  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.dbAvailable ? 0 : 1);
}

const invokedDirectly =
  process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main().catch((err) => {
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
  });
}
