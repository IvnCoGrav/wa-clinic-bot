#!/usr/bin/env node
/**
 * Audit lisensi jawaban umum vs grounding RAG (C-006) — READ-ONLY.
 *
 * Membaca log eksekusi LLM (`logs/llm-*.jsonl`) dan mengelompokkan setiap
 * pemanggilan model menjadi:
 *   - GROUNDED       : ada chunk RAG (`groundTruthUsed.retrievedChunks`)
 *   - TOOL_GROUNDED  : tidak ada chunk, tetapi ada tool katalog/knowledge
 *   - UNGROUNDED     : tidak ada chunk maupun tool → jawaban murni pengetahuan umum
 *
 * Skrip ini TIDAK memutuskan pelanggaran. Ia menyiapkan bukti untuk direview
 * manusia (acceptance C-006: "bandingkan retrievedChunks vs jawaban").
 *
 * Pemakaian:
 *   node scripts/audit/rag-license-report.mjs --dir logs --since 2026-11-01
 *   node scripts/audit/rag-license-report.mjs --dir logs --json rag-report.json
 */
import fs from 'node:fs';
import path from 'node:path';

const TOOL_GROUNDING_NAMES = new Set([
  'search_knowledge_faq',
  'get_catalog_and_price',
  'get_catalog',
  'check_available_slots',
]);

function parseArgs(argv) {
  const args = { dir: 'logs', since: null, json: null, samples: 20 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') args.dir = argv[++i];
    else if (a === '--since') args.since = argv[++i];
    else if (a === '--json') args.json = argv[++i];
    else if (a === '--samples') args.samples = Number(argv[++i]) || 20;
  }
  return args;
}

function chunkCount(record) {
  const chunks = record?.groundTruthUsed?.retrievedChunks;
  return Array.isArray(chunks) ? chunks.length : 0;
}

function toolNames(record) {
  const tools = record?.toolsCalled;
  if (!Array.isArray(tools)) return [];
  return tools.map((t) => (typeof t === 'string' ? t : t?.name)).filter(Boolean);
}

function classify(record) {
  if (chunkCount(record) > 0) return 'GROUNDED';
  if (toolNames(record).some((n) => TOOL_GROUNDING_NAMES.has(n))) return 'TOOL_GROUNDED';
  return 'UNGROUNDED';
}

function listLogFiles(dir, since) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^llm-.*\.jsonl$/i.test(f))
    .filter((f) => {
      if (!since) return true;
      const m = f.match(/(\d{4}-\d{2}-\d{2})/);
      return m ? m[1] >= since : true;
    })
    .map((f) => path.join(dir, f))
    .sort();
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const files = listLogFiles(args.dir, args.since);
  if (files.length === 0) {
    console.error(
      `Tidak ada berkas llm-*.jsonl di "${args.dir}"${args.since ? ` sejak ${args.since}` : ''}. ` +
        'Salin log dari server produksi/staging lebih dulu (lihat docs/plans/REMAINING_PRODUCTION_AUDITS_2026-11-13.md).'
    );
    process.exit(2);
  }

  const buckets = { GROUNDED: 0, TOOL_GROUNDED: 0, UNGROUNDED: 0 };
  const byFlow = new Map();
  const byTenant = new Map();
  const samples = [];
  let total = 0;
  let invalid = 0;

  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    for (const rawLine of lines) {
      // Toleran BOM (beberapa alat menulis UTF-8 BOM) dan baris kosong.
      const line = rawLine.replace(/^\uFEFF/, '').trim();
      if (!line) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        invalid++;
        continue;
      }
      total++;
      const kind = classify(record);
      buckets[kind]++;

      const flow = record.flowType || '(tanpa_flow)';
      byFlow.set(flow, (byFlow.get(flow) || { GROUNDED: 0, TOOL_GROUNDED: 0, UNGROUNDED: 0 }));
      byFlow.get(flow)[kind]++;

      const tenant = record.tenantId || '(tanpa_tenant)';
      byTenant.set(tenant, (byTenant.get(tenant) || { GROUNDED: 0, TOOL_GROUNDED: 0, UNGROUNDED: 0 }));
      byTenant.get(tenant)[kind]++;

      if (kind === 'UNGROUNDED' && samples.length < args.samples) {
        samples.push({
          timestamp: record.timestamp,
          flowType: flow,
          tenantId: record.tenantId,
          customerInput: String(record.customerInput || '').slice(0, 200),
          finalReply: String(record.finalReply || '').slice(0, 300),
          status: record.status,
          toolsCalled: toolNames(record),
        });
      }
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    sourceFiles: files,
    totals: { records: total, invalidLines: invalid, ...buckets },
    ungroundedRate: total > 0 ? Number(((buckets.UNGROUNDED / total) * 100).toFixed(2)) : null,
    byFlowType: Object.fromEntries(byFlow),
    byTenant: Object.fromEntries(byTenant),
    ungroundedSamples: samples,
    note:
      'UNGROUNDED = tidak ada chunk RAG dan tidak ada tool katalog. Review sampel: bila jawaban memuat klaim klinis/harga, lisensi pengetahuan umum perlu dicabut untuk pertanyaan klinis.',
  };

  if (args.json) {
    fs.writeFileSync(args.json, JSON.stringify(report, null, 2) + '\n', 'utf8');
    console.log(`Laporan JSON ditulis ke ${args.json}`);
  }

  console.log('=== RAG LICENSE REPORT (C-006) ===');
  console.log(`Berkas log   : ${files.length}`);
  console.log(`Total record : ${total} (baris invalid: ${invalid})`);
  console.log(
    `GROUNDED=${buckets.GROUNDED}  TOOL_GROUNDED=${buckets.TOOL_GROUNDED}  UNGROUNDED=${buckets.UNGROUNDED}`
  );
  console.log(`Rasio UNGROUNDED: ${report.ungroundedRate}%`);
  console.log('\nPer flowType:');
  for (const [flow, c] of Object.entries(report.byFlowType)) {
    console.log(`  ${flow}: grounded=${c.GROUNDED} tool=${c.TOOL_GROUNDED} ungrounded=${c.UNGROUNDED}`);
  }
  if (samples.length > 0) {
    console.log(`\nSampel UNGROUNDED (maks ${args.samples}):`);
    for (const s of samples) {
      console.log(`- [${s.timestamp}] ${s.flowType} tenant=${s.tenantId} status=${s.status}`);
      console.log(`  in : ${s.customerInput}`);
      console.log(`  out: ${s.finalReply}`);
    }
  }
}

main();
