/**
 * scripts/sync-live-knowledge.ts — Safe-merge dua arah RAG (Plan 4 Phase 2, Issue #46).
 *
 * Masalah: `seed-faq.ts` versi lama memakai `deleteMany()` destruktif; 14 kurasi
 * admin live (dashboard) tidak ada di seed lokal dan akan TERHAPUS bila seed
 * dijalankan. Skrip ini menggabungkan kurasi live ke `src/cli/faq-corpus.ts`
 * TANPA menghapus satu pun entri manual.
 *
 * Aturan merge:
 * - Kunci identitas: judul ternormalisasi (trim + lowercase + collapse spasi).
 * - Judul live yang belum ada di korpus → APPEND ke blok marker MERGED.
 * - Judul yang sudah ada (overlap) → TIDAK ditimpa otomatis; dicantumkan di
 *   laporan sebagai `overlap-diff` bila konten berbeda (kurasi manual lokal
 *   bisa lebih baru, mis. artikel SOP "bayi jatuh") untuk review manusia.
 * - Idempoten: eksekusi ulang hanya mengganti isi blok marker, tidak duplikat.
 *
 * Pemakaian:
 *   npx tsx scripts/sync-live-knowledge.ts            # merge + tulis korpus
 *   npx tsx scripts/sync-live-knowledge.ts --check    # hanya lapor drift (exit 1 bila ada judul live yg hilang)
 */
import * as fs from 'fs';
import * as path from 'path';

const SNAPSHOT = path.resolve(__dirname, '../docs/live-snapshots/knowledge-chunks-2026-09-12.json');
const CORPUS = path.resolve(__dirname, '../src/cli/faq-corpus.ts');

const MARK_BEGIN = '// === BEGIN MERGED LIVE CURATIONS (scripts/sync-live-knowledge.ts) ===';
const MARK_END = '// === END MERGED LIVE CURATIONS ===';

function normTitle(s: string): string {
  return (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Perbaikan mojibake CP437 pada snapshot live (temuan Plan 4 Phase 2).
 * File `knowledge-chunks-2026-09-12.json` menyimpan byte UTF-8 yang dibaca
 * sebagai CP437 saat dump (mis. 😊 U+1F60A → "≡ƒÿè"). Invers eksak:
 * kelompokkan run karakter non-ASCII yang terpetakan di CP437, encode kembali
 * ke byte, decode sebagai UTF-8. Run yang gagal decode dibiarkan utuh
 * (teks legit seperti "é" satuan tidak tersentuh). ASCII & astral asli
 * (emoji/CJK, tak terpetakan di CP437) selalu lolos apa adanya.
 */
const CP437_HIGH =
  'ÇüéâäàåçêëèïîìÄÅ' +
  'ÉæÆôöòûùÿÖÜ¢£¥₧ƒ' +
  'áíóúñÑªº¿⌐¬½¼¡«»' +
  '░▒▓│┤╡╢╖╕╣║╗╝╜╛┐' +
  '└┴┬├─┼╞╟╚╔╩╦╠═╬╧' +
  '╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀' +
  'αßΓπΣσµτΦΘΩδ∞φε∩' +
  '≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

const CP437_ENCODE = new Map<string, number>();
for (let i = 0; i < CP437_HIGH.length; i++) CP437_ENCODE.set(CP437_HIGH[i], 0x80 + i);

function repairCp437Mojibake(s: string): string {
  let out = '';
  let run: number[] = [];
  const flush = () => {
    if (run.length === 0) return;
    let ok = false;
    try {
      const decoded = Buffer.from(run).toString('utf-8');
      if (decoded && !decoded.includes('�')) {
        out += decoded;
        ok = true;
      }
    } catch {}
    if (!ok) {
      for (const b of run) out += b < 0x80 ? String.fromCharCode(b) : CP437_HIGH[b - 0x80];
    }
    run = [];
  };
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp > 127 && CP437_ENCODE.has(ch)) {
      run.push(CP437_ENCODE.get(ch)!);
    } else {
      flush();
      out += ch;
    }
  }
  flush();
  return out;
}

// Self-test tabel (escape eksplisit agar tak bergantung pada encoding editor):
// "≡ƒÿè" = U+2261 U+0192 U+00FF U+00E8 → byte F0 9F 98 8A → U+1F60A;
// "≡ƒñù" = U+2261 U+0192 U+00F1 U+00F9 → byte F0 9F A4 97 → U+1F917.
const _cp437SelfTest = repairCp437Mojibake('≡ƒÿè ≡ƒñù');
if (_cp437SelfTest !== '😊 🤗') {
  throw new Error(`[SYNC-KNOWLEDGE] Tabel CP437 tidak valid, perbaikan mojibake nonaktif: ${_cp437SelfTest}`);
}

interface LiveRow {
  tenant_id?: string;
  source_type?: string;
  title?: string;
  content?: string;
  keywords?: string | null;
}

function loadLiveRows(): LiveRow[] {
  const raw = fs.readFileSync(SNAPSHOT, 'utf-8');
  const rows: LiveRow[] = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      rows.push(JSON.parse(t));
    } catch {
      console.warn(`[SYNC-KNOWLEDGE] Baris snapshot tak valid, dilewati: ${t.slice(0, 80)}`);
    }
  }
  return rows.filter((r) => (r.source_type || 'FAQ') === 'FAQ');
}

/** Pecah konten live "Pertanyaan: Q\nJawaban: A" kembali ke {question, answer}. */
function splitContent(row: LiveRow): { question: string; answer: string } {
  const content = (row.content || '').trim();
  const marker = '\nJawaban:';
  const idx = content.indexOf(marker);
  if (idx !== -1) {
    let q = content.slice(0, idx).trim();
    if (q.toLowerCase().startsWith('pertanyaan:')) q = q.slice('pertanyaan:'.length).trim();
    const a = content.slice(idx + marker.length).trim();
    if (q && a) return { question: q, answer: a };
  }
  return { question: (row.title || '').trim(), answer: content };
}

function esc(s: string): string {
  return JSON.stringify(s);
}

async function main() {
  const checkOnly = process.argv.includes('--check');

  const liveRows = loadLiveRows();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const corpusMod = await import('../src/cli/faq-corpus');
  const corpus: Array<{ question: string; answer: string; keywords?: string }> = corpusMod.faqs;

  const corpusByTitle = new Map<string, { question: string; answer: string }>();
  for (const f of corpus) corpusByTitle.set(normTitle(f.question), f);

  const missing: LiveRow[] = [];
  const overlapDiff: string[] = [];
  const seenLive = new Set<string>();
  for (const row of liveRows) {
    const key = normTitle(row.title || '');
    if (!key || seenLive.has(key)) continue;
    seenLive.add(key);
    const local = corpusByTitle.get(key);
    if (!local) {
      missing.push(row);
    } else {
      const { answer } = splitContent(row);
      if (answer && normTitle(answer) !== normTitle(local.answer || '')) {
        overlapDiff.push(row.title || key);
      }
    }
  }

  console.log(`[SYNC-KNOWLEDGE] Live FAQ: ${liveRows.length} | Korpus lokal: ${corpus.length} | Hilang: ${missing.length} | Overlap-beda-isi: ${overlapDiff.length}`);
  for (const t of overlapDiff) console.log(`  [overlap-diff] ${t}`);
  for (const r of missing) console.log(`  [missing] ${r.title}`);

  if (checkOnly) {
    if (missing.length > 0) {
      console.error('[SYNC-KNOWLEDGE] DRIFT: korpus seed belum mencakup kurasi live di atas.');
      process.exit(1);
    }
    console.log('[SYNC-KNOWLEDGE] OK: korpus mencakup seluruh judul live.');
    return;
  }

  if (missing.length === 0) {
    console.log('[SYNC-KNOWLEDGE] Tidak ada yang perlu di-merge.');
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const entries = missing
    .map((row) => {
      const { question: rawQ, answer: rawA } = splitContent(row);
      // Snapshot live mengandung mojibake CP437 (byte UTF-8 dibaca sebagai CP437
      // saat dump) — pulihkan sebelum masuk korpus agar RAG tidak menyajikan
      // karakter rusak ke customer.
      const question = repairCp437Mojibake(rawQ);
      const answer = repairCp437Mojibake(rawA);
      const kw = repairCp437Mojibake((row.keywords || '').trim());
      const lines = [
        '  {',
        `    // Kurasi admin live (merged ${today}, source: docs/live-snapshots/knowledge-chunks-2026-09-12.json)`,
        `    "question": ${esc(question)},`,
        `    "answer": ${esc(answer)},`,
      ];
      if (kw) lines.push(`    "keywords": ${esc(kw)}`);
      else lines.push(`    "keywords": ""`);
      lines.push('  },');
      return lines.join('\n');
    })
    .join('\n');

  const block = `${MARK_BEGIN}\n${entries}\n${MARK_END}`;
  let text = fs.readFileSync(CORPUS, 'utf-8');
  if (text.includes(MARK_BEGIN)) {
    const re = new RegExp(`${MARK_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${MARK_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
    text = text.replace(re, block);
  } else {
    const closeIdx = text.lastIndexOf('\n];');
    if (closeIdx === -1) throw new Error('Penutup array faqs (\\n];) tidak ditemukan di faq-corpus.ts');
    text = `${text.slice(0, closeIdx)}\n${block}\n];${text.slice(closeIdx + '\n];'.length)}`;
  }
  fs.writeFileSync(CORPUS, text, 'utf-8');
  console.log(`[SYNC-KNOWLEDGE] Ditambahkan ${missing.length} kurasi live ke blok MERGED di src/cli/faq-corpus.ts. REVIEW & COMMIT.`);
}

main().catch((e) => {
  console.error('[SYNC-KNOWLEDGE ERROR]', e.message);
  process.exit(1);
});
