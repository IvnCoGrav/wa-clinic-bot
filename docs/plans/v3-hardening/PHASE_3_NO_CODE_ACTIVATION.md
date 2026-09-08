# PHASE 3: AKTIVASI NO-CODE (DATA-DRIVEN PERSONA, POLICY & CONFIGS)

> **Estimasi Total:** 1.5–2 Minggu Kerja  
> **Prasyarat:** Phase 2 selesai.  
> **Tujuan Strategis:** Mengubah seluruh aturan bisnis yang sebelumnya di-hardcode dalam TypeScript (`persona.ts`, `clinic-faq.tool.ts`, gazetteer wilayah) menjadi berbasis database yang dapat diubah oleh admin via dashboard tanpa perlu deploy ulang kode, lengkap dengan versioning dan proteksi rollback.

---

## 🔹 MIKRO-TASK 3.1 — Skema Database Versioned Prompt & Policy

### 1. Masalah
Saat ini tidak ada tabel di database untuk menyimpan teks prompt persona V3 atau kebijakan SOP klinik per-tenant.

### 2. Modifikasi: `prisma/schema.prisma`
Tambahkan dua model baru ke dalam `prisma/schema.prisma`:

```prisma
model TenantPromptConfig {
  id                    String   @id @default(uuid())
  tenant_id             String   @default("default-tenant")
  version               Int      @default(1)
  is_active             Boolean  @default(true)
  personality_tone      String   @db.Text
  answering_hierarchy   String   @db.Text
  negative_constraints String   @db.Text
  medical_overclaim_rules String @db.Text
  created_by            String?
  change_summary        String?
  created_at            DateTime @default(now())
  updated_at            DateTime @updatedAt

  @@index([tenant_id, is_active])
  @@map("tenant_prompt_configs")
}

model ClinicPolicy {
  id                    String   @id @default(uuid())
  tenant_id             String   @default("default-tenant")
  topic                 String   // 'therapist_qualification', 'payment_methods', 'homebase_and_coverage', dst.
  title                 String
  factual_summary       String   @db.Text
  suggested_reply       String   @db.Text
  is_active             Boolean  @default(true)
  created_at            DateTime @default(now())
  updated_at            DateTime @updatedAt

  @@unique([tenant_id, topic])
  @@index([tenant_id])
  @@map("clinic_policies")
}
```

Jalankan sinkronisasi schema:
```bash
npx prisma db push
npm run prisma:generate
```
*(Catatan: DILARANG memakai flag `--no-engine` sesuai aturan repo).*

---

## 🔹 MIKRO-TASK 3.2 — Migrasi PersonaPromptBuilder ke DB Assembler (ID: A2-02)

### 1. Masalah & Lokasi Kode
Di `src/v3/agent/persona.ts` baris 88–306:
Teks system prompt sepanjang ~220 baris di-hardcode di kode TypeScript.

### 2. File Baru: `src/services/tenant-prompt-config.service.ts`
Buat service untuk memuat dan menyimpan konfigurasi prompt dengan cache in-memory:

```typescript
/**
 * src/services/tenant-prompt-config.service.ts
 * Mengelola prompt persona Bidan Yusi dari DB dengan in-memory cache & fallback.
 */

import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';

export interface PromptConfigSections {
  personalityTone: string;
  answeringHierarchy: string;
  negativeConstraints: string;
  medicalOverclaimRules: string;
}

const promptCache = new Map<string, PromptConfigSections>();

export class TenantPromptConfigService {
  public static async getActivePromptConfig(tenantId: string = DEFAULT_TENANT_ID): Promise<PromptConfigSections> {
    const cached = promptCache.get(tenantId);
    if (cached) return cached;

    try {
      const row = await prisma.tenantPromptConfig.findFirst({
        where: { tenant_id: tenantId, is_active: true },
        orderBy: { version: 'desc' },
      });

      if (row) {
        const config: PromptConfigSections = {
          personalityTone: row.personality_tone,
          answeringHierarchy: row.answering_hierarchy,
          negativeConstraints: row.negative_constraints,
          medicalOverclaimRules: row.medical_overclaim_rules,
        };
        promptCache.set(tenantId, config);
        return config;
      }
    } catch (e: any) {
      console.warn(`[PROMPT CONFIG SERVICE] Gagal load dari DB, gunakan default code:`, e.message);
    }

    // Fallback ke default text
    return this.getDefaultConfig();
  }

  public static async saveNewVersion(
    tenantId: string,
    data: PromptConfigSections,
    author: string,
    summary: string
  ): Promise<void> {
    const latest = await prisma.tenantPromptConfig.findFirst({
      where: { tenant_id: tenantId },
      orderBy: { version: 'desc' },
    });

    const nextVersion = (latest?.version || 0) + 1;

    await prisma.$transaction([
      // Non-aktifkan versi lama
      prisma.tenantPromptConfig.updateMany({
        where: { tenant_id: tenantId, is_active: true },
        data: { is_active: false },
      }),
      // Buat versi baru
      prisma.tenantPromptConfig.create({
        data: {
          tenant_id: tenantId,
          version: nextVersion,
          is_active: true,
          personality_tone: data.personalityTone,
          answering_hierarchy: data.answeringHierarchy,
          negative_constraints: data.negativeConstraints,
          medical_overclaim_rules: data.medicalOverclaimRules,
          created_by: author,
          change_summary: summary,
        },
      }),
    ]);

    promptCache.set(tenantId, data);
  }

  public static getDefaultConfig(): PromptConfigSections {
    // Return teks default dari persona.ts eksisting
    return {
      personalityTone: `[GAYA BICARA & KEPRIBADIAN (WARM, EMPATHETIC & NATURAL CHAT)]\n...`,
      answeringHierarchy: `[HIERARKI & ALUR MENJAWAB (ANTI-MENODONG DATA & ANTI-AMNESIA)]\n...`,
      negativeConstraints: `[NEGATIVE CONSTRAINTS MUTLAK (ATURAN EMAS KLINIK - WAJIB 100% PATUH)]\n...`,
      medicalOverclaimRules: `[ATURAN ANTI-OVERCLAIM MEDIS]\n...`,
    };
  }
}
```

### 3. Modifikasi: `src/v3/agent/persona.ts`
Ubah `buildSystemPromptAsync` agar merakit teks dari service di atas:
```typescript
const promptSections = await TenantPromptConfigService.getActivePromptConfig(tenantId);
// Gabungkan: Header brand + promptSections.personalityTone + promptSections.answeringHierarchy + few-shot examples + promptSections.negativeConstraints + goalSummary
```

---

## 🔹 MIKRO-TASK 3.3 — Migrasi 7 Topik SOP ke `clinic_policies` & Endpoint CRUD (ID: A2-01)

### 1. Masalah & Lokasi Kode
Di `src/v3/tools/clinic-faq.tool.ts` baris 56–114:
7 topik kebijakan (kualifikasi terapis, metode pembayaran, ongkir multi anak, vaksin, homebase Waru) ditulis dalam `switch (topic)` hardcoded.

### 2. Modifikasi: `src/v3/tools/clinic-faq.tool.ts`
Ganti switch-statement statis dengan query ke database dengan cache 1 jam:

```typescript
// Ganti baris 52-114:
export async function executeGetClinicFaq(input: GetClinicFaqInput, tenantId: string = DEFAULT_TENANT_ID): Promise<GetClinicFaqOutput> {
  const { topic } = input;
  
  try {
    const { prisma } = await import('../../db/client');
    const policy = await prisma.clinicPolicy.findUnique({
      where: { tenant_id_topic: { tenant_id: tenantId, topic } },
    });

    if (policy && policy.is_active) {
      return {
        success: true,
        topic,
        factualSummary: policy.factual_summary,
        suggestedReply: policy.suggested_reply,
      };
    }
  } catch (err: any) {
    console.warn(`[CLINIC FAQ TOOL] DB error, fallback ke statis:`, err.message);
  }

  // Fallback ke data statis bawaan jika DB belum di-seed
  return getStaticFallbackPolicy(topic);
}
```

### 3. Buat Endpoint Admin CRUD di `src/routes/admin/settings.subroute.ts`:
- `GET /api/admin/settings/clinic-policies` — Ambil semua kebijakan SOP.
- `PUT /api/admin/settings/clinic-policies/:topic` — Edit summary & template teks kebijakan.

### 4. Seed Data Awal
Buat migration script `scripts/seed-clinic-policies.ts` untuk meng-insert ke-7 topik awal dari `clinic-faq.tool.ts` ke tabel `clinic_policies`.

---

## 🔹 MIKRO-TASK 3.4 — Migrasi Priority Tag Groups ke Tenant Settings (ID: A2-07)

Pindahkan objek `PRIORITY_TAG_GROUPS` dan `DOMAIN_GENERIC_WORDS` dari `src/slot-engine/few-shot-exemplars.ts` ke kolom `preferences` di model `Tenant` / `tenant_settings`. Jika belum dikonfigurasi di DB, fallback ke objek default yang ada saat ini.

---

## 🔹 MIKRO-TASK 3.5 — Migrasi Gazetteer Wilayah dari `fs.readFileSync` ke In-Memory Boot Loader (ID: A2-03)

### 1. Masalah & Lokasi Kode
Di `src/v3/tools/calculate-delivery.tool.ts` baris 68–84:
`fs.readFileSync` dipanggil saat fungsi kalkulasi dieksekusi.

### 2. Modifikasi: `src/v3/tools/calculate-delivery.tool.ts`
Pindahkan pembacaan file ke fase inisialisasi boot (top-level asynchronous atau fungsi init):
```typescript
// Jalankan load sekali di memori saat modul diimpor:
let cachedKecamatanNames: Array<{ lower: string; orig: string }> | null = null;

export function initKecamatanGazetteerSync(): void {
  if (cachedKecamatanNames) return;
  // load sekali saja, simpan di cachedKecamatanNames
}
initKecamatanGazetteerSync();
```
Pastikan di dalam `executeCalculateDelivery` tidak ada lagi operasi I/O disk sinkron (`fs.readFileSync`).

---

## 🔹 MIKRO-TASK 3.6 — Full Regression Gate Phase 3

1. Jalankan unit test suite:
   ```bash
   npm test
   ```
2. Jalankan numeric evaluation harness:
   ```bash
   npm run eval:numeric
   ```
3. Ubah satu kata di `clinic_policies` (misal jam operasional) melalui API admin, lalu jalankan query CLI simulator (`npm run chat`) menanyakan jam operasional.
**Kriteria Lolos:** Bot menjawab dengan jam operasional yang baru diubah tanpa deploy ulang kode.
