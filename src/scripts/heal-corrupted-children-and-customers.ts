/**
 * heal-corrupted-children-and-customers.ts
 *
 * Skrip Pemulihan Data generik (Data Healing & Reconciliation) — FASE 4 (aman):
 * - TIDAK ada nama customer / nama anak hardcode di skrip ini. Seluruh target
 *   dibaca dari DB (`!isValidChildName`) + file pemetaan opsional `--map`.
 * - Koreksi nama yang benar (mis. nama asli anak) TIDAK ditebak skrip — wajib
 *   dipasok manusia via `--map=heal-map.json` berisi entri `{ childId, correctName }`
 *   atau `{ childId, delete: true }` hasil verifikasi chat/raw_text oleh admin/CS.
 * - Tanpa `--map`: skrip hanya mengusulkan HAPUS untuk sampah struktural jelas
 *   (kurung tak berpasangan / mengandung ':' label form / usia telanjang) dan
 *   menandai sisanya sebagai FLAG_REVIEW (tidak disentuh otomatis).
 * - Membersihkan nama customer yang memuat newline (generik, tanpa nama hardcode).
 * - Re-sync Google Contacts best-effort dengan log jujur per customer.
 *
 * Aman secara default: DRY-RUN (read-only). `--commit` menulis ke DB HANYA
 * setelah backup CSV tertulis + tiap kegagalan dicatat jujur (tidak ditelan).
 * Usage:
 *   npx tsx src/scripts/heal-corrupted-children-and-customers.ts                        (Dry run)
 *   npx tsx src/scripts/heal-corrupted-children-and-customers.ts --commit               (Tulis, dengan backup CSV)
 *   npx tsx src/scripts/heal-corrupted-children-and-customers.ts --commit --map=heal-map.json
 *
 * Format heal-map.json: [{ "childId": "uuid", "correctName": "NamaBenar" }, { "childId": "uuid2", "delete": true }]
 */

import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { isValidChildName, sanitizeCustomerNameForStorage } from '../utils/name-sanitizer';
import { googleContactsService } from '../services/google-contacts.service';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const isCommit = process.argv.includes('--commit');
const tenantArg = process.argv.find((a) => a.startsWith('--tenant='));
const tenantId = tenantArg ? tenantArg.split('=')[1]!.trim() : DEFAULT_TENANT_ID;
const mapArg = process.argv.find((a) => a.startsWith('--map='));
const mapPath = mapArg ? mapArg.split('=').slice(1).join('=').trim() : '';

interface MapEntry {
  childId: string;
  correctName?: string;
  delete?: boolean;
}

interface AuditLog {
  category: string;
  customerId: string;
  customerName?: string | null;
  action: 'UPDATE_CHILD' | 'DELETE_CHILD' | 'UPDATE_CUSTOMER' | 'FLAG_REVIEW' | 'SKIP';
  detail: string;
}

function loadMap(path: string): Map<string, MapEntry> {
  const out = new Map<string, MapEntry>();
  if (!path) return out;
  const raw = readFileSync(path, 'utf8');
  const arr = JSON.parse(raw) as MapEntry[];
  if (!Array.isArray(arr)) throw new Error(`Map file ${path} harus berisi array JSON.`);
  for (const e of arr) {
    if (!e || typeof e.childId !== 'string' || !e.childId.trim()) {
      throw new Error(`Entri map tak sah (childId wajib): ${JSON.stringify(e)}`);
    }
    if (e.correctName !== undefined && !isValidChildName(e.correctName)) {
      throw new Error(`correctName tak sah untuk ${e.childId}: ${JSON.stringify(e.correctName)}`);
    }
    out.set(e.childId.trim(), e);
  }
  return out;
}

/** Sampah struktural yang aman dihapus otomatis (tanpa tafsir bahasa). */
function isStructuralGarbage(name: string): boolean {
  const s = (name || '').trim();
  if (!s) return true;
  const open = (s.match(/\(/g) || []).length;
  const close = (s.match(/\)/g) || []).length;
  if (open !== close) return true;
  if (s.includes(':')) return true;
  if (/^\d+(?:[.,]\d+)?\s*(?:bulan|bln|thn|tahun|th|hari|hr|minggu|m)\b/i.test(s)) return true;
  return false;
}

function csvEscape(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function healCorruptedChildrenAndCustomers(tenant: string = tenantId, commit: boolean = isCommit): Promise<{
  logs: AuditLog[];
  affectedCustomerIds: string[];
}> {
  const logs: AuditLog[] = [];
  const affectedCustomerIds = new Set<string>();
  const errors: string[] = [];
  const map = loadMap(mapPath);

  console.log('================================================================');
  console.log(`[HEAL CHILDREN & CUSTOMERS] Mode: ${commit ? 'COMMIT (MENULIS KE DB)' : 'DRY-RUN (READ-ONLY)'}`);
  console.log(`[HEAL CHILDREN & CUSTOMERS] Tenant: ${tenant}`);
  console.log(`[HEAL CHILDREN & CUSTOMERS] Map: ${mapPath || '(tidak ada — hanya sampah struktural + flag review)'}`);
  console.log('================================================================\n');

  // 1. Sapu seluruh baris children yang gagal validator kanonis.
  const allChildren = await prisma.child.findMany({
    where: { tenant_id: tenant },
    include: { customer: true },
  });

  type PlanItem = { id: string; customerId: string; customerName?: string | null; from: string; action: AuditLog['action']; to?: string; reason: string };
  const plan: PlanItem[] = [];

  for (const child of allChildren) {
    const nm = String((child as any).name ?? '');
    if (isValidChildName(nm)) continue;
    affectedCustomerIds.add((child as any).customer_id);
    const mapped = map.get((child as any).id);
    if (mapped?.correctName) {
      plan.push({
        id: (child as any).id, customerId: (child as any).customer_id,
        customerName: (child as any).customer?.name ?? null,
        from: nm, action: 'UPDATE_CHILD', to: mapped.correctName,
        reason: `Rename sesuai map manusia (${mapPath}).`,
      });
    } else if (mapped?.delete || isStructuralGarbage(nm)) {
      plan.push({
        id: (child as any).id, customerId: (child as any).customer_id,
        customerName: (child as any).customer?.name ?? null,
        from: nm, action: 'DELETE_CHILD',
        reason: mapped?.delete ? `Hapus sesuai map manusia (${mapPath}).` : 'Sampah struktural (kurung/label/usia telanjang).',
      });
    } else {
      plan.push({
        id: (child as any).id, customerId: (child as any).customer_id,
        customerName: (child as any).customer?.name ?? null,
        from: nm, action: 'FLAG_REVIEW',
        reason: 'Butuh verifikasi manusia (nama benar tidak boleh ditebak skrip).',
      });
    }
  }

  // 2. Backup CSV sebelum tulis apa pun.
  let backupFile = '';
  const actionable = plan.filter((p) => p.action === 'UPDATE_CHILD' || p.action === 'DELETE_CHILD');
  if (commit && actionable.length > 0) {
    const dir = join(process.cwd(), 'storage', 'backups');
    mkdirSync(dir, { recursive: true });
    backupFile = join(dir, `heal-children-${tenant}-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);
    const lines = ['child_id,customer_id,customer_name,from_name,action,to_name,reason'];
    for (const p of actionable) {
      lines.push([p.id, p.customerId, p.customerName ?? '', p.from, p.action, p.to ?? '', p.reason].map(csvEscape).join(','));
    }
    writeFileSync(backupFile, lines.join('\n'), 'utf8');
    console.log(`[BACKUP] ${actionable.length} baris actionable dibackup ke ${backupFile}\n`);
  }

  // 3. Eksekusi rencana (atau laporkan saja bila dry-run).
  for (const p of plan) {
    if (p.action === 'FLAG_REVIEW') {
      logs.push({ category: 'NeedsHumanReview', customerId: p.customerId, customerName: p.customerName, action: 'FLAG_REVIEW', detail: `Tahan '${p.from}' (id: ${p.id}). ${p.reason}` });
      continue;
    }
    const label = p.action === 'UPDATE_CHILD' ? `Ganti '${p.from}' -> '${p.to}' (id: ${p.id}). ${p.reason}` : `Hapus '${p.from}' (id: ${p.id}). ${p.reason}`;
    logs.push({ category: 'InvalidChildName', customerId: p.customerId, customerName: p.customerName, action: p.action, detail: label });
    if (!commit) continue;
    try {
      if (p.action === 'UPDATE_CHILD') {
        await prisma.child.update({ where: { id: p.id }, data: { name: p.to! } });
      } else {
        await prisma.child.delete({ where: { id: p.id } });
      }
    } catch (err: any) {
      const msg = `Gagal ${p.action} ${p.id}: ${err?.message || err}`;
      errors.push(msg);
      console.error(`[HEAL ERROR] ${msg}`);
    }
  }

  // 4. Bersihkan nama customer bernilai newline (generik).
  const newlineCustomers = await prisma.customer.findMany({
    where: { tenant_id: tenant, OR: [{ name: { contains: '\n' } }, { name: { contains: '\r' } }] },
  });
  for (const cust of newlineCustomers) {
    const firstLine = String((cust as any).name || '').split(/[\r\n]+/)[0].trim();
    const cleanName = sanitizeCustomerNameForStorage(firstLine) || firstLine;
    if (cleanName && cleanName !== (cust as any).name) {
      affectedCustomerIds.add((cust as any).id);
      logs.push({
        category: 'CustomerNameNewline', customerId: (cust as any).id, customerName: (cust as any).name,
        action: 'UPDATE_CUSTOMER', detail: `Bersihkan newline -> '${cleanName}'.`,
      });
      if (commit) {
        try {
          await prisma.customer.update({ where: { id: (cust as any).id }, data: { name: cleanName } });
        } catch (err: any) {
          const msg = `Gagal UPDATE_CUSTOMER ${(cust as any).id}: ${err?.message || err}`;
          errors.push(msg);
          console.error(`[HEAL ERROR] ${msg}`);
        }
      }
    }
  }

  // 5. Re-sync Google Contacts (best-effort, log jujur).
  if (commit && affectedCustomerIds.size > 0) {
    console.log(`\n[GOOGLE CONTACTS SYNC] ${affectedCustomerIds.size} pelanggan terdampak...`);
    const { googleContactsService } = await import('../services/google-contacts.service');
    for (const custId of affectedCustomerIds) {
      try {
        await googleContactsService.syncCustomer(tenant, custId, { trigger: 'manual' });
        console.log(`  -> OK ${custId}`);
      } catch (err: any) {
        const msg = `Sync kontak ${custId} dilewati/gagal: ${err?.message || err}`;
        errors.push(msg);
        console.warn(`  -> ${msg}`);
      }
    }
  }

  console.log('\n================================================================');
  console.log(`[HASIL] Rencana: ${plan.length} (${actionable.length} actionable, ${plan.length - actionable.length} FLAG_REVIEW)`);
  console.log(`[HASIL] Pelanggan terdampak: ${affectedCustomerIds.size}`);
  console.log(`[HASIL] Error: ${errors.length}${backupFile ? ` | Backup: ${backupFile}` : ''}`);
  for (const l of logs) console.log(`- [${l.category}] [${l.action}] ${l.customerName || l.customerId}: ${l.detail}`);
  if (errors.length > 0) {
    console.log('--- ERROR ---');
    for (const e of errors) console.log(`! ${e}`);
  }
  console.log('================================================================\n');

  if (errors.length > 0) throw new Error(`Healing selesai dengan ${errors.length} error. Lihat log di atas.`);
  return { logs, affectedCustomerIds: Array.from(affectedCustomerIds) };
}

// Jalankan otomatis jika dipanggil langsung via CLI
if (require.main === module || (typeof process !== 'undefined' && process.argv[1]?.includes('heal-corrupted-children-and-customers'))) {
  healCorruptedChildrenAndCustomers()
    .then(() => { console.log('Selesai.'); process.exit(0); })
    .catch((err) => { console.error('Error saat eksekusi:', err?.message || err); process.exit(1); });
}
