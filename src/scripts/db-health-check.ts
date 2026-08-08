// Jalankan: npx tsx src/scripts/db-health-check.ts
// Audit kesehatan & latency koneksi database (PostgreSQL + Redis) untuk production.
// Output: angka konkret (ms) untuk raw connect, query sederhana vs kompleks (FTS/join),
//          connection pool status, EXPLAIN ANALYZE deteksi index, dan status Redis.
// Catatan: standalone (bukan bagian dari Vitest). Butuh DATABASE_URL terhubung ke DB live
//          (jalankan di server, bukan lokal yang DB-nya off).
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const DEFAULT_TENANT = process.env.DEFAULT_TENANT_ID || 'default-tenant';
const N = 8;

const prisma = new PrismaClient({ log: ['error'] });

function pct(arr: number[], p: number): number {
  const s = [...arr].sort((a, b) => a - b);
  if (!s.length) return 0;
  const idx = Math.min(s.length - 1, Math.floor((p / 100) * s.length));
  return s[idx];
}
function avg(arr: number[]): number {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

async function measure(fn: () => Promise<unknown>): Promise<number | null> {
  const t = process.hrtime.bigint();
  try {
    await fn();
    return Number(process.hrtime.bigint() - t) / 1e6;
  } catch (e: any) {
    console.warn('    ⚠️ query error:', e.message);
    return null;
  }
}

function format(samples: Array<number | null>): string {
  const arr = samples.filter((x): x is number => x !== null);
  if (!arr.length) return 'TIDAK ADA SAMPEL (error semua)';
  return `p50=${pct(arr, 50).toFixed(1)}ms p95=${pct(arr, 95).toFixed(1)}ms p99=${pct(arr, 99).toFixed(1)}ms avg=${avg(arr).toFixed(1)}ms (n=${arr.length})`;
}

async function rawConnectLatency(): Promise<void> {
  console.log('\n=== 1) PostgreSQL RAW CONNECT LATENCY (fresh $connect) ===');
  const samples: number[] = [];
  for (let i = 0; i < N; i++) {
    const t = process.hrtime.bigint();
    const c = new PrismaClient();
    try {
      await c.$connect();
      samples.push(Number(process.hrtime.bigint() - t) / 1e6);
      await c.$disconnect();
    } catch (e: any) {
      console.warn(`    [connect run ${i + 1}] ERROR: ${e.message}`);
      await c.$disconnect().catch(() => {});
    }
  }
  console.log(`  raw connect: ${format(samples)}`);
}

async function simpleQueryLatency(): Promise<void> {
  const samples: number[] = [];
  for (let i = 0; i < N; i++) {
    const ms = await measure(() => prisma.$queryRaw`SELECT 1`);
    if (ms !== null) samples.push(ms);
  }
  console.log(`  SELECT 1 (warm, pooled): ${format(samples)}`);
}

async function ftsLatency(): Promise<void> {
  console.log('\n=== 3) Full-Text Search (knowledge_chunks) — dipakai tiap balasan FAQ ===');
  const q = 'pijat bayi perawatan';
  const fn = () =>
    prisma.$queryRaw`
      SELECT id FROM knowledge_chunks
      WHERE tenant_id = ${DEFAULT_TENANT}
        AND to_tsvector('simple', content) @@ websearch_to_tsquery('simple', ${q})
      ORDER BY ts_rank(to_tsvector('simple', content), websearch_to_tsquery('simple', ${q})) DESC
      LIMIT 3
    `;
  const samples: number[] = [];
  for (let i = 0; i < N; i++) {
    const ms = await measure(fn);
    if (ms !== null) samples.push(ms);
  }
  console.log(`  FTS websearch_to_tsquery: ${format(samples)}`);
  const count = await prisma.$queryRaw<Array<{ cnt: bigint }>>`SELECT count(*) as cnt FROM knowledge_chunks WHERE tenant_id = ${DEFAULT_TENANT}`;
  console.log(`  total knowledge_chunks tenant=${DEFAULT_TENANT}: ${count[0]?.cnt ?? 0}`);
}

async function joinLatency(): Promise<void> {
  console.log('\n=== 4) Complex JOIN: Customer + Reservations + Children (replica list customer admin) ===');
  const fn = () =>
    prisma.customer.findMany({
      where: { tenant_id: DEFAULT_TENANT },
      take: 20,
      orderBy: { created_at: 'desc' },
      include: { reservations: { include: { children: true } } },
    });
  const samples: number[] = [];
  for (let i = 0; i < N; i++) {
    const ms = await measure(fn);
    if (ms !== null) samples.push(ms);
  }
  console.log(`  join customer+reservations+children (take 20): ${format(samples)}`);
}

async function stagingLatency(): Promise<void> {
  console.log('\n=== 5) FAQ STAGING list (medical & general) ===');
  const mc = (await prisma.$queryRaw<Array<{ cnt: number }>>`SELECT count(*)::int as cnt FROM medical_faq_staging WHERE tenant_id = ${DEFAULT_TENANT} AND status='PENDING'`)[0]?.cnt;
  const gc = (await prisma.$queryRaw<Array<{ cnt: number }>>`SELECT count(*)::int as cnt FROM general_faq_staging WHERE tenant_id = ${DEFAULT_TENANT} AND status='PENDING'`)[0]?.cnt;
  console.log(`  rows PENDING: medical=${mc ?? 'n/a'} general=${gc ?? 'n/a'}`);

  const mSamples: Array<number | null> = [];
  const gSamples: Array<number | null> = [];
  for (let i = 0; i < 8; i++) {
    mSamples.push(await measure(() => prisma.medicalFaqStaging.findMany({ where: { tenant_id: DEFAULT_TENANT, status: 'PENDING' }, take: 50, orderBy: { created_at: 'desc' } })));
    gSamples.push(await measure(() => prisma.generalFaqStaging.findMany({ where: { tenant_id: DEFAULT_TENANT, status: 'PENDING' }, take: 50, orderBy: { created_at: 'desc' } })));
  }
  console.log(`  medical staging findMany: ${format(mSamples)}`);
  console.log(`  general staging findMany: ${format(gSamples)}`);

  // Replica N+1 yang dipakai migration.subroute.ts (per-row knowledgeChunk.findUnique)
  const chunkSamples: Array<number | null> = [];
  for (let i = 0; i < 8; i++) {
    chunkSamples.push(await measure(() => prisma.knowledgeChunk.findUnique({ where: { id: '00000000-0000-0000-0000-000000000000' } })));
  }
  console.log(`  knowledgeChunk.findUnique per-row (N+1 di GET FAQ staging list): ${format(chunkSamples)}`);
  console.log('  ⚠️ GET medical-faq-staging & general-faq-staging menjalankan ini PER ROW.');
}

async function poolCheck(): Promise<void> {
  console.log('\n=== 6) Connection POOL (pg_stat_activity) ===');
  const rows = await prisma.$queryRaw<Array<{ state: string | null; count: number }>>`
    SELECT COALESCE(state, '<idle>') as state, count(*)::int as count
    FROM pg_stat_activity WHERE datname = current_database()
    GROUP BY state ORDER BY count DESC;
  `;
  const map: Record<string, number> = {};
  for (const r of rows) map[r.state || 'unknown'] = Number(r.count);
  console.log(`  state: ${JSON.stringify(map)}`);
  console.log(`  idle-in-transaction: ${map['idle in transaction'] || 0} (tetap tinggi = koneksi bocor)`);
  console.log(`  active: ${map['active'] || 0}`);

  const mx = await prisma.$queryRaw<Array<Record<string, string>>>`SELECT current_setting('max_connections') as val`;
  const poolFromUrl = /connection_limit=(\d+)/.exec(process.env.DATABASE_URL || '')?.[1];
  console.log(`  postgres max_connections: ${mx[0]?.val ?? 'n/a'}`);
  console.log(`  DATABASE_URL connection_limit: ${poolFromUrl || 'default (3×cpu+1)'}  pool_timeout: ${/pool_timeout=(\d+)/.exec(process.env.DATABASE_URL || '')?.[1] || 'default 10s'}`);
}

async function explainAnalysis(): Promise<void> {
  console.log('\n=== 7) EXPLAIN ANALYZE — deteksi Seq Scan / index ===');
  const q = 'pijat';
  try {
    const plan = await prisma.$queryRawUnsafe(
      `EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM knowledge_chunks WHERE tenant_id = '${DEFAULT_TENANT}' AND to_tsvector('simple', content) @@ websearch_to_tsquery('simple', '${q}') LIMIT 3;`
    );
    console.log('  [knowledge_chunks FTS]:');
    (plan as Array<{ 'QUERY PLAN': string }>).forEach((r) => console.log('    ' + (r['QUERY PLAN'] || '')));
    if ((plan as Array<{ 'QUERY PLAN': string }>).some((r) => (r['QUERY PLAN'] || '').includes('Seq Scan')))
      console.log('    ⚠️ SEQ SCAN — tanpa GIN index / generated tsvector, tiap pencarian FAQ scan seluruh konten.');
  } catch (e: any) {
    console.log('  ❌ EXPLAIN FTS gagal:', e.message);
  }
  try {
    const plan = await prisma.$queryRawUnsafe(
      `EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM medical_faq_staging WHERE tenant_id = '${DEFAULT_TENANT}' AND status = 'PENDING' LIMIT 50;`
    );
    console.log('  [medical_faq_staging status filter]:');
    (plan as Array<{ 'QUERY PLAN': string }>).forEach((r) => console.log('    ' + (r['QUERY PLAN'] || '')));
  } catch (e: any) {
    console.log('  ❌ EXPLAIN staging gagal:', e.message);
  }

  const idx = await prisma.$queryRaw<Array<{ tablename: string; indexname: string }>>`
    SELECT tablename, indexname FROM pg_indexes
    WHERE schemaname='public' AND tablename IN
      ('knowledge_chunks','medical_faq_staging','general_faq_staging','conversations','reservations','customers','messages')
    ORDER BY tablename;
  `;
  console.log('\n  Index (public schema):');
  for (const r of idx) console.log(`    ${r.tablename}: ${r.indexname}`);
}

async function redisCheck(): Promise<void> {
  console.log('\n=== 8) Redis health ===');
  const host = process.env.REDIS_HOST || 'localhost';
  const port = parseInt(process.env.REDIS_PORT || '6379', 10);
  try {
    const { default: Redis } = await import('ioredis');
    const client = new Redis(port, host, {
      connectTimeout: 2000,
      lazyConnect: true,
      maxRetriesPerRequest: null,
      retryStrategy: () => null,
    });
    client.on('error', () => {}); // konsumsi reconnect-error agar tidak spam & hang
    const t = process.hrtime.bigint();
    await client.connect();
    const connectMs = Number(process.hrtime.bigint() - t) / 1e6;
    const samples: number[] = [];
    for (let i = 0; i < N; i++) {
      const t0 = process.hrtime.bigint();
      await client.ping();
      samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    const info = await client.info('memory');
    const usedLine = info.split('\n').find((l) => l.startsWith('used_memory_human')) || '';
    await client.quit();
    console.log(`  Redis ${host}:${port} CONNECTED (connect ${connectMs.toFixed(1)}ms)`);
    console.log(`  PING: ${format(samples)}`);
    console.log(`  memory: ${usedLine.split(':')[1] || 'n/a'}`);
  } catch (e: any) {
    console.warn(`  ❌ Redis ${host}:${port} tidak terjangkau (${e.message})`);
    console.warn('     BullMQ shards, broadcast queue, live-chat pub/sub, FAQ cache → in-memory fallback.');
    console.warn('     Durable queueing & multi-instance sync HILANG; health endpoint hardcode IN_MEMORY_FALLBACK_ACTIVE.');
  }
}

async function main(): Promise<void> {
  console.log('===== DB HEALTH CHECK — Production Performance Audit =====');
  console.log(`node=${process.version} env=${process.env.NODE_ENV || 'development'} tenant=${DEFAULT_TENANT}`);
  console.log(`DB url: ${(process.env.DATABASE_URL || '').replace(/\/\/[^@]+@/, '//***@')}`);

  await rawConnectLatency();
  console.log('\n=== 2) Simple query latency (SELECT 1, pooled) ===');
  await simpleQueryLatency();
  await ftsLatency();
  await joinLatency();
  await stagingLatency();
  await poolCheck();
  await explainAnalysis();
  await redisCheck();
  await prisma.$disconnect();
  console.log('\n===== Selesai =====');
}

main()
  .catch((e) => {
    console.error('FATAL:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });