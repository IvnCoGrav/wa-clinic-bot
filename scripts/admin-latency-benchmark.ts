// Jalankan: npx tsx src/scripts/admin-latency-benchmark.ts
// Load-test endpoint admin panel — p50/p95/p99 + ukuran payload.
// Metode: in-process fastify app.inject() (tanpa network-TLS noise; mengukur route+DB murni).
// Total request dijaga di bawah rate-limit global (300/min per key+IP).
// `--concurrent=N` = simulasi beban bersamaan (N parallel inject) untuk deteksi contention 2 vCPU.
// Endpoint yang hanya menulis DB lokal diukur 1x; yang side-effect eksternal TIDAK di-run.
import dotenv from 'dotenv';
import { buildApp } from '../app';

dotenv.config();

const CONCURRENCY = parseInt(process.argv.find((a) => a.startsWith('--concurrent='))?.split('=')[1] || '1', 10);
const ITERS = parseInt(process.argv.find((a) => a.startsWith('--iters='))?.split('=')[1] || '12', 10);
const PAGE = process.argv.find((a) => a.startsWith('--page='))?.split('=')[1] || '1';
const PAGE_SIZE = process.argv.find((a) => a.startsWith('--pageSize='))?.split('=')[1] || '20';
const ADMIN_KEY = process.env.ADMIN_API_KEY || '';
const TENANT_ID = process.env.DEFAULT_TENANT_ID || 'default-tenant';
const ID_DUMMY = '00000000-0000-0000-0000-000000000000';

interface EP {
  name: string;
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  url: string;
  payload?: unknown;
}

// Group READ — aman, boleh banyak iterasi
const READ_ENDPOINTS: EP[] = [
  { name: 'reservations-list', method: 'GET', url: `/api/admin/reservations?page=${PAGE}&pageSize=${PAGE_SIZE}` },
  { name: 'reservations-count', method: 'GET', url: '/api/admin/reservations/count' },
  { name: 'customers-list', method: 'GET', url: `/api/admin/customers?search=&page=${PAGE}&pageSize=${PAGE_SIZE}` },
  { name: 'chat-conversations', method: 'GET', url: '/api/admin/human-handling-conversations' },
  { name: 'livechat-list', method: 'GET', url: '/api/admin/live-chat/conversations?limit=50&offset=0' },
  { name: 'knowledge-chunks', method: 'GET', url: `/api/admin/knowledge/chunks?page=${PAGE}&pageSize=${PAGE_SIZE}` },
  { name: 'migration-staging', method: 'GET', url: `/api/admin/migration/staging?status=PENDING&page=${PAGE}&limit=20` },
  { name: 'medical-faq-staging', method: 'GET', url: '/api/admin/medical-faq-staging' },
  { name: 'general-faq-staging', method: 'GET', url: '/api/admin/general-faq-staging' },
  { name: 'harvest-status', method: 'GET', url: '/api/admin/harvest/status' },
  { name: 'ai-models', method: 'GET', url: '/api/admin/ai-models' },
  { name: 'ai-evaluations', method: 'GET', url: '/api/admin/ai-evaluations?days=7&limit=20' },
  { name: 'settings', method: 'GET', url: '/api/admin/settings' },
  { name: 'health', method: 'GET', url: '/api/admin/health' },
  { name: 'landings', method: 'GET', url: `/api/admin/landings?tenantId=${TENANT_ID}` },
  { name: 'delivery-tiers', method: 'GET', url: '/api/admin/delivery-tiers' },
  { name: 'services', method: 'GET', url: '/api/admin/services' },
  { name: 'ai-rollout-scope', method: 'GET', url: '/api/admin/ai-rollout-scope' },
  { name: 'conversation-behavior', method: 'GET', url: '/api/admin/conversation-behavior' },
  { name: 'whatsapp-provider', method: 'GET', url: '/api/admin/whatsapp-provider' },
];

// WRITE DB-only (tanpa external network), diukur 1x sebagai baseline tulis.
const WRITE_ENDPOINTS: EP[] = [
  { name: 'migration-staging-patch', method: 'PATCH', url: `/api/admin/migration/staging/${ID_DUMMY}`, payload: { status: 'APPROVED' } },
  { name: 'knowledge-chunk-put', method: 'PUT', url: `/api/admin/knowledge/chunks/${ID_DUMMY}`, payload: { title: 'x', content: 'y', document_name: 'z' } },
  { name: 'settings-toggle', method: 'PATCH', url: '/api/admin/settings', payload: { botActive: true } },
  { name: 'conversation-release', method: 'PATCH', url: `/api/admin/conversation/${ID_DUMMY}/release` },
  { name: 'ai-models-patch', method: 'PATCH', url: '/api/admin/ai-models/MEDICAL_CHECK', payload: { model: 'current' } },
];

// Endpoint side-effect eksternal — tidak aktif di benchmark otomatis, diukur manual terpisah.
const EXTERNAL_ONLY: string[] = [
  'PATCH /api/admin/reservation/:id/confirm → Google Calendar createEvent (jangan load-test)',
  'PATCH /api/admin/reservation/:id/set-date → Google Calendar updateEvent (jangan load-test)',
  'POST /api/admin/live-chat/conversations/:id/reply → WAHA/WABA send',
  'POST /api/admin/migration/extract → WAHA getChats/getMessages per chat',
  'POST /api/admin/harvest/legacy-chat → background WAHA + LLM + DB',
  'POST /api/tracking/click → adClick DB write + generasi tracking code (ukur di landing audit)',
];

function pctl(arr: number[], p: number): number {
  const s = [...arr].sort((a, b) => a - b);
  if (!s.length) return 0;
  const idx = Math.min(s.length - 1, Math.floor((p / 100) * s.length));
  return s[idx];
}

function fmt(samples: number[]): string {
  if (!samples.length) return '-';
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  return `p50=${pctl(samples, 50).toFixed(0)}ms p95=${pctl(samples, 95).toFixed(0)}ms p99=${pctl(samples, 99).toFixed(0)}ms avg=${avg.toFixed(0)}ms`;
}

async function main() {
  console.log('===== ADMIN LATENCY BENCHMARK =====');
  console.log(`concurrency=${CONCURRENCY} iters(read)=${ITERS} page=${PAGE}/${PAGE_SIZE} tenant=${TENANT_ID}`);
  if (!ADMIN_KEY) {
    console.error('ADMIN_API_KEY belum di-set. Abort.');
    process.exit(1);
  }

  const app = buildApp();
  const hdr = { 'x-api-key': ADMIN_KEY };

  console.log('\n--- GROUP A: READ ENDPOINTS ---');
  const readRows: Array<{ name: string; method: string; samples: number[]; statuses: number[]; maxPayload: number }> = [];
  for (const e of READ_ENDPOINTS) {
    const samples: number[] = [];
    const statuses: number[] = [];
    let maxPayload = 0;
    const queue = Array.from({ length: ITERS }, (_, i) => i);
    let cursor = 0;
    const worker = async () => {
      while (cursor < queue.length) {
        const i = queue[cursor++];
        const t = process.hrtime.bigint();
        const res = await app.inject({ method: e.method, url: e.url, headers: hdr });
        samples.push(Number(process.hrtime.bigint() - t) / 1e6);
        statuses.push(res.statusCode);
        maxPayload = Math.max(maxPayload, Buffer.byteLength(res.payload ?? ''));
        void i;
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ITERS) }, () => worker()));
    console.log(`${e.method.padEnd(5)} ${e.name.padEnd(24)} ${fmt(samples)}  status=${[...new Set(statuses)]} payloadMax=${maxPayload}`);
    readRows.push({ name: e.name, method: e.method, samples, statuses, maxPayload });
  }

  console.log('──────────────────────────────────────────────────────────────────');

  // --- WRITE endpoints (1x, DB-only) ---
  console.log('--- GROUP B: WRITE ENDPOINTS (1x, DB-only) ---');
  for (const e of WRITE_ENDPOINTS) {
    const t = process.hrtime.bigint();
    try {
      const res = await app.inject({
        method: e.method,
        url: e.url,
        payload: JSON.stringify(e.payload || {}),
        headers: { ...hdr, 'content-type': 'application/json' },
      });
      const ms = Number(process.hrtime.bigint() - t) / 1e6;
      console.log(`${e.method.padEnd(5)} ${e.name.padEnd(24)} ${ms.toFixed(1)}ms  status=${res.statusCode}`);
    } catch (err: any) {
      console.log(`${e.method.padEnd(5)} ${e.name.padEnd(24)} ERROR ${err.message}`);
    }
  }

  console.log('--- EXTERNAL-ONLY (manual saja, TIDAK di-benchmark otomatis) ---');
  EXTERNAL_ONLY.forEach((n) => console.log('  * ' + n));

  await app.close();
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});