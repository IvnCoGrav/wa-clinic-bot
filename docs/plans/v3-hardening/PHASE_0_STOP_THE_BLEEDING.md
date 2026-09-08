# PHASE 0: STOP-THE-BLEEDING (QUICK WINS & HOTFIX KRITIS)

> **Estimasi Total:** 2–3 Hari Kerja  
> **Karakteristik:** Semua task independen, blast-radius sempit, risiko regresi rendah.  
> **Aturan Eksekusi:** Wajib di-commit & di-deploy terpisah per sub-task (bukan 1 PR gabungan).  

---

## 🔹 MIKRO-TASK 0.1 — Parser Tanggal Natural Indonesia (ID: A1-02)

### 1. Masalah & Lokasi Kode
Di `src/v3/tools/save-reservation.tool.ts` baris 129:
```typescript
const parsedDate = !isNaN(Date.parse(bookingDate)) ? new Date(bookingDate) : new Date();
```
`Date.parse()` bawaan JavaScript tidak mengenali nama hari/bulan bahasa Indonesia ("Sabtu", "September") dan istilah relatif ("besok", "lusa"). Akibatnya, input tanggal alami customer selalu jatuh ke `new Date()` (hari ini), sehingga jadwal reservasi tersimpan salah tanpa ada error.

### 2. File Baru: `src/utils/indonesian-date-parser.ts`
Buat modul utilitas parsing tanggal natural tanpa dependensi eksternal baru:

```typescript
/**
 * src/utils/indonesian-date-parser.ts
 * Parser tanggal bahasa Indonesia (deterministik, zero-dependency).
 * Menangani format relatif (besok, lusa), hari, nama bulan ID, dan jam.
 */

const INDONESIAN_MONTHS: Record<string, number> = {
  januari: 0, jan: 0,
  februari: 1, feb: 1,
  maret: 2, mar: 2,
  april: 3, apr: 3,
  mei: 4,
  juni: 5, jun: 5,
  juli: 6, jul: 6,
  agustus: 7, agu: 7, ags: 7,
  september: 8, sep: 8, sept: 8,
  oktober: 9, okt: 9,
  november: 10, nov: 10,
  desember: 11, des: 11,
};

const DAY_NAME_TO_INDEX: Record<string, number> = {
  minggu: 0, ahad: 0,
  senin: 1,
  selasa: 2,
  rabu: 3,
  kamis: 4,
  jumat: 5, jum'at: 5,
  sabtu: 6,
};

export interface ParsedIndonesianDate {
  date: Date;
  isRecognized: boolean;
  rawMatched: string;
}

export function parseIndonesianDate(input: string, referenceDate: Date = new Date()): ParsedIndonesianDate {
  if (!input || typeof input !== 'string') {
    return { date: referenceDate, isRecognized: false, rawMatched: '' };
  }

  const clean = input.toLowerCase().trim();
  const target = new Date(referenceDate.getTime());

  // 1. Standar ISO / YYYY-MM-DD
  const isoMatch = clean.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (isoMatch) {
    target.setFullYear(parseInt(isoMatch[1], 10), parseInt(isoMatch[2], 10) - 1, parseInt(isoMatch[3], 10));
    target.setHours(9, 0, 0, 0);
    return { date: target, isRecognized: true, rawMatched: isoMatch[0] };
  }

  // 2. Format Relatif: "hari ini", "besok", "lusa"
  if (clean.includes('lusa')) {
    target.setDate(target.getDate() + 2);
    target.setHours(9, 0, 0, 0);
    return { date: target, isRecognized: true, rawMatched: 'lusa' };
  }
  if (clean.includes('besok')) {
    target.setDate(target.getDate() + 1);
    target.setHours(9, 0, 0, 0);
    return { date: target, isRecognized: true, rawMatched: 'besok' };
  }
  if (clean.includes('hari ini')) {
    target.setHours(9, 0, 0, 0);
    return { date: target, isRecognized: true, rawMatched: 'hari ini' };
  }

  // 3. Tanggal dengan Nama Bulan Indonesia: "12 September", "12 September 2026", "tgl 5 okt"
  const dateMonthRegex = /\b(\d{1,2})\s+([a-z']+)(?:\s+(\d{4}))?\b/;
  const dmMatch = clean.match(dateMonthRegex);
  if (dmMatch && INDONESIAN_MONTHS[dmMatch[2]] !== undefined) {
    const day = parseInt(dmMatch[1], 10);
    const month = INDONESIAN_MONTHS[dmMatch[2]];
    const year = dmMatch[3] ? parseInt(dmMatch[3], 10) : target.getFullYear();
    target.setFullYear(year, month, day);
    target.setHours(9, 0, 0, 0);
    return { date: target, isRecognized: true, rawMatched: dmMatch[0] };
  }

  // 4. Hari dalam Pekan: "hari sabtu", "sabtu depan", "senin"
  for (const [dayName, targetDayIndex] of Object.entries(DAY_NAME_TO_INDEX)) {
    if (clean.includes(dayName)) {
      const currentDay = target.getDay();
      let diff = targetDayIndex - currentDay;
      if (diff <= 0) diff += 7; // Ambil hari yang terdekat di masa depan
      if (clean.includes('depan') && diff < 7) diff += 7;
      target.setDate(target.getDate() + diff);
      target.setHours(9, 0, 0, 0);
      return { date: target, isRecognized: true, rawMatched: dayName };
    }
  }

  // 5. Fallback ke Date.parse standar jika lolos
  const fallbackTs = Date.parse(input);
  if (!isNaN(fallbackTs)) {
    return { date: new Date(fallbackTs), isRecognized: true, rawMatched: input };
  }

  return { date: referenceDate, isRecognized: false, rawMatched: '' };
}
```

### 3. Modifikasi: `src/v3/tools/save-reservation.tool.ts`
Import parser di baris atas dan ganti baris 129:

```typescript
// Tambahkan di import bagian atas:
import { parseIndonesianDate } from '../../utils/indonesian-date-parser';

// Ganti baris 129:
// SEBELUM:
// const parsedDate = !isNaN(Date.parse(bookingDate)) ? new Date(bookingDate) : new Date();

// SESUDAH:
const parsedResult = parseIndonesianDate(bookingDate);
const parsedDate = parsedResult.date;
```

### 4. Acceptance Test & Verifikasi
Buat file test `tests/unit/v3/indonesian-date-parser.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { parseIndonesianDate } from '../../../src/utils/indonesian-date-parser';

describe('parseIndonesianDate', () => {
  const ref = new Date('2026-09-08T08:00:00.000Z'); // Selasa, 8 Sept 2026

  it('mengurai "besok pagi" menjadi H+1 (9 Sept)', () => {
    const res = parseIndonesianDate('besok pagi', ref);
    expect(res.isRecognized).toBe(true);
    expect(res.date.getDate()).toBe(9);
    expect(res.date.getMonth()).toBe(8); // Sept = 8
  });

  it('mengurai "lusa jam 10" menjadi H+2 (10 Sept)', () => {
    const res = parseIndonesianDate('lusa jam 10', ref);
    expect(res.isRecognized).toBe(true);
    expect(res.date.getDate()).toBe(10);
  });

  it('mengurai "Sabtu depan" menjadi Sabtu terdekat', () => {
    const res = parseIndonesianDate('Sabtu depan', ref);
    expect(res.isRecognized).toBe(true);
    expect(res.date.getDay()).toBe(6); // 6 = Sabtu
  });

  it('mengurai "12 September 2026"', () => {
    const res = parseIndonesianDate('12 September 2026', ref);
    expect(res.isRecognized).toBe(true);
    expect(res.date.getDate()).toBe(12);
    expect(res.date.getMonth()).toBe(8);
  });
});
```
Jalankan verifikasi:
```bash
npx vitest run tests/unit/v3/indonesian-date-parser.test.ts
```
**Kriteria Lolos:** 4/4 test hijau.

---

## 🔹 MIKRO-TASK 0.2 — Fail-Closed Webhook Ingest Secret (ID: A5-01)

### 1. Masalah & Lokasi Kode
Di `src/v3/ingest/webhook-v3.controller.ts` baris 19–26:
```typescript
const webhookSecret = process.env.WAHA_WEBHOOK_SECRET;
if (webhookSecret) {
  const clientSecret = (request.headers['x-webhook-secret'] || request.headers['x-waha-signature'] || '') as string;
  if (!clientSecret || !safeCompare(clientSecret, webhookSecret)) {
    return reply.status(401).send({ error: 'Unauthorized: Invalid secret.' });
  }
}
```
Jika `WAHA_WEBHOOK_SECRET` tidak terdefinisi di environment, blok if dilewati dan webhook menerima request tanpa autentikasi apa pun.

### 2. Modifikasi: `src/v3/ingest/webhook-v3.controller.ts`
Ubah baris 19–26 menjadi aturan fail-closed:

```typescript
// 1. Verifikasi Keamanan Secret Token (Fail-Closed)
const webhookSecret = process.env.WAHA_WEBHOOK_SECRET;
if (!webhookSecret) {
  console.error('[SECURITY FATAL] WAHA_WEBHOOK_SECRET is not configured on server.');
  return reply.status(500).send({ error: 'Server configuration error: Webhook secret is not defined.' });
}

const clientSecret = (request.headers['x-webhook-secret'] || request.headers['x-waha-signature'] || '') as string;
if (!clientSecret || !safeCompare(clientSecret, webhookSecret)) {
  return reply.status(401).send({ error: 'Unauthorized: Invalid or missing secret token.' });
}
```

### 3. Acceptance Test & Verifikasi
Kirim request simulasi menggunakan cURL atau Fastify inject test:
1. Tanpa header `x-webhook-secret`:
   ```bash
   curl -X POST http://localhost:3000/webhook/v3 -H "Content-Type: application/json" -d "{}"
   ```
   **Kriteria Lolos:** HTTP 401 `{"error":"Unauthorized: Invalid or missing secret token."}`
2. Dengan header `x-webhook-secret: token_salah`:
   **Kriteria Lolos:** HTTP 401 Unauthorized.
3. Dengan header `x-webhook-secret` cocok:
   **Kriteria Lolos:** Lolos ke layer pemrosesan event.

---

## 🔹 MIKRO-TASK 0.3 — Filter `tenant_id` Mutlak pada GoalTracker (ID: A2-06)

### 1. Masalah & Lokasi Kode
Di `src/v3/state/goal-tracker.ts` baris 89, 150, 169–170:
```typescript
// Baris 89:
const conv = await prisma.conversation.findUnique({
  where: { id: conversationId },
  include: { customer: true }
});

// Baris 150:
const conv = await prisma.conversation.findUnique({ where: { id: conversationId } });

// Baris 169-170:
await prisma.customer.update({
  where: { id: conv.customer_id },
  data: updateData,
});
```
Meskipun fungsi menerima `tenantId`, query database Prisma tidak menyertakan `tenant_id`.

### 2. Modifikasi: `src/v3/state/goal-tracker.ts`
Ubah query agar selalu memvalidasi `tenant_id`:

1. **Di baris 89 (`getGoalSession`)**:
   ```typescript
   // SEBELUM:
   // const conv = await prisma.conversation.findUnique({ where: { id: conversationId }, include: { customer: true } });

   // SESUDAH:
   const conv = await prisma.conversation.findFirst({
     where: { id: conversationId, tenant_id: tenantId },
     include: { customer: true }
   });
   ```

2. **Di baris 150 (`updateGoalSession`)**:
   ```typescript
   // SEBELUM:
   // const conv = await prisma.conversation.findUnique({ where: { id: conversationId } });

   // SESUDAH:
   const conv = await prisma.conversation.findFirst({
     where: { id: conversationId, tenant_id: tenantId }
   });
   ```

3. **Di baris 169–170 (`updateGoalSession`)**:
   ```typescript
   // SEBELUM:
   // await prisma.customer.update({ where: { id: conv.customer_id }, data: updateData });

   // SESUDAH:
   await prisma.customer.updateMany({
     where: { id: conv.customer_id, tenant_id: tenantId },
     data: updateData,
   });
   ```

4. **Lakukan hal yang sama pada helper method di file tsb (`markOngkirQuoted`, `markOngkirConfirmed`)**:
   Pastikan setiap panggilan `prisma.conversation.findUnique({ where: { id } })` diganti menjadi `prisma.conversation.findFirst({ where: { id: conversationId, tenant_id: tenantId } })`.

### 3. Acceptance Test & Verifikasi
Jalankan pencarian statis (`grep`):
```powershell
Select-String -Path "src\v3\state\goal-tracker.ts" -Pattern "conversation\.findUnique"
```
**Kriteria Lolos:** Output kosong (0 match). Semua query percakapan beralih ke `findFirst` dengan `tenant_id`.

---

## 🔹 MIKRO-TASK 0.4 — Timeout Bounded Tool Execution (ID: A3-01)

### 1. Masalah & Lokasi Kode
Di `src/v3/agent/agent-runner.ts` baris 520–523:
```typescript
try {
  toolResult = await executeToolByName(fnName, fnArgs, toolContext);
} catch (toolErr: any) {
  toolResult = { error: toolErr.message };
}
```
Jika tool eksternal (geocoding, openrouteservice) mengalami dead connection, pemanggilan fungsi akan menggantung tanpa batas waktu.

### 2. Modifikasi: `src/v3/agent/agent-runner.ts`
Tambahkan utilitas timeout lokal tepat di atas kelas atau di dalam fungsi:

```typescript
/**
 * Bungkus promise dengan batas waktu aman (default 7 detik).
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
    ),
  ]);
}
```

Lalu perbarui blok baris 520–523:
```typescript
// SEBELUM:
// toolResult = await executeToolByName(fnName, fnArgs, toolContext);

// SESUDAH:
const TOOL_TIMEOUT_MS = 7000;
try {
  toolResult = await withTimeout(
    executeToolByName(fnName, fnArgs, toolContext),
    TOOL_TIMEOUT_MS,
    `Tool "${fnName}" timeout setelah ${TOOL_TIMEOUT_MS}ms`
  );
} catch (toolErr: any) {
  console.warn(`[V3 TOOL TIMEOUT/ERROR] Tool: ${fnName}, Error: ${toolErr.message}`);
  toolResult = { error: toolErr.message };
}
```

### 3. Acceptance Test & Verifikasi
Buat unit test di `tests/unit/v3/tool-timeout.test.ts`:
Mock salah satu tool dengan delay 10 detik. Jalankan pemrosesan turn.  
**Kriteria Lolos:** Eksekusi tool selesai dalam 7.0–7.2 detik dengan hasil `{ error: 'Tool "..." timeout setelah 7000ms' }`, dan runner tetap menyelesaikan sintesis balasan tanpa crash.

---

## 📋 Checklist Validasi & Deployment Phase 0
- [ ] Task 0.1 selesai & test `tests/unit/v3/indonesian-date-parser.test.ts` PASS.
- [ ] Task 0.2 selesai & verifikasi 401 unauthenticated PASS.
- [ ] Task 0.3 selesai & 0 query `findUnique` tanpa tenant di `goal-tracker.ts`.
- [ ] Task 0.4 selesai & tool timeout 7s teruji.
- [ ] Jalankan regression suite: `npm test`.
