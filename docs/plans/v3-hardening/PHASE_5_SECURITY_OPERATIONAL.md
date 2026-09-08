# PHASE 5: KEAMANAN INGEST, THROTTLING & PII PROTECTION

> **Estimasi Total:** 3–5 Hari Kerja  
> **Prasyarat:** Phase 3 selesai (dapat dikerjakan paralel dengan Phase 4).  
> **Tujuan Strategis:** Mengamankan logging dari kebocoran data pribadi (PII), menstandarisasi 12 titik logging `console.*` unformatted di V3 menjadi structured log terindeks, memastikan rate limiting aktif di layer aplikasi, dan melengkapi webhook V3 dengan queueing sebelum diaktifkan.

---

## 🔹 MIKRO-TASK 5.1 — PII Masking Engine pada Logger (ID: A5-03)

### 1. Masalah & Lokasi Kode
Di `src/v3/agent/agent-runner.ts` baris 516:
```typescript
console.log(`[V3 AGENT TOOL EXECUTE] Tool: "${fnName}", Args:`, JSON.stringify(fnArgs));
```
Objek `fnArgs` mencetak data sensitif seperti nomor telepon, alamat jalan/perumahan, RT/RW, dan nama anak secara terbuka ke stdout dan buffer file log.

### 2. File Baru: `src/utils/pii-masker.ts`
Buat utilitas penyamaran data pribadi pelanggan:

```typescript
/**
 * src/utils/pii-masker.ts
 * Menyensor nomor telepon, nama anak, dan detail alamat pada log audit & console.
 */

export function maskPhoneNumber(phone?: string | null): string {
  if (!phone || typeof phone !== 'string') return '';
  const clean = phone.replace(/[^0-9]/g, '');
  if (clean.length <= 6) return '***';
  return `${clean.slice(0, 4)}****${clean.slice(-3)}`;
}

export function maskAddress(address?: string | null): string {
  if (!address || typeof address !== 'string') return '';
  // Sensor angka nomor rumah, blok, RT/RW
  return address
    .replace(/\b(no\.?\s*\d+|rt\s*\d+|rw\s*\d+|blok\s*[a-z0-9]+)\b/gi, '***')
    .replace(/\b(\d{1,4})\b/g, '***');
}

export function maskToolArgsForLogging(toolName: string, args: Record<string, any>): Record<string, any> {
  if (!args || typeof args !== 'object') return {};
  const masked = { ...args };

  if (masked.streetDetail) masked.streetDetail = maskAddress(masked.streetDetail);
  if (masked.customerName) masked.customerName = `${String(masked.customerName).slice(0, 2)}***`;
  if (masked.childName) masked.childName = `${String(masked.childName).slice(0, 1)}***`;
  if (masked.phone) masked.phone = maskPhoneNumber(masked.phone);
  if (masked.notes) masked.notes = '[CATATAN DISENSOR]';

  return masked;
}
```

### 3. Modifikasi: `src/v3/agent/agent-runner.ts` baris 516:
```typescript
import { maskToolArgsForLogging } from '../../utils/pii-masker';

// SEBELUM:
// console.log(`[V3 AGENT TOOL EXECUTE] Tool: "${fnName}", Args:`, JSON.stringify(fnArgs));

// SESUDAH:
console.log(`[V3 AGENT TOOL EXECUTE] Tool: "${fnName}", Args:`, JSON.stringify(maskToolArgsForLogging(fnName, fnArgs)));
```

---

## 🔹 MIKRO-TASK 5.2 — Standarisasi Structured Logger di V3 (ID: A4-06)

### 1. Masalah & Lokasi Kode
Terdapat 12 titik pemanggilan `console.*` unformatted di:
- `src/v3/agent/agent-runner.ts` (baris 175, 516, 678, 722)
- `src/v3/state/goal-tracker.ts` (baris 127, 175)
- `src/v3/ingest/webhook-v3.controller.ts` (baris 112)
- `src/v3/tools/*.tool.ts` (6 titik error logging)

### 2. Modifikasi:
Gunakan pola structured log dengan JSON metadata:
```typescript
// Contoh di agent-runner.ts baris 722:
// SEBELUM:
// console.error('[V3 AGENT RUNNER ERROR]', err.response?.data || err.message);

// SESUDAH:
console.error(JSON.stringify({
  event: 'V3_AGENT_RUNNER_ERROR',
  tenantId,
  conversationId,
  phone: maskPhoneNumber(phone),
  error: err.response?.data || err.message,
  timestamp: new Date().toISOString(),
}));
```
Ganti seluruh 12 titik dengan objek event JSON terstruktur yang mencantumkan `event`, `tenantId`, dan `timestamp`.

---

## 🔹 MIKRO-TASK 5.3 — Verifikasi & Pengetatan Application-Level Rate Limiter (ID: A5-04)

### 1. Masalah & Lokasi Kode
Di `src/app.ts` baris 89–94:
Global HTTP rate-limit sengaja mengecualikan URL `/webhook` karena WAHA mengirim event secara burst. Namun, jika application-level rate limiter tidak ketat, sistem rentan terhadap DoS.

### 2. Modifikasi:
Pastikan `src/services/abuse-detection.service.ts` aktif memeriksa frekuensi per nomor telepon di dalam `src/routes/webhook.route.ts` sebelum memasukkan pesan ke antrean:
- Batas maksimal: 15 pesan per 60 detik per nomor telepon.
- Jika melebihi batas: otomatis tandai abuse dan tolak pemrosesan ke LLM tanpa membalas pesan (silent drop bot).

---

## 🔹 MIKRO-TASK 5.4 — Pengintegrasian Queue pada Webhook V3 Sebelum Go-Live (ID: A5-02)

### 1. Masalah & Lokasi Kode
Di `src/v3/ingest/webhook-v3.controller.ts` baris 81–91:
Webhook V3 saat ini memanggil `V3AgentRunner.processMessage` secara langsung dan unthrottled di dalam anonymous async IIFE tanpa melewati antrean (`queueService`). Controller ini saat ini **belum didaftarkan di `src/app.ts`**.

### 2. Aturan Prasyarat Go-Live:
DILARANG mendaftarkan `webhookV3Routes` ke `src/app.ts` sebelum pesan dialirkan melalui `queueService`:
```typescript
// Di src/v3/ingest/webhook-v3.controller.ts:
// Ganti baris 81-114 dengan pemanggilan antrean yang sama dengan webhook.route.ts:
await queueService.enqueueIncomingMessage({
  tenantId: DEFAULT_TENANT_ID,
  customerId: customer.id,
  conversationId: conversation.id,
  phone,
  chatId,
  incomingText: inboundText,
  rawPayload: payload,
  waMessageId,
});
```

---

## 📋 Checklist Validasi Phase 5
- [ ] Task 5.1 selesai: Log `[V3 AGENT TOOL EXECUTE]` tidak memuat nomor HP dan alamat mentah.
- [ ] Task 5.2 selesai: Seluruh 12 titik log V3 berformat JSON terstruktur.
- [ ] Task 5.3 selesai: Abuse detection service terkonfirmasi memblokir pesan burst >15 msg/menit per nomor.
- [ ] Task 5.4 selesai: Webhook V3 terhubung ke `queueService` jika ingin diaktifkan.
