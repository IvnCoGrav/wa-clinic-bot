# PHASE 4: PENGURASAN ARSITEKTUR AGENTIC & MINIMALISASI REGEX

> **Estimasi Total:** 1 Minggu Kerja  
> **Prasyarat:** Phase 3 selesai (prompt sudah berbasis database).  
> **Tujuan Strategis:** Mengintegrasikan `CircuitBreaker` pada pemanggilan LLM agar bot langsung fail-fast (<2s) saat provider primer mengalami downtime, serta mereduksi ketergantungan pada regex mutator semantik di `sanitizer.ts` minimal 50% sesuai Mandat Minimal-Regex.

---

## 🔹 MIKRO-TASK 4.1 — Integrasi CircuitBreaker pada executeChatCompletion (ID: A3-03)

### 1. Masalah & Lokasi Kode
Di `src/v3/agent/agent-runner.ts` baris 155–194:
```typescript
private static async executeChatCompletion(params: { ... }): Promise<any> {
  // Setiap request memanggil axios primer, jika error baru fallback ke DeepSeek
}
```
Jika provider utama (OpenAI) down, setiap request customer harus menunggu timeout 15 detik. Jika ada 10 pesan berturut-turut, semua harus menunggu 15 detik sebelum fallback.

### 2. Modifikasi: `src/v3/agent/agent-runner.ts`
Import dan pasang instance `CircuitBreaker` singleton untuk endpoint LLM V3:

```typescript
import { CircuitBreaker } from '../../utils/circuit-breaker';

// Inisialisasi CircuitBreaker di level file:
const v3LlmCircuitBreaker = new CircuitBreaker(
  async (url: string, payload: any, headers: any) => {
    const response = await axios.post(url, payload, { headers, timeout: 15000 });
    return response.data;
  },
  async (url: string, payload: any, headers: any) => {
    const fallbackApiKey = process.env.LLM_FALLBACK_API_KEY || '';
    const fallbackBaseUrl = (process.env.LLM_FALLBACK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
    const fallbackModel = process.env.AI_MODEL_FALLBACK || 'deepseek-chat';
    const fallbackPayload = { ...payload, model: fallbackModel };
    const fallbackHeaders = { Authorization: `Bearer ${fallbackApiKey}`, 'Content-Type': 'application/json' };
    
    console.warn(`[CIRCUIT BREAKER FALLBACK] Executing fallback to ${fallbackModel}...`);
    const fallbackResponse = await axios.post(`${fallbackBaseUrl}/chat/completions`, fallbackPayload, {
      headers: fallbackHeaders,
      timeout: 20000,
    });
    return fallbackResponse.data;
  },
  {
    name: 'V3 LLM Primary Gateway',
    failureThreshold: 0.5, // 50% gagal dari 6 request terakhir
    slidingWindowSize: 6,
    cooldownPeriodMs: 45000, // 45 detik cooldown sebelum probe HALF_OPEN
  }
);
```

Perbarui `executeChatCompletion`:
```typescript
private static async executeChatCompletion(params: {
  payload: any;
  tenantId: string;
  phone: string;
  conversationId: string;
  baseUrl: string;
  apiKey: string;
  selectedModel: string;
}): Promise<any> {
  const url = `${params.baseUrl}/chat/completions`;
  const headers = { Authorization: `Bearer ${params.apiKey}`, 'Content-Type': 'application/json' };
  
  return await v3LlmCircuitBreaker.execute(url, params.payload, headers);
}
```

### 3. Acceptance Test & Verifikasi
Buat unit test di `tests/unit/v3/circuit-breaker-llm.test.ts`:
1. Simulasikan 3 pemanggilan gagal beruntun (mock axios reject).
2. Periksa status circuit breaker: `v3LlmCircuitBreaker.getState() === 'OPEN'`.
3. Panggilan ke-4 harus langsung dialihkan ke fallback function dalam <50ms tanpa menyentuh primary url sama sekali.
**Kriteria Lolos:** Fail-fast aktif, latensi saat primary down turun dari 15.000ms menjadi <100ms.

---

## 🔹 MIKRO-TASK 4.2 — Evaluasi & Pangkas Semantic Regex di Sanitizer (ID: A1-05)

### 1. Masalah & Lokasi Kode
Di `src/v3/guardrails/sanitizer.ts`:
Fungsi `cleanOutboundReply` memanggil 4 regex semantic-mutator:
- `stripEnglishLeakage` (mengganti kata English di tengah kalimat)
- `sanitizeFirstPersonPronoun` (mengganti kata ganti saya -> kami)
- `sanitizeUnpromptedStrMention` (mengganti sebutan STR)
- `sanitizeFollowUpGreetingRepetition` (memotong salam di awal pesan lanjutan)

Tindakan ini melanggar *Mandat Minimalisasi Regex & Larangan Mutilasi Semantik* (`AGENTS.md`).

### 2. Modifikasi: `src/v3/guardrails/sanitizer.ts`
1. Karena Phase 1 (Forced Tool-calling + Fact Validator) dan Phase 3.2 (Prompt persona via DB) sudah aktif, LLM sudah mematuhi larangan bahasa Inggris dan kata ganti "kami" melalui *Positive Few-Shot Exemplars*.
2. Hapus `stripEnglishLeakage` dan `sanitizeFirstPersonPronoun` dari alur eksekusi `cleanOutboundReply`.
3. Sederhanakan `sanitizeFollowUpGreetingRepetition` agar HANYA memotong sapaan jika pesan terdiri dari 2 paragraf dan paragraf pertama murni sapaan duplikat (bukan pemotongan regex global).
4. Pertahankan regex format-only:
   - Tag thinking `<think>` dan `[THINKING]`
   - Markdown codeblock fences
   - Format asterisk tunggal harga `*Rp XX.XXX*`
   - Normalisasi whitespace & double newline

### 3. Acceptance Test & Verifikasi
1. Ambil 30 sampel balasan dari live-chat/test-results.
2. Jalankan output sanitizer baru.
3. Hitung jumlah regex semantic-guard aktif di `sanitizer.ts`:
   - Sebelum: 8 fungsi/pattern semantic regex.
   - Sesudah: ≤ 3 regex teknis.
   - Penurunan: ≥ 50%.
4. Jalankan `npm run eval:numeric` & `npm test`.
**Kriteria Lolos:** Seluruh test tetap hijau dan tidak ada teks bahasa alami yang termutilasi.

---

## 📋 Checklist Validasi Phase 4
- [ ] Task 4.1 selesai: `CircuitBreaker` aktif pada `executeChatCompletion` dan teruji fail-fast.
- [ ] Task 4.2 selesai: semantic regex di `sanitizer.ts` dipangkas ≥50%.
- [ ] Jalankan regression suite: `npm test`.
