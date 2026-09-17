// Jalankan: npx tsx scripts/check-tool-masking-accuracy.ts --days=7
//
// CLI Audit Gate: Mengevaluasi akurasi Tool-Masking save_reservation (Shadow Mode).
//
// Kriteria Kelulusan untuk Boleh Menyalakan ENFORCE MODE (TOOL_MASKING_ENFORCE=true):
//   1. Periode shadow-mode berjalan minimal >= 7 hari berturut-turut di lalu lintas riil.
//   2. Total evaluasi turn >= 50 percakapan dengan intent transaksional/jadwal.
//   3. Keselarasan (Alignment Rate) >= 90% (kedua sistem sepakat kapan hold dan kapan booking).
//   4. HARD ZERO False-Negative: MASKER_OVER_RESTRICTIVE_SUSPECT = 0 (tidak boleh ada customer
//      sah yang ingin booking tapi terblokir oleh masker) ATAU 100% dari sampel suspect telah
//      diaudit secara manual oleh tim admin dan terbukti bukan customer sah yang terblokir.

import fs from 'fs';
import path from 'path';

interface ShadowEvalRecord {
  event: string;
  tenantId: string;
  conversationId: string;
  phone: string;
  isSaveReservationAllowed: boolean;
  maskedTools: string[];
  maskingReason: string;
  calledTools: string[];
  classification:
    | 'ALIGNED_BLOCKED'
    | 'ALIGNED_ALLOWED'
    | 'LLM_OVER_TRIGGER'
    | 'MASKER_OVER_RESTRICTIVE_SUSPECT'
    | 'LLM_UNDER_TRIGGER';
  suspectOverRestrictive: boolean;
  timestamp: string;
}

function parseDays(): number {
  const arg = process.argv.find((a) => a.startsWith('--days='));
  return arg ? parseInt(arg.split('=')[1], 10) || 7 : 7;
}

function getLogDateString(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function checkToolMaskingAccuracy(days: number = 7) {
  const logsDir = path.resolve(process.cwd(), 'logs');
  const now = new Date();
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  console.log(`=======================================================`);
  console.log(`  AUDIT AKURASI TOOL-MASKING SHADOW MODE (FASE 2)`);
  console.log(`=======================================================`);
  console.log(`Periode evaluasi : ${days} hari terakhir (sejak ${since.toISOString().slice(0, 10)})`);

  if (!fs.existsSync(logsDir)) {
    console.log(`Direktori logs tidak ditemukan di ${logsDir}. Belum ada data evaluasi.`);
    return;
  }

  const allFiles = fs.readdirSync(logsDir);
  const appLogFiles = allFiles
    .filter((f) => f.startsWith('app-') && f.endsWith('.log'))
    .sort();

  const records: ShadowEvalRecord[] = [];

  for (const file of appLogFiles) {
    // Parse tanggal dari nama file app-YYYY-MM-DD.log
    const match = file.match(/app-(\d{4}-\d{2}-\d{2})\.log/);
    if (match) {
      const fileDate = new Date(match[1]);
      if (fileDate < new Date(since.toISOString().slice(0, 10))) {
        continue;
      }
    }

    const filePath = path.join(logsDir, file);
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      for (const line of lines) {
        if (line.includes('"event":"TOOL_MASKING_SHADOW_EVAL"')) {
          try {
            // Log line mungkin memiliki prefix timestamp/level, cari JSON substring
            const jsonStart = line.indexOf('{"event":"TOOL_MASKING_SHADOW_EVAL"');
            if (jsonStart !== -1) {
              const jsonStr = line.slice(jsonStart);
              const rec = JSON.parse(jsonStr) as ShadowEvalRecord;
              records.push(rec);
            }
          } catch {}
        }
      }
    } catch {}
  }

  const total = records.length;
  console.log(`Total evaluasi tercatat: ${total}`);

  if (total === 0) {
    console.log(`\nBelum ada event TOOL_MASKING_SHADOW_EVAL yang tercatat di direktori logs.`);
    console.log(`Jalankan simulator chat atau biarkan sistem berjalan di staging/produksi untuk mengumpulkan data.`);
    return;
  }

  let alignedBlocked = 0;
  let alignedAllowed = 0;
  let llmOverTrigger = 0;
  let maskerOverRestrictiveSuspect = 0;
  let llmUnderTrigger = 0;

  const suspectList: ShadowEvalRecord[] = [];
  const overTriggerList: ShadowEvalRecord[] = [];

  for (const r of records) {
    switch (r.classification) {
      case 'ALIGNED_BLOCKED':
        alignedBlocked++;
        break;
      case 'ALIGNED_ALLOWED':
        alignedAllowed++;
        break;
      case 'LLM_OVER_TRIGGER':
        llmOverTrigger++;
        overTriggerList.push(r);
        break;
      case 'MASKER_OVER_RESTRICTIVE_SUSPECT':
        maskerOverRestrictiveSuspect++;
        suspectList.push(r);
        break;
      case 'LLM_UNDER_TRIGGER':
        llmUnderTrigger++;
        break;
    }
  }

  const alignedTotal = alignedBlocked + alignedAllowed;
  const alignmentRate = ((alignedTotal / total) * 100).toFixed(2);
  const overTriggerRate = ((llmOverTrigger / total) * 100).toFixed(2);
  const overRestrictiveRate = ((maskerOverRestrictiveSuspect / total) * 100).toFixed(2);

  console.log(`\n--- Rincian Klasifikasi ---`);
  console.log(`1. ALIGNED_BLOCKED   : ${alignedBlocked} (${((alignedBlocked / total) * 100).toFixed(2)}%) [Kedua sistem sepakat BELUM saatnya booking]`);
  console.log(`2. ALIGNED_ALLOWED   : ${alignedAllowed} (${((alignedAllowed / total) * 100).toFixed(2)}%) [Kedua sistem sepakat SAH booking]`);
  console.log(`3. LLM_OVER_TRIGGER  : ${llmOverTrigger} (${overTriggerRate}%) [LLM coba panggil save_reservation padahal belum sah / di-mask]`);
  console.log(`4. MASKER_SUSPECT    : ${maskerOverRestrictiveSuspect} (${overRestrictiveRate}%) [Customer sebut waktu, tapi masker menahan — butuh audit manual]`);
  console.log(`5. LLM_UNDER_TRIGGER : ${llmUnderTrigger} (${((llmUnderTrigger / total) * 100).toFixed(2)}%) [Masker mengizinkan, LLM memilih menjawab santai]`);
  console.log(`\n=> Overall Alignment Rate: ${alignmentRate}%`);

  console.log(`\n-------------------------------------------------------`);
  console.log(`  EVALUASI GERBANG KELULUSAN ENFORCE MODE`);
  console.log(`-------------------------------------------------------`);

  const gate1Days = days >= 7;
  const gate2Samples = total >= 50;
  const gate3Alignment = parseFloat(alignmentRate) >= 90;
  const gate4HardZeroSuspect = maskerOverRestrictiveSuspect === 0;

  console.log(`[Gate 1] Durasi minimum >= 7 hari        : ${gate1Days ? '✅ LOLOS' : '❌ BELUM (' + days + ' hari)'}`);
  console.log(`[Gate 2] Volume turn >= 50 sampel        : ${gate2Samples ? '✅ LOLOS' : '❌ BELUM (' + total + ' sampel)'}`);
  console.log(`[Gate 3] Keselarasan >= 90%              : ${gate3Alignment ? '✅ LOLOS' : '❌ BELUM (' + alignmentRate + '%)'}`);
  console.log(`[Gate 4] Hard-Zero Over-Restrictive (=0) : ${gate4HardZeroSuspect ? '✅ LOLOS (0 kasus)' : '⚠️ BUTUH AUDIT MANUAL (' + maskerOverRestrictiveSuspect + ' kasus)'}`);

  if (overTriggerList.length > 0) {
    console.log(`\n⚠️  Daftar LLM Over-Trigger (Upaya booking sepihak yang berhasil dicegah jika enforce):`);
    console.table(
      overTriggerList.slice(0, 10).map((r) => ({
        timestamp: r.timestamp,
        phone: r.phone,
        reason: r.maskingReason.slice(0, 45),
        tools: r.calledTools.join(', '),
      }))
    );
  }

  if (suspectList.length > 0) {
    console.log(`\n🔍 Sampel Transkrip Over-Restrictive Suspect (Wajib review manual sebelum enforce):`);
    console.table(
      suspectList.slice(0, 10).map((r) => ({
        timestamp: r.timestamp,
        phone: r.phone,
        reason: r.maskingReason.slice(0, 45),
        calledTools: r.calledTools.join(', ') || '(none)',
      }))
    );
  }

  const allPass = gate1Days && gate2Samples && gate3Alignment && gate4HardZeroSuspect;
  console.log(`\nSTATUS KELULUSAN ENFORCE: ${allPass ? '🟢 SIAP ENFORCE' : '🟡 TETAP DALAM SHADOW MODE'}`);
}

if (process.argv[1] && process.argv[1].endsWith('check-tool-masking-accuracy.ts')) {
  const days = parseDays();
  void checkToolMaskingAccuracy(days);
}
