// Jalankan: npx tsx src/scripts/benchmark-nlu-models.ts
// Benchmark perbandingan model NLU (MiniMax-M2.7-highspeed vs deepseek-v4-flash) pada 20 kasus.
// Aturan baru: timeout env-driven (LLM_TIMEOUT_NLU_MS, default 15000), retry-once transient (backoff 400ms),
// ekstraksi reasoning_content saat content kosong, validasi intents terhadap VALID_INTENTS.
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const API_KEY = process.env.LLM_API_KEY || '';
const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_NLU_MS || 15000);

const VALID_INTENTS = [
  'greeting',
  'provide_location',
  'ask_price',
  'ask_schedule',
  'express_interest',
  'faq_question',
  'affirmation',
  'negation',
  'complaint',
  'medical_query',
  'off_topic',
];

const SYSTEM_PROMPT = `Kamu adalah NLU intent classifier untuk chatbot WhatsApp klinik bayi & ibu (moms & baby spa). Klasifikasikan pesan customer ke SATU ATAU LEBIH intent berikut:
- greeting: sapaan pembuka (halo, assalamualaikum, selamat pagi)
- provide_location: customer menyebut lokasi/alamat/kelurahan
- ask_price: menanyakan harga/biaya treatment
- ask_schedule: menanyakan jadwal/ketersediaan hari-jam spesifik
- express_interest: menyatakan minat/mau booking/reservasi
- faq_question: pertanyaan info umum treatment (usia, manfaat, durasi, cara kerja)
- affirmation: konfirmasi/iya/benar/setuju
- negation: penolakan/batal/tidak jadi
- complaint: keluhan/komplain layanan
- medical_query: keluhan medis/kesehatan bayi-ibu (demam, obat, perih, sesak)
- off_topic: di luar topik layanan

OUTPUT JSON SCHEMA ONLY:
{"intents":["intent1","intent2"],"entities":{"location_text":"string or omit","treatment_name":"string or omit"},"confidence":0.0 to 1.0}`;

const CASES: { text: string; expected: string[] }[] = [
  { text: 'halo bunda', expected: ['greeting'] },
  { text: 'assalamualaikum kak', expected: ['greeting'] },
  { text: 'saya di mulyosari sidoarjo', expected: ['provide_location'] },
  { text: 'aku tinggal di waru surabaya', expected: ['provide_location'] },
  { text: 'berapa harga pijat bayi', expected: ['ask_price'] },
  { text: 'pijat ibu hamil berapa ya bunda', expected: ['ask_price'] },
  { text: 'besok ada jadwal kosong jam 3 ga', expected: ['ask_schedule'] },
  { text: 'hari sabtu bisa booking ga', expected: ['ask_schedule'] },
  { text: 'mau dong booking', expected: ['express_interest'] },
  { text: 'saya tertarik nih dengan paket gold', expected: ['express_interest'] },
  { text: 'pijat bayi boleh dari umur berapa', expected: ['faq_question'] },
  { text: 'manfaat pijat bayi apa aja', expected: ['faq_question'] },
  { text: 'iya bener', expected: ['affirmation'] },
  { text: 'iya benar bu', expected: ['affirmation'] },
  { text: 'ga jadi ah', expected: ['negation'] },
  { text: 'tidak usah dulu deh', expected: ['negation'] },
  { text: 'bidannya telat banget nih', expected: ['complaint'] },
  { text: 'anak saya demam tinggi dikasih apa ya', expected: ['medical_query'] },
  { text: 'kamu punya pacar ga', expected: ['off_topic'] },
  { text: 'harga bawang naik terus ya', expected: ['off_topic'] },
];

function isTransientError(err: any): boolean {
  const code = err?.code || '';
  const msg = String(err?.message || '');
  const status = err?.response?.status || err?.status || 0;
  return code === 'ECONNABORTED' || /timeout/i.test(msg) || status === 429 || status >= 500;
}

async function callOnce(model: string, text: string): Promise<string> {
  const resp = await axios.post(
    `${BASE_URL}/chat/completions`,
    {
      model,
      temperature: 0.1,
      max_tokens: 256,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `[Utterance to classify]: "${text}"` },
      ],
    },
    {
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      timeout: TIMEOUT_MS,
    }
  );

  let raw = resp.data?.choices?.[0]?.message?.content?.trim() || '';
  if (!raw) {
    const reasoning = resp.data?.choices?.[0]?.message?.reasoning_content || '';
    const m = reasoning.match(/\{[\s\S]*?"intents"[\s\S]*?\}/);
    if (m) raw = m[0];
  }
  if (!raw) throw new Error('Empty response content from LLM');

  let clean = raw.trim();
  if (clean.startsWith('```')) {
    clean = clean.replace(/^```(json)?\n?/i, '').replace(/\n?```$/, '');
  }
  return clean;
}

async function classify(model: string, text: string): Promise<{ intents: string[]; ms: number; retried: boolean; source: string }> {
  const start = Date.now();
  let retried = false;
  try {
    let content: string;
    try {
      content = await callOnce(model, text);
    } catch (err: any) {
      if (!isTransientError(err)) throw err;
      retried = true;
      console.log(`  (retry transient: ${err?.message})`);
      await new Promise((r) => setTimeout(r, 400));
      content = await callOnce(model, text);
    }
    const parsed = JSON.parse(content);
    const intents = Array.isArray(parsed.intents) ? parsed.intents.filter((i: string) => VALID_INTENTS.includes(i)) : [];
    return { intents, ms: Date.now() - start, retried, source: 'llm' };
  } catch (err: any) {
    return { intents: [], ms: Date.now() - start, retried, source: `ERROR:${err?.message || String(err)}` };
  }
}

function pctl(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function runModel(model: string) {
  console.log(`\n========== MODEL: ${model} ==========`);
  const times: number[] = [];
  let pass = 0;
  let retries = 0;

  for (const c of CASES) {
    const res = await classify(model, c.text);
    times.push(res.ms);
    if (res.retried) retries++;
    const hit = c.expected.some((e) => res.intents.includes(e));
    if (hit) pass++;
    const got = res.intents.length > 0 ? res.intents.join(',') : res.source;
    console.log(`${hit ? '✅' : '❌'} ${c.text} => [${got}] (${res.ms}ms) expected=${c.expected.join('|')}`);
  }

  times.sort((a, b) => a - b);
  const acc = ((pass / CASES.length) * 100).toFixed(1);
  console.log(`\n--- ${model} SUMMARY ---`);
  console.log(`Akurasi (intent expected masuk): ${pass}/${CASES.length} = ${acc}%`);
  console.log(`Latency: avg=${Math.round(times.reduce((a, b) => a + b, 0) / times.length)}ms p50=${pctl(times, 50)}ms p95=${pctl(times, 95)}ms max=${Math.max(...times)}ms`);
  console.log(`Retry transient: ${retries}`);
  return { model, acc: pass / CASES.length, times };
}

async function main() {
  if (!API_KEY || API_KEY.startsWith('mock')) {
    console.error('LLM_API_KEY tidak valid. Abort.');
    process.exit(1);
  }
  const models = ['MiniMax-M2.7-highspeed', 'deepseek-v4-flash', 'qwen3.7-flash-2026-07-15'];
  const results = [];
  for (const m of models) {
    results.push(await runModel(m));
  }
  console.log(`\n========== PERBANDINGAN ==========`);
  for (const r of results) {
    console.log(`${r.model.padEnd(28)}: akurasi=${(r.acc * 100).toFixed(1).padStart(5)}%  p50=${String(pctl(r.times, 50)).padStart(5)}ms  p95=${String(pctl(r.times, 95)).padStart(5)}ms`);
  }
}

main();
