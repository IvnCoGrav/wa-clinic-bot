# SaaS Readiness Audit

**Audit Date:** 2026-08-02
**Verdict:** NOT SaaS-ready. DB schema siap multi-tenant, tapi seluruh layer di atas DB masih single-tenant.

---

## Status per Layer

| Layer | Status | Catatan |
|---|---|---|
| DB Schema | ✅ Siap | 17 model punya `tenant_id` + index |
| Tenant Registry | ✅ Ada | Model `Tenant` di `prisma/schema.prisma:373` |
| Tenant Routing | ❌ Belum Ada | Webhook pakai `DEFAULT_TENANT_ID` hardcoded |
| Multi-WAHA Session | ❌ Singleton | 1 `wahaClient` global, 1 session dari env |
| Persona / Templates | ❌ Hardcode | `BRAND_IDENTITY` + `TEMPLATES` + followup semua hardcode brand |
| Admin Dashboard | ❌ Hardcode | UI label "Kala Moms & Baby Spa" di semua halaman |
| API Auth | ❌ Single-key | 1 API key, 1 session store |
| Schema Isolation | ⚠️ Bug | `Customer.phone` & `AdClick.trackingCode` `@unique` global |
| Backend Services | ⚠️ Hardcode | Google Calendar/Contacts pakai label "Kala Spa" hardcode |

---

## Tabel Blocker Detail

### P0 — Harus Selesai Sebelum SaaS Launch

| # | Kategori | Lokasi | Masalah | Effort |
|---|---|---|---|---|
| 1 | Tenant Routing | `src/routes/webhook.route.ts` | `DEFAULT_TENANT_ID` diimpor & dipakai di semua service call (lines 57, 59, 74, 80, 86, 116, 136, 140, 150, 156, 233, 289, 295, 314, 332). Tidak ada resolve tenant dari nomor WhatsApp/WAHA session. | High |
| 2 | Multi-WAHA | `src/integrations/waha/client.ts` | `wahaClient` singleton global. 1 session untuk semua tenant. Per-tenant WAHA session belum ada. | High |
| 3 | Persona Hardcode | `src/config/persona.ts:19` | `businessName: "Kala Moms and Baby Spa"` — module-level constant, bukan dari DB `TenantPersona`. | High |
| 4 | Persona Hardcode | `src/config/persona.ts:29-64` | System prompt LLM hardcode "Kala Moms and Baby Spa". | High |
| 5 | Templates Hardcode | `src/config/persona.ts:139-386` | `TEMPLATES` object semua hardcode brand name. | High |
| 6 | Followup Hardcode | `src/config/followup-templates.ts:33-117` | 14+ template followup semua isi "Kala Spa". Model DB `FollowUpTemplate` sudah ada tapi tidak dipakai untuk generate pesan. | Medium |
| 7 | Greeting Hardcode | `src/state-machine/handlers/greeting.ts:66` | `"saya Bidan Yusi dari Kala Moms and Baby Spa"` | Low |

### P1 — Sebelum Multi-Tenant Production

| # | Kategori | Lokasi | Masalah | Effort |
|---|---|---|---|---|
| 8 | Dashboard Hardcode | `packages/admin-dashboard/src/components/common/Layout.tsx:138` | Panel title: `"Kala Moms & Baby Spa Panel"` | Medium |
| 9 | Dashboard Hardcode | `packages/admin-dashboard/src/pages/auth/Login.tsx:45` | Brand title: `"Kala Moms & Baby Spa"` | Low |
| 10 | Dashboard Hardcode | `packages/admin-dashboard/src/pages/tenant/AiSandbox.tsx:38,50` | Bot intro & system prompt hardcode brand | Medium |
| 11 | Schema Isolation | `prisma/schema.prisma:39` | `Customer.phone` `@unique` global — dua tenant tidak bisa punya customer nomor sama. Perlu `@@unique([tenant_id, phone])` | Medium |
| 12 | Schema Isolation | `prisma/schema.prisma:318` | `AdClick.trackingCode` `@unique` global — sama seperti di atas. | Low |
| 13 | Domain Hardcode | `src/routes/admin.route.ts` | `kalababyspa.online`, `app.kalababyspa.online`, `admin@kalababyspa.online` | Low |
| 14 | Phone Hardcode | `prisma/schema.prisma:377` | Default `whatsapp_number: "6287751148065"` di model `Tenant` | Low |
| 15 | Phone Hardcode | `src/routes/tracking.route.ts:171,193` | Fallback `'6287751148065'` hardcoded | Low |

### P2 — Before Scale / SaaS Public Launch

| # | Kategori | Lokasi | Masalah | Effort |
|---|---|---|---|---|
| 16 | Admin Auth | `src/routes/admin.route.ts:117,156` | Single API key, single session store, tidak per-tenant admin users | Medium |
| 17 | AI System Prompt | `src/integrations/llm/intent.ts:60` | Intent classifier prompt mention "Kala Moms and Baby Spa" | Low |
| 18 | NLU System Prompt | `src/services/nlu-classifier.service.ts:143` | NLU classifier mention "Kala Moms & Baby Spa" | Low |
| 19 | Seed FAQ Hardcode | `src/cli/seed-faq.ts:8-128` | 30 FAQ entries semua mention "Kala Moms and Baby Spa" | Low |
| 20 | Calendar Labels | `src/services/google-calendar.service.ts:57-58,99-100` | `"Kala Treatment - ${customerName}"` | Low |
| 21 | Contact Labels | `src/services/google-contacts.service.ts:62` | `"${notifyName} (Kala Spa)"` | Low |
| 22 | LegacyStaging | `prisma/schema.prisma:350` | `tenantId` camelCase beda dari `tenant_id` snake_case di model lain | Low |
| 23 | Env Leaked | `.env`, `.env.example` | API key, password ada di file yang mungkin committed | Low |

---

## Checklist Migrasi (Urutan Kerja)

### Fase 1 — Tenant Routing Foundation
- [ ] Buat tenant resolution middleware: resolve dari WAHA session → `Tenant.whatsapp_number`
- [ ] Refactor `webhook.route.ts`: ganti semua `DEFAULT_TENANT_ID` → tenant dari middleware
- [ ] Buat `wahaClient` per-tenant (map `tenant_id` → WAHA session)
- [ ] Buat admin auth per-tenant (session store per tenant, admin users table)

### Fase 2 — Persona & Templates dari DB
- [ ] Refactor `persona.ts`: hapus `BRAND_IDENTITY` constant, load dari `TenantPersona` table
- [ ] Refactor `TEMPLATES` object: load dari DB per tenant
- [ ] Refactor `followup-templates.ts`: load dari `FollowUpTemplate` table
- [ ] Update seed `seed-faq.ts`: generic, tanpa brand name
- [ ] Update LLM prompts (`intent.ts`, `nlu-classifier.service.ts`): hapus brand reference

### Fase 3 — Dashboard Multi-Tenant
- [ ] Dynamic branding: load tenant name dari DB di Layout, Login, AiSandbox, Settings
- [ ] Tenant switcher untuk super_admin (opsional)
- [ ] Tenant-scoped API endpoints

### Fase 4 — Schema & Isolation Fixes
- [ ] Fix `Customer.phone` unique: `@@unique([tenant_id, phone])`
- [ ] Fix `AdClick.trackingCode` unique: `@@unique([tenant_id, trackingCode])`
- [ ] Fix `LegacyStaging.tenantId` → `tenant_id` (snake_case)
- [ ] Remove hardcoded fallback phone numbers di `tracking.route.ts`, `click-catcher`

### Fase 5 — Backend Services
- [ ] Google Calendar: label dari DB tenant config, bukan hardcode "Kala Treatment"
- [ ] Google Contacts: label dari DB tenant config
- [ ] Remove domain hardcode di `admin.route.ts`
- [ ] Pastikan `.env` tidak committed, gunakan `.env.example` tanpa real keys

---

## Pola Implementasi yang Benar vs Salah

```typescript
// ❌ SALAH: brand hardcode
const greeting = "Selamat datang di Kala Moms and Baby Spa";

// ✅ BENAR: dari DB tenant
const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
const greeting = `Selamat datang di ${tenant.name}`;
```

```typescript
// ❌ SALAH: default tersembunyi
function handleMessage(tenantId = 'default-tenant') { ... }

// ✅ BENAR: parameter wajib
function handleMessage(tenantId: string) { ... }
// Error jika tenantId kosong — jangan diam-diam pakai default
```

```typescript
// ❌ SALAH: single WAHA client global
const waClient = new WahaClient(WAHA_BASE_URL);

// ✅ BENAR: per-tenant WAHA client
function getWahaClient(tenantId: string): WahaClient {
  return wahaClientMap.get(tenantId) ?? createClient(tenantId);
}
```

```typescript
// ❌ SALAH: query tanpa tenant filter
const customers = await prisma.customer.findMany();

// ✅ BENAR: selalu filter tenant
const customers = await prisma.customer.findMany({
  where: { tenant_id: tenantId },
});
```

---

## Referensi

- Skill mandat: `.agents/skills/saas-readiness/SKILL.md`
- DB schema: `prisma/schema.prisma`
- PRD Section 6.1: `PRD.md`
- Tenant model: `prisma/schema.prisma:373` (model `Tenant`)
