/**
 * #128-FaseA (A2) — Generator seed katalog dashboard.
 *
 * Masalah: `packages/admin-dashboard/src/utils/treatmentParser.ts` memelihara
 * SALINAN katalog hardcoded (`DEFAULT_CLINIC_SERVICES_FALLBACK`) yang drift dari
 * sumber kebenaran backend (`DEFAULT_CLINIC_SERVICES`). Drift nyata: 11 layanan
 * aktif backend hilang dari salinan dashboard.
 *
 * Solusi fondasional: satu sumber. Script ini menulis JSON seed dari array
 * backend; dashboard meng-import JSON itu (offline-safe, bundled). Guard test
 * `tests/unit/catalog-seed-drift.test.ts` memastikan JSON selalu sinkron.
 *
 * Jalankan: `npm run catalog:seed`  (lalu commit file hasil).
 */
import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_CLINIC_SERVICES } from '../services/treatment-catalog.service';

const OUT = path.join(
  process.cwd(),
  'packages',
  'admin-dashboard',
  'src',
  'data',
  'clinicServicesFallback.json'
);

// Hanya layanan AKTIF — selaras semantik fallback lama (dashboard tidak boleh
// mencocokkan/menormalisasi nama ke layanan nonaktif).
const activeServices = DEFAULT_CLINIC_SERVICES.filter((s) => s.isActive);

const dir = path.dirname(OUT);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

fs.writeFileSync(OUT, JSON.stringify(activeServices, null, 2) + '\n', 'utf-8');
console.log(`[catalog:seed] Wrote ${activeServices.length} active services (dari ${DEFAULT_CLINIC_SERVICES.length} total) → ${path.relative(process.cwd(), OUT)}`);
