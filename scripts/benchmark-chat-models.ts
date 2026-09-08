// Benchmark kualitas CHAT REPLY: deepseek-v4-flash vs MiniMax-M2.7-highspeed.
// Menguji: akurasi grounding (anti-halusinasi) pada knowledge reference + kepatuhan persona.
// Mode ad-hoc, bukan bagian dari test suite. Jalankan: npx tsx src/scripts/benchmark-chat-models.ts
import axios from 'axios';
import dotenv from 'dotenv';
import { BOT_PERSONA_PROMPT } from '../config/persona';
dotenv.config();

const BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const API_KEY = process.env.LLM_API_KEY || '';
const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_CHAT_MS || 15000);

// Referensi dokumen fakta (harga/durasi/usia). Sengaja TIDAK mencantumkan jam operasional,
// perbandingan antar-treatment, dan kebijakan pembayaran supaya bisa dideteksi fabrikasi.
const REFERENCE_DOC = `
[PIJAT BAYI] harga Rp150.000, durasi 60 menit, sesuai untuk bayi usia 1-12 bulan.
[PIJAT IBU HAMIL] harga Rp200.000, durasi 60 menit, sesuai ibu hamil.
[PIJAT NIFAS] harga Rp180.000, durasi 90 menit, untuk ibu setelah melahirkan.
[PAKET SILVER] harga Rp350.000, durasi 120 menit, sudah termasuk Pijat Bayi + Pijat Ibu Hamil.
[PAKET GOLD] harga Rp450.000, durasi 150 menit, sudah termasuk Pijat Ibu Hamil + Pijat Nifas + Pijat Bayi.
[NEBULIZER] harga Rp50.000, durasi 30 menit.
`;

const GROUND_TRUTH = `[DATA CUSTOMER (GROUND TRUTH)]
- Nama: Ani
- Layanan Aktif Saat Ini: Pijat Ibu Hamil
- Layanan yang Pernah Dipakai (Historis): Tidak ada
- Preferensi: child_age_months: 7`;

function buildSystemPrompt(): string {
  return `${BOT_PERSONA_PROMPT}

${GROUND_TRUTH}

TUGAS UTAMA:
Jawab pertanyaan customer tentang informasi/FAQ moms & baby spa berdasarkan Referensi Dokumen berikut:

${REFERENCE_DOC}

ATURAN BALASAN:
1. Lakukan analisis di bagian "REASONING" terhadap apa yang ditanyakan customer.
2. Tulis balasan ramah, hangat, dan informatif untuk customer di bagian "JAWABAN" (gunakan informasi dari referensi).
3. JIKA pertanyaan menyebut treatment: sebutkan fakta yang relevan dari referensi dengan nada rekomendasi personal.
4. JIKA TIDAK ADA fakta relevan di Referensi untuk pertanyaan (misal jam operasional, perbandingan, kebijakan pembayaran): JANGAN mengarang/menebak. Jelaskan ramah & profesional tanpa memalsukan fakta.
5. JANGAN pernah tulis "tanya ke tim kami", "tidak bisa memastikan harganya", "cek ke tim dulu", atau sejenisnya.
6. Panggil customer "Bunda", gunakan bahasa Indonesia hangat-sopan, emoji secukupnya.

FORMAT RESPONS (WAJIB JSON, jangan ada teks di luar JSON):
{
  "reasoning": "analisis Anda ...",
  "answer": "balasan Anda untuk customer"
}`;
}

const SYSTEM_PROMPT = buildSystemPrompt();

interface CaseT { q: string; note: string }

const CASES: CaseT[] = [
  { q: 'berapa harga pijat bayi?', note: 'harga pasti ada di referensi -> harus akurat (150rb)' },
  { q: 'pijat ibu hamil berapa lama dan berapa harganya ya?', note: 'durasi 60 menit & harga 200rb harus dari referensi' },
  { q: 'bayi saya umur 2 bulan, aman nggak kalau dipijat?', note: 'grounding: pijat bayi mulai usia 1-12 bulan' },
  { q: 'bayiku susah tidur terus, ada treatment yang bisa bantu nggak bu?', note: 'mode rekomendasi, sebutkan opsi relevan, nada empati' },
  { q: 'jam operasional kalian buka sampai jam berapa ya?', note: 'TIDAK ada di referensi -> WAJIB tidak mengarang jam' },
  { q: 'bandingin dong pijat ibu hamil sama pijat bayi, lebih bagus mana?', note: 'referensi tak punya perbandingan; jangan memihak/fabrikasi' },
  { q: 'berapa harga paket silver?', note: 'harga 350rb ada di referensi' },
  { q: 'kalau transfer besok ada biaya tambahan nggak kalau telat pelayanannya?', note: 'tidak ada data kebijakan -> jangan mengarang ketentuan' },
];

async function ask(model: string, c: CaseT): Promise<{ answer: string; reasoning: string; ms: number; error?: string }> {
  const start = Date.now();
  try {
    const resp = await axios.post(
      `${BASE_URL}/chat/completions`,
      {
        model,
        temperature: 0.7,
        max_tokens: 1024,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: c.q },
        ],
      },
      { headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }, timeout: TIMEOUT_MS }
    );
    if (!resp.data || !resp.data.choices) throw new Error('HTTP no body');
    const content = resp.data.choices[0].message.content;
    let p: any;
    try {
      let clean = (content || '').trim();
      if (clean.startsWith('```')) clean = clean.replace(/^```(json)?\n?/, '').replace(/\n?```$/, '').trim();
      p = JSON.parse(clean);
    } catch (e) {
      return { answer: '', reasoning: '', ms: Date.now() - start, error: 'JSON_PARSE_FAIL: ' + String(content).slice(0, 120) };
    }
    return { answer: p.answer || '', reasoning: p.reasoning || '', ms: Date.now() - start };
  } catch (err: any) {
    return { answer: '', reasoning: '', ms: Date.now() - start, error: (err?.message || String(err)).slice(0, 140) };
  }
}

async function main() {
  if (!API_KEY || API_KEY.startsWith('mock')) { console.error('LLM_API_KEY tidak valid. Abort.'); process.exit(1); }
  const models = ['deepseek-v4-flash', 'MiniMax-M2.7-highspeed'];
  for (const m of models) {
    console.log(`\n=============== MODEL: ${m} ===============`);
    const times: number[] = [];
    for (const c of CASES) {
      const r = await ask(m, c);
      times.push(r.ms);
      console.log(`\n--- [${r.ms}ms] ${c.q}`);
      console.log(`    note: ${c.note}`);
      if (r.error) { console.log(`    ERROR: ${r.error}`); continue; }
      console.log(`    REASONING: ${String(r.reasoning).slice(0, 260)}`);
      console.log(`    ANSWER: ${String(r.answer).slice(0, 380)}`);
    }
    const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
    console.log(`\n--- ${m} latency: avg=${avg}ms max=${Math.max(...times)}ms ---`);
  }
}

main().catch((e) => { console.error('FAIL', e); process.exit(1); });