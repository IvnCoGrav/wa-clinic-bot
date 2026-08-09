# Implementation Plan — Tahap 1 (High Impact & Retention)

**Versi:** 1.1
**Tanggal:** 12 Agustus 2026
**Status:** ✅ SELESAI — terimplementasi (migration `20260819000000_add_customer_preferences`, `resolveMilestoneType` di follow-up.service, test `follow-up-milestone.test.ts` & `customer-memory.test.ts`)
**Induk:** `docs/ROADMAP_IMPLEMENTASI_FITUR_BARU.md` (Blueprint Keseluruhan Fase 1-3)
**Batas Lingkup:** HANYA **Tahap 1**. Tahap 2 & 3 ada di dokumen induk.

> [!IMPORTANT]
> Seluruh keputusan desain di bawah sudah **terkunci** berdasarkan konfirmasi user (DB-driven, NEXT_TREATMENT, kategori BABY dari reservasi, deteksi umur rentang, preferensi mode D2). Eksekusi dilakukan bertahap & di localhost, mengikuti `AGENTS.md` (SaaS-Readiness Mandate, Offline-First Test, Server Update Gate). Backend WAJIB tenant-aware — data template/persona dari DB, bukan hardcode global.

---

## Konteks & Tujuan

1. **Milestone Follow-Ups** — memanfaatkan sistem follow-up `NEXT_TREATMENT` (bulan ke-1/2/3 pasca treatment) yang sudah ada, namun mengirim **template edukasi tumbuh-kembang** berdasarkan **usia bayi** pada momen milestone (3/6/9/12 bulan).
2. **Zero-Cost Long-Term Customer Memory (D2)** — menyimpan fakta permanen pelanggan (nama anak, kulit sensitif, dll.) secara **inline** saat balasan FAQ, lalu menyuntikkannya ke ground truth agar AI "ingat" lintas sesi — dengan biaya tambahan hanya **+2-3%**.

---

## Sub-Item 1.1 — Developmental Milestone Follow-Ups

### Keputusan Terkunci
| Aspek | Keputusan |
|---|---|
| Basis | Sistem follow-up `NEXT_TREATMENT` yang ada |
| Mapping template | **DB-driven** (`FollowUpTemplate` + `WabaTemplate`) + default cadangan di kode |
| Scope | Hanya follow-up `NEXT_TREATMENT` (bukan `NO_PURCHASE`) |
| Gateway | **WAHA (teks)** — WABA tidak broadcast template edukasi |
| Kategori | **BABY** — dari reservasi terakhir customer |
| Deteksi umur | **Rentang** (window, `ageInFullMonths ± 1`) bukan eksak |

### 1.1.A — `src/services/follow-up.service.ts`

**A1. Muat `children` di `processDueFollowUps`** (`:216-229`)
```typescript
include: { customer: true },
```
menjadi:
```typescript
include: { customer: { include: { children: true } } },
```
Agar kode eksekusi bisa baca `birth_date` & `name` anak untuk milestone logic.

**A2. Helper resolusi milestone** (tambah method di `FollowUpService`)
```ts
/**
 * Umur anak dalam bulan PENUH (year/month diff, bukan floor /30 hari).
 */
private ageInFullMonths(birthDate: Date, now: Date = new Date()): number {
  let m = (now.getFullYear() - birthDate.getFullYear()) * 12;
  m += now.getMonth() - birthDate.getMonth();
  if (now.getDate() < birthDate.getDate()) m -= 1;
  return Math.max(0, m);
}

/**
 * Tentukan template milestone utk follow-up NEXT_TREATMENT masa depan.
 * 1) Hanya NEXT_TREATMENT. 2) BAcare anak dengan birth_date.
 * 3) Cek kategori BABY dari reservasi terakhir customer.
 * 4) Umur ≈ milestone (3/6/9/12) dalam rentang ±1 bulan (env MILESTONE_WINDOW_DAYS).
 */
public async resolveMilestoneType(
  fu: any,
  tenantId: string
): Promise<FollowUpTemplateType | null> {
  if (fu.type !== 'NEXT_TREATMENT') return null;
  const child = fu.customer?.children?.[0];
  if (!child?.birth_date) return null;

  // (a) Kategori BABY dari reservasi terakhir
  try {
    const lastRes = await prisma.reservation.findFirst({
      where: { customer_id: fu.customer_id, tenant_id: tenantId },
      orderBy: { created_at: 'desc' },
      select: { treatment_category: true },
    });
    if (!lastRes || lastRes.treatment_category !== 'BABY') return null;
  } catch {
    return null; // DB offline -> jangan blokir follow-up normal
  }

  const age = this.ageInFullMonths(child.birth_date);
  const window = parseInt(process.env.MILESTONE_WINDOW_DAYS || '15', 10) / 30;

  const milestones: Record<number, FollowUpTemplateType> = {
    3: 'MILESTONE_3M',
    6: 'MILESTONE_6M',
    9: 'MILESTONE_9M',
    12: 'MILESTONE_12M',
  };

  for (const t of Object.keys(milestones).map(Number)) {
    if (Math.abs(ageMonths - t) <= window) return milestones[t];
  }
  return null;
}
```
> Catatan: follow-up berjalan di bulan ke-1/2/3 pasca treatment, sehingga usia bayi di momen itu berbeda dari usia saat registrasi. Kita anggap milestone aktif bila usia bayi jatuh di sekitar 3/6/9/12 bulan (`±1 bulan`). Window bisa di-tune via env `MILESTONE_WINDOW_DAYS`.

**A3. Override di `executeFollowUp`** (sisipkan **sebelum** blok pemetaan `templateType` `:264`)
```ts
const milestoneType = await this.resolveMilestoneType(fu, tenantId);
let templateType: FollowUpTemplateType = 'NO_PURCHASE_1';
if (milestoneType) {
  templateType = milestoneType;
  fu._milestone = true;
} else if (fu.type === 'NO_PURCHASE') {
  templateType = `NO_PURCHASE_${Math.min(3, Math.max(1, fu.stage))}` as any;
} else if (fu.type === 'NEXT_TREATMENT') {
  templateType = `NEXT_TREATMENT_${Math.min(3, Math.max(1, fu.stage))}` as any;
}
```
Nilai `templateType` dipakai **kedua** jalur (WAHA text via `getRollingFollowUpMessage`, WABA bila diaktifkan).

**A4. DB offline graceful:** bila DB down, `resolveMilestoneType` return `null` → follow-up normal tidak rusak (fail-safe).

### 1.1.B — Template default (fallback saat DB kosong)

**`src/config/followup-templates.ts`** — tambah ke union & `FOLLOWUP_ROLLING_TEMPLATES`:
```ts
export type FollowUpTemplateType =
  | '...' | 'MILESTONE_3M' | 'MILESTONE_6M' | 'MILESTONE_9M' | 'MILESTONE_12M';
```
Contoh variasi `MILESTONE_3M`:
```ts
MILESTONE_3M: [
  ({ name, babyName }) =>
    `Halo Bunda ${name}! Si kecil (${babyName || 'dek kecil'}) sudah 3 bulan, saatnya stimulasi tummy time & pijat bayi demi tumbuh kembang optimal. Mau Bidan jadwalkan?`,
  ({ name }) =>
    `Selamat tuan Bunda ${name}! Di usia 3 bulan si kecil mulai banyak tidur & aktif bergerak. Pijat bayi rutin membantu relaksasi otot & kualitas tidurnya. Bidan siap datang lho bund!`,
  ({ name }) =>
    `Pagi Bunda ${name}! Usia 3 bulan itu golden moment interaksi & tummy time. Yuk amankan slot pijat stimulus tumbuh kembang bersama ${getBrandIdentity().businessName}!`,
],
```
Buat serupa utk `MILESTONE_6M` (duduk/merangkak), `9M` (berdiri/pelan jalan), `12M` (MPASI/berjalan).

**`src/services/waba-template.service.ts`** — tambah entri default cadangan `DEFAULT_TEMPLATE_NAMES`:
```ts
MILESTONE_3M: { templateName: 'milestone_3m', category: 'MARKETING' },
MILESTONE_6M: { templateName: 'milestone_6m', category: 'MARKETING' },
MILESTONE_9M: { templateName: 'milestone_9m', category: 'MARKETING' },
MILESTONE_12M: { templateName: 'milestone_12m', category: 'MARKETING' },
```

### 1.1.C — DB Seed (DB-driven, tenant-aware)
Tabel `FollowUpTemplate` & `WabaTemplate` sudah ada → **tidak perlu migrasi schema baru** untuk milestone. Lakukan seed per-tenant:
- `follow_up_templates`: `type='MILESTONE_3M'`, `variant=1`, `text=...`, `is_active=true`.
- `waba_templates`: `type='MILESTONE_3M'`, `variant=1`, `status='APPROVED'`, ... (cadangan bila WABA diaktifkan).

### 1.1.D Test (unit offline, mock prisma)
`tests/unit/follow-up-milestone.test.ts` (pola `follow-up-waba-branch.test.ts`):
- `resolveMilestoneType` return `null` utk `NO_PURCHASE`.
- return `MILESTONE_3M` saat `birth_date` → usia 3 bulan + kategori BABY.
- return `null` saat kategori MOMS.
- tidak throw saat DB down (mock reject) → fallback null.
- Update fixture `makeFollowUp` agar punya `customer.children`.

---

## Sub-Item 1.2 — Zero-Cost Long-Term Customer Memory (mode D2)

### Keputusan Terkunci
| Aspek | Keputusan |
|---|---|
| Tujuan | Bot ingat fakta pelanggan lintas sesi → jawaban personal |
| Mode | **D2** — ekstraksi inline + simpan + injeksi ground truth; **tanpa bypass cache massal** |
| Biaya | +2-3% (prompt lebih panjang); **tidak ada panggilan API tambahan** |
| Cakupan | Fakta permanen seluruh pelanggan (anak, ibu, preferensi umum) |

### 1.2.A — Schema & Migrasi
`prisma/schema.prisma`, model `Customer` (`:93`):
```prisma
preferences Json?
```
```bash
npx prisma migrate dev --name add_customer_preferences
```
> Offline unit test memakai mock `src/db/client` → migrasi tidak dijalankan di test (sesuai AGENTS).

### 1.2.B — `src/integrations/llm/generator.ts`

**B1. Interface** (`:16`):
```ts
export interface FAQResponseResult {
  answer: string;
  reasoning: string | null;
  extracted_preferences?: Record<string, any>;
}
```

**B2. Prompt** (blok `FORMAT RESPONS`, `:185`):
```text
Jika customer menyebut fakta permanen BARU tentang profil mereka
(nama anak, jumlah anak, usia bayi, kulit sensitif, alergi, keluhan berulang,
kehamilan/nifa, preferensi layanan jangka panjang), tuliskan ke field
"extracted_preferences" sebagai object key-value singkat.
Jangan tampilkan ke dalam "answer". Jika tidak ada fakta permanen baru,
set "extracted_preferences" menjadi {}.
```
JSON menjadi:
```json
{
  "reasoning": "...",
  "referenced_treatment": "...",
  "needs_clarification": true | false,
  "answer": "...",
  "extracted_preferences": {}
}
```

**B3. Parse & return** (`:234`, `:272`):
```ts
let parsed: {
  reasoning?: string; answer?: string; referenced_treatment?: string | null;
  needs_clarification?: boolean; extracted_preferences?: Record<string, any>;
};
// ... existing JSON.parse ...
return {
  answer: finalAnswer,
  reasoning: parsed.reasoning || null,
  extracted_preferences:
    parsed.extracted_preferences && typeof parsed.extracted_preferences === 'object' && Object.keys(parsed.extracted_preferences).length > 0
      ? parsed.extracted_preferences
      : undefined,
};
```
> Cache HIT / fallback / mock → return tanpa field → `undefined` → tanpa operasi DB (aman).

**B4. Inject ke Ground Truth** (`:60-82`), tambah baris preferensi:
```ts
const prefsStr = gt.preferences && Object.keys(gt.preferences).length > 0
  ? Object.entries(gt.preferences).map(([k, v]) => `${k}: ${v}`).join('; ')
  : 'Tidak ada';
// pada section ground truth tambahkan:
// - Preferensi: ${prefsStr}
```

### 1.2.C — `src/services/customer.service.ts`
- `getCustomerGroundTruth` (`:798`): baca `customer.preferences`; tambah `preferences` ke return.
- Update interface `CustomerGroundTruth` (`:846`):
```ts
export interface CustomerGroundTruth {
  name: string | null;
  activeServices: string[];
  historicalServices: string[];
  preferences?: Record<string, any>;
}
```

### 1.2.D — `src/state-machine/handlers/interest.ts`
Setelah `generateFaqResponseWithDetails` (`:385`):
```ts
if (faqResult.extracted_preferences && Object.keys(faqResult.extracted_preferences).length > 0) {
  try {
    const { prisma } = await import('../../db/client'); // pola lazy-import existing
    const currentCust = await prisma.customer.findUnique({ where: { id: customer.id } });
    const merged = { ...(currentCust?.preferences as Record<string, any> || {}), ...faqResult.extracted_preferences };
    await prisma.customer.update({ where: { id: customer.id }, data: { preferences: merged } });
  } catch (_) { /* DB down → abaikan, jangan ganggu loop respon */ }
}
```

### 1.2.E Test (unit, offline)
`tests/unit/customer-memory.test.ts`:
- `generateFaqResponseWithDetails` mengembalikan `extracted_preferences` saat prompt sukses (mock axios).
- cache HIT / fallback → `extracted_preferences` undefined.
- merge di `interest.ts` tidak crash saat DB reject.

---

## Migrasi Summary & Prisma

| Perubahan | Bentuk |
|---|---|
| `Customer.preferences Json?` | Migrasi baru `add_customer_preferences` |
| Seeding milestone template | Data `follow_up_templates` / `waba_templates` (tabel existing) |

> Follow-up service `projected` wallet online + offline test.

---

## Aturan Wajib yang Dipatuhi
1. SaaS-Readiness: semua template/persona dari DB per-tenant; default kode hanya cadangan.
2. Offline-First Test: semua unit test tanpa DB asli (mock `src/db/client`).
3. Server Update Gate: eksekusi & test di localhost; deploy hanya atas perintah eksplisit (2x konfirmasi).