# REVISI PLAN: Meta Ads Performance & Sales Dashboard (Fondasional)

Tanggal revisi: 02 Oktober 2026
Status: **Fase 0–4 SELESAI DIEKSEKUSI (2026-10-02). Sisa Fase 5 deploy (migrasi RBAC) dicatat di `docs/KNOWN_ISSUES.md` #195.**
Dokumen yang direvisi: Proposal "Staged Implementation Plan: Meta Ads Performance & Sales Dashboard" (02 Okt 2026)
Dasar audit: `prisma/schema.prisma`, `src/routes/admin/meta-attribution.subroute.ts`,
`src/routes/admin.route.ts:192-280`, `src/services/ad-attribution.service.ts`,
`src/services/reservation-core.service.ts:343-364`, `src/services/financial-analytics.service.ts`,
`src/services/capi.service.ts:121`, `src/services/role-scope.service.ts`,
`packages/admin-dashboard/src/pages/tenant/MetaClickCatcher.tsx`,
`packages/admin-dashboard/src/services/api.ts`, `tests/setup.ts`, `docs/KNOWN_ISSUES.md` (#179).

---

## 0. Ringkasan Perubahan vs Plan Asli (wajib dibaca dulu)

Plan asli arahnya benar (Tab mode, service mandiri, pisah CAC vs LTV) tetapi mengandung
7 cacat fondasional yang terbukti dari kode nyata (detail bukti di laporan audit 02 Okt 2026).
Revisi ini TIDAK menambah scope — hanya memperbaiki definisi, kontrak, dan peletakan kode
agar angka CAC/ROAS jujur dan tidak regresi.

| # | Cacat plan asli | Perbaikan di revisi ini |
|---|---|---|
| F1 | `newCustomersAcquired` = "order pertama seumur hidup" tetapi akan dihitung dari flag `is_repeat_order`. Padahal `computeIsRepeatOrder` (`reservation-core.service.ts:343-364`) = `count status IN (confirmed,en_route,completed) > 0`, bukan first-ever; cancelled/hold/pending tidak dihitung; flag dihitung saat create (bisa basi). | Kanonis first-ever = `MIN(created_at)` reservasi **qualifying** (non-cancelled/rejected, non-sandbox, non-staff) per customer. `is_repeat_order` hanya hint, bukan otoritas. (Fase 0 §0.1) |
| F2 | `initialRevenue/totalClinicRevenue/AOV` tanpa pin formula. Berbenturan dengan divergensi "Lunas" OPEN di KNOWN_ISSUES #179 (`financial-analytics.service.ts:228` vs staf PWA murni `purchase_occurred_at`). `purchase_value` mentah + ongkir ganda = ROAS inflated. | Pin seam kanonis: `treatmentFee = purchase_value>0 ? purchase_value : await resolveTreatmentValue(detail, tenantId)` (`capi.service.ts:121`); `deliveryFee = resolveDeliveryFeeSnapshot(r)` (`reservation-core.service.ts:417`); `totalFee = treatment+delivery`. Filter status eksplisit. (Fase 0 §0.2) |
| F3 | `channelComparison LP_VIEW vs CTWA` seolah bisa di-join ke customer. Fakta: `LandingPageView` **tidak punya** `phone/customerId/trackingCode** (`schema.prisma:573-600`), tidak attributable. | Pecah jujur: (a) Views→Clicks = coverage atas funnel tanpa atribusi; (b) bawah funnel by `AdClick`: `ctwa_clid NOT NULL → CTWA_NATIVE`, else `PROMO_CTA` (`ad-attribution.service.ts:91-208`). (Fase 0 §0.3) |
| F4 | `journeyVelocity/bookingLeadTime` tanpa pin kolom tanggal + zona waktu campur (`setHours` lokal vs WIB→UTC). | Pin: `firstTouch = AdClick.matchedAt ?? Customer.created_at`; `firstBookingAnchor = first qualifying Reservation.created_at`; `journeyDays = anchor − touch`; `leadTimeDays = booking_date − created_at` (null-safe); semua batas hari WIB via pola `getWibCalendarDayBounds` (`reservation-core.service.ts:273-282`). (Fase 0 §0.4) |
| F5 | Tanpa filter `is_sandbox_test / is_internal_staff` → angka CAC tercemar chat uji (mandat `qa-test-labeling`). | `SANDBOX_EXCLUDE = { is_sandbox_test:false, is_internal_staff:false }` di SEMUA query customer/reservasi. (Fase 0 §0.5) |
| F6 | Contoh kode `tenantId: DEFAULT_TENANT_ID` hardcode (melanggar `saas-readiness`: "tidak boleh default tersembunyi"); tanpa seed RBAC. Fakta: `/api/admin/debug/*` = **Super-Admin only** (`admin.route.ts:198-215`), jadi endpoint di bawah `/debug` tidak bisa dibuka role ADVERTISER. | `tenantId` wajib dari konteks request (`(request as any).staffTenantId ?? DEFAULT_TENANT_ID` — fallback eksplisit terdokumentasi, bukan default param). Endpoint baru di **luar** `/debug`: `GET /api/admin/meta-performance`. Seed `role_api_scopes` untuk `advertiser` (GET) via migrasi. (Fase 2) |
| F7 | Klaim `tests/setup.ts` mock semua Prisma → fallback nol. Fakta: mock TIDAK berisi `landingPageView`, `reservation.aggregate/groupBy`, `customer.aggregate/groupBy`, `auditLog`. Klaim cache `Cache-Control max-age=5` bertabrakan dengan SWR 15s (`api.ts:126-225`) + `responseCacheService` 30s backend. | Test pakai scoped-double per-file (pola `staff-trip-tracking`); cache backend pakai `responseCacheService` 30s yang sudah ada, frontend pakai `refreshApi` manual — tanpa header HTTP baru. Frontend dipecah komponen (anti-bloat). (Fase 1/3/4) |

Prinsip yang dipertahankan dari plan asli: Tab mode di `MetaClickCatcher.tsx` (tanpa rute page baru),
zero new runtime deps (recharts/lucide/tailwind yang sudah ada), try/catch fallback offline,
state-gated deterministik (bukan regex kalimat, bukan "DILARANG..." di prompt).

---

## 1. Fase 0 — Kontrak Kanonis & Guardrails (wajib sebelum koding; read-only + tulis 1 file kontrak)

Tujuan: kunci definisi agar Fase 1-4 tidak mengulang debat. Blast radius: NOL ke runtime
(hanya 1 file tipe + dokumentasi kontrak di plan ini).

### Micro-task 0.1 — Tetapkan kanonis CAC vs LTV (di `src/services/meta-performance-analytics.service.ts` kelak)

```ts
// Qualifying reservation = masuk hitung akuisisi/omzet bila SEMUA benar:
//   - tenant_id = tenantId peminta
//   - status NOT IN ('cancelled', 'rejected')
//   - customer.is_sandbox_test = false AND customer.is_internal_staff = false
//   - (untuk revenue) ikut aturan Fase 0.2
// First-ever customer = reservasi qualifying dengan MIN(created_at) per customer.
//   - newCustomersAcquired (periode) = customer yang first-ever-nya jatuh DALAM [start,end].
//   - initialRevenue = totalFee atas first-ever tersebut (satu baris per customer).
//   - repeatCustomersCount/repeatRevenue (periode) = reservasi qualifying BUKAN first-ever
//     yang created_at-nya jatuh DALAM [start,end] (customer boleh first-ever di luar periode).
// Alasan: `is_repeat_order` (reservation-core.service.ts:343-364) hanya hint saat create,
// tidak tahan terhadap cancel kemudian hari. DILARANG memakai flag itu sebagai otoritas.
```

Acceptance: definisi ini disalin verbatim sebagai komentar kepala file service Fase 1.

### Micro-task 0.2 — Pin seam omzet kanonis (anti-#179)

```ts
// treatmentFee = (r.purchase_value > 0) ? r.purchase_value
//              : (await resolveTreatmentValue(r.treatment_detail, tenantId) ?? 0)
//              — resolveTreatmentValue: src/services/capi.service.ts:121 (DB-driven katalog).
// deliveryFee  = resolveDeliveryFeeSnapshot(r)
//              — src/services/reservation-core.service.ts:417 (snapshot > fallback Customer.ongkir, KB-6).
// totalFee     = treatmentFee + deliveryFee.
// totalClinicRevenue / initialRevenue / repeatRevenue / AOV semuanya dari totalFee.
// Status yang masuk revenue: default EXCLUDE ['cancelled','rejected']; `pending/hold`
//   DITAMPILKAN terpisah (bukan dicampur ke revenue) agar tidak mengulang #179.
// Semua angka revenue WAJIB mencantumkan `revenueBasis` di respons:
//   { treatmentSource: 'purchase_value| catalog_fallback', deliverySource: 'snapshot|fallback', excludedStatuses: [...] }
```

### Micro-task 0.3 — Pin mapping kanal jujur (tanpa join fiktif LP→customer)

```ts
// ATAS FUNNEL (coverage, tanpa atribusi customer):
//   pageViews = count landingPageView (tenant, range, bot-excluded, filter utmCampaign bila ada).
//   totalClicks = count adClick (tenant, range, bot-excluded — pola BOT_EXCLUDE_CLAUSE
//     meta-attribution.subroute.ts:56-64 HARUS dipakai ulang).
//   Catatan jujur bila clicks > views = "klik superset (direct/cta & LP tanpa tracker)"
//     (pola coverageNote meta-attribution.subroute.ts:351-357 DIPERTAHANKAN).
// BAWAH FUNNEL (attributable, by AdClick baris yang matched):
//   channel = r.ctwa_clid NOT NULL → 'CTWA_NATIVE'
//           | else → 'PROMO_CTA'   (termasuk whatsapp_direct ctwa_<uuid>, ad-attribution.service.ts:189)
//   utmMedium mentah tetap dikembalikan sebagai `utmMediumRaw` untuk audit, bukan untuk grouping utama.
// DILARANG mengklaim "leads LP_VIEW" per customer — LP_VIEW tidak punya phone/customerId.
```

### Micro-task 0.4 — Pin kolom tanggal + WIB

```ts
// firstTouch     = adClick.matchedAt ?? customer.created_at (per customer, untuk journey).
// firstAnchor    = first-ever qualifying reservation.created_at.
// journeyDays    = floor((firstAnchor − firstTouch) / 86400000), clamp ≥ 0.
// leadTimeDays   = booking_date ? floor((booking_date − created_at)/86400000) : null (null = tanpa tanggal → bucket 'TANPA_TANGGAL', bukan 0).
// Batas range [start,end] = hari kalender WIB (pola getWibCalendarDayBounds,
//   reservation-core.service.ts:273-282), BUKAN setHours lokal.
// Default bila query kosong = 30 hari terakhir (pola meta-attribution.subroute.ts:216-220).
// Brackets journey: [<1, 1-3, 3-7, 7-14, >14] hari; leadTime: [SAME_DAY, H-1, H-2..3, H-4..7, >H-7, TANPA_TANGGAL].
// mean = rata-rata aritmetik; median = nilai tengah setelah sort (genap = rata-rata dua tengah).
```

### Micro-task 0.5 — Guardrails non-fungsional (checklist implementasi)

- [ ] Semua query customer/reservasi/adClick memuat `tenant_id = tenantId` (dari request, §Fase 2) + `SANDBOX_EXCLUDE`.
- [ ] Validasi query via `zod` (dep eksisting): `startDate/endDate` format `YYYY-MM-DD`, `spend` number ≥ 0 ≤ 1e12, tolak NaN.
- [ ] `select` minimal per query (id, created_at, booking_date, purchase_value, treatment_detail, delivery_fee, status, customer select id/created_at/matchedAt/kecamatan/kota/is_mql/mql_triggered_at) — DILARANG `include` penuh.
- [ ] Paginasi/batas: agregasi DB (`count/groupBy`) untuk KPI; `findMany` customer/reservasi dibatasi (`take ≤ 5000`, `orderBy created_at asc`) + `revenueBasis.truncated=true` bila kepotong.
- [ ] Cache backend = `responseCacheService` (`get/set` TTL 30, pola `financial-analytics.service.ts:140-142,433`); DILARANG header `Cache-Control` baru; frontend refresh via `refreshApi` (`api.ts:185-192`).
- [ ] Tanpa regex baru untuk intent/teks user; URL hanya via `URL/URLSearchParams` bila perlu (mandat minimal-regex).
- [ ] Tanpa `window.confirm/alert` di frontend (pakai `useUiFeedback`); tanpa label WAHA (mandat label ban).

Regression Gate 0: definisi §0.1-0.5 disetujui user tertulis sebelum Fase 1 dimulai.

---

## 2. Fase 1 — Backend Analytics Service (file baru, read-only query)

Blast radius: SANGAT RENDAH (1 file service baru + 0 perubahan runtime lain).

### Micro-task 1.1 — Buat file `src/services/meta-performance-analytics.service.ts`

Kontrak publik (final, tidak boleh menyimpang tanpa gate):

```ts
import { z } from 'zod';
export const MetaPerformanceQuerySchema = z.object({
  tenantId: z.string().min(1),                       // WAJIB dari caller (tanpa default param)
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  adSpend: z.number().nonnegative().max(1e12).optional(),
});
export type MetaPerformanceQueryOptions = z.infer<typeof MetaPerformanceQuerySchema>;
export interface MetaPerformanceReport {
  meta: { tenantId: string; startDate: string; endDate: string; revenueBasis: object; truncated: boolean; dbNote?: string };
  kpiSummary: { newCustomersAcquired: number; initialRevenue: number; initialAov: number;
    repeatCustomersCount: number; repeatRevenue: number; totalAdRevenue: number;
    totalClinicRevenue: number; adRevenueSharePct: number;
    realCac?: number; costPerLead?: number; costPerMql?: number;
    initialRoas?: number; lifetimeRoas?: number; };
  funnel: { pageViews: number; totalClicks: number; matchedChats: number; unmatchedDrain: number;
    mqlLeads: number; newCustomers: number; conversionRates: Record<string, number>; coverageNote: string; ctrNote?: string };
  channelComparison: Array<{ channel: 'CTWA_NATIVE'|'PROMO_CTA'; leads: number; mql: number; firstTimeBuyers: number; initialRevenue: number; aov: number; meanJourneyDays: number|null }>;
  campaignBreakdown: Array<{ utmCampaign: string; source: string|null; clicks: number; chats: number; mql: number; buyers: number; initialRevenue: number; status: string }>;
  journeyVelocity: { meanDays: number|null; medianDays: number|null; brackets: Array<{ key: string; label: string; count: number; pct: number }> };
  bookingLeadTime: Array<{ key: string; label: string; count: number; pct: number }>;
  treatmentPreferences: Array<{ category: string; name: string; orders: number; revenue: number }>;
  leakageDiagnostics: { topDropOffStates: Array<{ state: string; count: number }>; outOfCoverageCount: number; topRegions: Array<{ region: string; count: number }>; followUpRecovery: { sent: number; byStatus: Record<string,number> } };
}
export async function getMetaPerformanceReport(opts: MetaPerformanceQueryOptions): Promise<MetaPerformanceReport>;
```

Implementasi wajib (urutan prosedural di dalam fungsi):

1. `const q = MetaPerformanceQuerySchema.parse(opts);` lalu hitung `[start,end]` WIB (default 30 hari).
2. `try { ... } catch { return ZERO_REPORT(q, dbNote) }` — objek nol lengkap (bukan throw), agar offline-safe.
3. Query agregat ringan via `Promise.all`: `landingPageView.count`, `adClick.count`, `adClick.count(matched)`, `customer.count(mql range + all-time untuk konteks)`, `reservation.count` per status antrian — SEMUA dengan `tenant_id + SANDBOX_EXCLUDE + BOT_EXCLUDE_CLAUSE` (salin klausa `meta-attribution.subroute.ts:56-64`, jangan tulis ulang daftar bot dari nol).
4. Ambil `adClick matched + customer` Dana `reservations qualifying + customer` dengan `select` minimal + `take 5000` (lihat §0.5). Hitung first-ever di memori via `Map<customerId, minCreatedAt>` (O(n), tanpa N+1).
5. `treatmentFee/deliveryFee/totalFee` via seam §0.2. `campaignBreakdown.source` = `utmSource/utmMedium` mentah; `status` = 'MATCHED'|'PENDING' agregat (bukan status reservasi).
6. `leakageDiagnostics`: `topDropOffStates` dari `Conversation.current_state + is_human_handling` untuk prospek non-closing (top 5, bukan hafalan kalimat); `outOfCoverageCount` dari `Customer.is_out_of_coverage=true` pada kohort iklan; `topRegions` dari `kecamatan/kota` (top 10); `followUpRecovery` dari `FollowUp NO_PURCHASE` pada kohort iklan (`count + groupBy status`).
7. `responseCacheService.get/set('meta-perf:${tenantId}:${start}:${end}', report, 30)` di level route ATAU service (satu tempat saja — pilih service agar reusable; route tidak cache ganda).

Perintah verifikasi Fase 1:

```powershell
npm run build
npx vitest run tests/unit/meta-performance-analytics.test.ts
```

Regression Gate 1: `tsc` exit 0; service mengembalikan ZERO_REPORT saat prisma melempar (uji offline hijau); tidak ada query tanpa `tenant_id`; tidak ada field baru di Prisma (tanpa migrasi di fase ini).

---

## 3. Fase 2 — Admin API + RBAC Seed (2 file rute + 1 migrasi seed)

Blast radius: RENDAH (1 GET read-only + seed scope baca).

### Micro-task 2.1 — Route `GET /api/admin/meta-performance` di `src/routes/admin/meta-attribution.subroute.ts`

Lokasi sisip: di dalam `metaAttributionAdminRoutes(fastify)`, SETELAH blok `/meta-summary` (akhir ~`meta-attribution.subroute.ts:421`), SEBELUM `/meta-capi-test`.

```ts
fastify.get('/api/admin/meta-performance', async (request: FastifyRequest<{ Querystring: any }>, reply: FastifyReply) => {
  const query: any = request.query || {};
  // tenantId WAJIB dari konteks (jangan hardcode): staf → staffTenantId, admin key → DEFAULT_TENANT_ID.
  const tenantId = (request as any).staffTenantId || DEFAULT_TENANT_ID;
  const parsed = MetaPerformanceQuerySchema.safeParse({
    tenantId,
    startDate: typeof query.startDate === 'string' ? query.startDate : undefined,
    endDate: typeof query.endDate === 'string' ? query.endDate : undefined,
    adSpend: query.spend !== undefined ? Number(query.spend) : undefined,
  });
  if (!parsed.success || (parsed.data.adSpend !== undefined && !isFinite(parsed.data.adSpend))) {
    return reply.status(400).send({ success: false, error: 'Parameter startDate/endDate (YYYY-MM-DD) atau spend tidak valid.' });
  }
  try {
    const data = await getMetaPerformanceReport(parsed.data);
    return reply.status(200).send({ success: true, data });
  } catch (err: any) {
    // Degrade-silent konsisten dengan file ini: 200 + dbNote, bukan 500 (pola :167-181, :310-339).
    return reply.status(200).send({ success: true, data: zeroMetaPerformanceReport(tenantId), dbNote: `DB offline: ${String(err?.message||err).slice(0,160)}` });
  }
});
```

Alasan prefix `/api/admin/meta-performance` (BUKAN `/api/admin/debug/...`): prefix `/debug` = Super-Admin only (`admin.route.ts:198-215`). Prefix baru memungkinkan advertiser read-only via seed di bawah.

### Micro-task 2.2 — Migrasi seed scope baca advertiser (tanpa ubah guard)

Buat migrasi Prisma baru (nama contoh `20261002000000_allow_meta_performance_for_advertiser/migration.sql`, sesuaikan timestamp riil saat eksekusi):

```sql
-- Seed read-only untuk peran advertiser ke endpoint baru. Idempoten (IF NOT EXISTS / ON CONFLICT DO NOTHING).
INSERT INTO role_api_scopes (id, tenant_id, role_key, api_prefix, methods, created_at, updated_at)
VALUES (gen_random_uuid(), 'default-tenant', 'advertiser', '/api/admin/meta-performance', 'GET', NOW(), NOW())
ON CONFLICT (tenant_id, role_key, api_prefix) DO NOTHING;
```

Verifikasi pola kolom di `schema.prisma:888-902` (`RoleApiScope: tenant_id, role_key, api_prefix, methods`) dan preseden `20260930000000_allow_push_for_therapist` sebelum tulis SQL final. Role tanpa baris = legacy (tidak dipaksa); role `advertiser` yang sudah managed = default-deny kecuali prefix ini.

### Micro-task 2.3 — API client `packages/admin-dashboard/src/services/api.ts`

Tambah SETELAH `fetchMetaSummary` (`api.ts:76-84`):

```ts
export function fetchMetaPerformance<T = any>(params: { startDate?: string; endDate?: string; spend?: number } = {}): Promise<T> {
  const q = new URLSearchParams();
  if (params.startDate) q.set('startDate', params.startDate);
  if (params.endDate) q.set('endDate', params.endDate);
  if (params.spend !== undefined) q.set('spend', String(params.spend));
  const qs = q.toString();
  return apiRequest(`/api/admin/meta-performance${qs ? `?${qs}` : ''}`);
}
```

Tidak ada `Cache-Control` custom — andalkan `responseCacheService` backend + `refreshApi` frontend saat tombol Muat Ulang.

Perintah verifikasi Fase 2:

```powershell
npm run build
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
```

Regression Gate 2: `tsc` exit 0; drift check hanya menampilkan seed baru (tidak ada drift skema lain — peringatan `FollowUpStatus` di AGENTS.md tetap berlaku); GET tanpa tanggal → default 30 hari 200; `spend=abc` → 400; advertiser GET → 200 (bila seed), POST ke prefix ini → 404/403 (read-only).

---

## 4. Fase 3 — Frontend Tab Modular (tanpa page baru, tanpa dep baru)

Blast radius: MENENGAH (1 page eksisting + N komponen baru kecil; tidak ada rute baru).

### Micro-task 3.1 — Struktur file (wajib, anti-bloat `MetaClickCatcher.tsx`)

```
packages/admin-dashboard/src/pages/tenant/MetaClickCatcher.tsx   (EDIT: tambah tab wrapper + filter bar bersama saja)
packages/admin-dashboard/src/components/meta-performance/SpendCalculator.tsx   (BARU: input spend + badge CAC/CPL/CPMQL/ROAS)
packages/admin-dashboard/src/components/meta-performance/KpiGrid.tsx           (BARU: 6 kartu KPI)
packages/admin-dashboard/src/components/meta-performance/FunnelBars.tsx        (BARU: PageViews→Clicks→Chats→MQL→Buyers + % drop-off)
packages/admin-dashboard/src/components/meta-performance/ChannelTable.tsx      (BARU: CTWA_NATIVE vs PROMO_CTA)
packages/admin-dashboard/src/components/meta-performance/CampaignTable.tsx     (BARU: per utmCampaign)
packages/admin-dashboard/src/components/meta-performance/JourneyHistogram.tsx (BARU: recharts BarChart, pola FinancialAnalytics.tsx:498-541, lazy import)
packages/admin-dashboard/src/components/meta-performance/LeakageGrid.tsx      (BARU: top layanan + wilayah + choke points + follow-up)
```

Aturan: `MetaClickCatcher.tsx` HANYA berisi: header + `activeTab: 'performance'|'observability'` + filter bar bersama (reuse `startDate/endDate/status/search/utmCampaign` + `setDatePreset` yang SUDAH ADA di `:412-437` — JANGAN buat preset kedua) + `<SpendCalculator/>` + komponen panel. Seluruh JSX tabel/chart pindah ke komponen. DILARANG `window.confirm/alert` (pakai `useUiFeedback` yang sudah diimpor `:3`).

### Micro-task 3.2 — Tab navigation (sisip di `MetaClickCatcher.tsx:442-458`, setelah header)

```tsx
const [activeTab, setActiveTab] = useState<'performance' | 'observability'>('performance');
// ... di bawah header, di atas dbNote:
<div className="flex gap-2 border-b border-[#e9edef]">
  <button onClick={() => setActiveTab('performance')} className={activeTab==='performance' ? 'tab-active' : 'tab-idle'}>📊 Performa Iklan & Penjualan (CAC & ROI)</button>
  <button onClick={() => setActiveTab('observability')} className={activeTab==='observability' ? 'tab-active' : 'tab-idle'}>🛠️ Log Klik & Observability CAPI</button>
</div>
// Tab observability = SEMUA section eksisting (KPI cards lama, tabel klik, manual sender, CAPI tester) dibungkus {activeTab==='observability' && (...)}.
// Tab performance = filter bar bersama + komponen Fase 3.1 dibungkus {activeTab==='performance' && (...)}.
// Kedua tab MEMAKAI startDate/endDate/utmCampaign/search yang sama (satu sumber kebenaran).
```

### Micro-task 3.3 — Spend calculator & KPI (komponen baru, bukan inline)

- `SpendCalculator`: input number Rp (controlled, debounce 500ms) → panggil `fetchMetaPerformance({startDate,endDate,spend})` → badge: Real CAC (`spend/newCustomers`), Cost/Chat, Cost/MQL, Initial ROAS, LTV ROAS. Nilai `undefined` (tanpa spend atau pembagi 0) tampil `-`, bukan `Infinity/NaN`.
- `KpiGrid`: reuse pola `StatCard` (`MetaClickCatcher.tsx:163-173`, pindahkan ke shared bila perlu — JANGAN duplikat definisi): New Buyers, Initial Revenue, Repeat Revenue (LTV), Share % (`adRevenueSharePct`), Initial AOV, Median/Mean journey.
- `FunnelBars`: bar horizontal bertingkat + `%` antar tahap + `coverageNote/ctrNote` eksisting (`:468-479`) dipakai ulang (jangan tulis copy baru).
- `JourneyHistogram`: `recharts` `BarChart` + `XAxis/YAxis/Tooltip` (impor lazy `React.lazy`), data dari `journeyVelocity.brackets`.
- `CampaignTable/ChannelTable/LeakageGrid`: tabel biasa + `Pagination` eksisting (`:4`) bila >15 baris.

Perintah verifikasi Fase 3:

```powershell
Set-Location packages/admin-dashboard
npm run build
```

Regression Gate 3: `tsc && vite build` hijau; tidak ada dep baru di `package.json`; bundle tidak naik >10% vs baseline (catat angka); tab lama (observability) render identik (tidak ada regresi CAPI debugger); tidak ada `confirm()/alert()` di file baru (grep wajib bersih).

---

## 5. Fase 4 — Pengujian Adversarial + Verifikasi Menyeluruh (wajib multi-frasa, bukan happy-path)

Blast radius: RENDAH (1 file test baru + run suite).

### Micro-task 4.1 — File `tests/unit/meta-performance-analytics.test.ts` (skenario WAJIB, bukan opsional)

Gunakan scoped-double per-file untuk `landingPageView` (yang tidak ada di `tests/setup.ts` global — JANGAN ubah mock global):

```ts
// Pola: vi.spyOn((prisma as any), 'landingPageView', 'get') atau injeksi prisma mock scoped-test
// seperti pola getTripStatusMessageText (lihat audit §1). Setiap test reset antar-case.
```

Kasus wajib (RED-capable, tiap kasus minimal 2 parafrase/variasi data bila relevan):

1. **CAC vs LTV split:** customer A first-ever dalam periode → New+initial; customer B first-ever di luar periode + repeat dalam periode → hanya repeat; customer C order pertama `cancelled` lalu closing kedua dalam periode → closing kedua = New (bukti F1).
2. **Sandbox/staff exclusion:** customer `is_sandbox_test/is_internal_staff` dengan reservasi → NOL di semua metrik.
3. **Revenue seam:** `purchase_value` NULL/0 → fallback katalog `resolveTreatmentValue`; `delivery_fee` snapshot vs fallback `Customer.ongkir`; `cancelled/rejected` excluded; `pending/hold` tidak masuk revenue.
4. **Kanal:** `ctwa_clid` set → CTWA_NATIVE; promo-code/`whatsapp_direct` → PROMO_CTA; `utmMedium` mentah tetap diaudit.
5. **Journey:** matchedAt→created_at lintas hari WIB; `booking_date` NULL → bucket TANPA_TANGGAL (bukan 0); median genap/ganjil; mean vs median.
6. **ROAS/CAC:** tanpa spend → field `undefined` (bukan NaN); spend 0 → guard; pembagi 0 → `-`/undefined.
7. **Offline:** semua metode prisma reject → ZERO_REPORT 200-ready tanpa unhandled rejection.
8. **Tenant isolasi:** data tenant B tidak bocor ke tenant A.

### Micro-task 4.2 — Eksekusi berurutan (STOP bila satu gate merah)

```powershell
npx vitest run tests/unit/meta-performance-analytics.test.ts
npm test
npm run build
Set-Location packages/admin-dashboard; npm run build
```

Regression Gate 4: file baru hijau 100%; full suite hijau tanpa skip baru; kedua build hijau; tidak ada regresi halaman observability.

---

## 6. Fase 5 — Dokumentasi Wajib (bukan opsional)

1. `CHANGELOG.md`: entri baru format Keep a Changelog (`Added` + `Fixed` bila menyentuh #179), sebut file + kontrak kanonis + batas `take 5000/truncated`.
2. `docs/KNOWN_ISSUES.md`: daftarkan sisa debt baru: (a) indeks komposit analytics bila EXPLAIN lambat (mirip #169a); (b) ambang `take 5000` + rencana agregasi SQL penuh bila tenant >5000 reservasi/periode; (c) `pending/hold` belum masuk revenue (keputusan produk).
3. Perbarui komentar kontrak di `meta-attribution.subroute.ts:189-206` bila definisi Purchase berubah (jangan biarkan dua definisi Purchase berbeda hidup berdampingan tanpa rujukan silang).

---

## 7. Matriks Kepatuhan Ulang (revisi ini)

| Mandat | Status revisi |
|---|---|
| Human Confirmation Gate | Dokumen ini BERHENTI di sini — butuh "Setuju/Lanjut eksekusi" tertulis sebelum Fase 0→1. Auto-approval sistem diabaikan. |
| Anti-Bloat / Modularity | Tab + komponen `components/meta-performance/*`, reuse StatCard/Pagination/preset tanggal. |
| Zero New Deps | Hanya `zod` (sudah ada), recharts/lucide/tailwind eksisting. |
| Data-Driven | Kanal, CAC, omzet, choke points dari DB/state, bukan hafalan kalimat/regex. |
| Offline-safe | ZERO_REPORT + scoped-double test; tanpa ubah `tests/setup.ts` global. |
| QA labeling | `SANDBOX_EXCLUDE` di semua query. |
| SaaS-readiness | `tenantId` dari request; seed RBAC advertiser; tanpa default param tersembunyi. |
| CHANGELOG + KNOWN_ISSUES | Fase 5 wajib. |

---

## 8. Keputusan & Konfirmasi Pengguna (WAJIB diisi sebelum eksekusi)

Revisi ini belum dieksekusi (tanpa edit `src/`, tanpa migrasi, tanpa perintah terminal selain baca).
Silakan pilih salah satu dan ketik eksplisit di chat:

- **(a) "Setuju, eksekusi Fase 0-1 dulu"** → saya mulai dari kontrak + service backend saja, lalu BERHENTI untuk gate berikutnya.
- **(b) "Setuju, eksekusi semua fase"** → saya jalankan berurutan Fase 0→5 dengan gate tiap fase (tetap berhenti bila satu gate merah).
- **(c) "Revisi lagi: ..."** → sebutkan bagian yang perlu diubah (mis. definisi revenue termasuk `pending`, atau endpoint tetap di `/debug`).

Tanpa salah satu jawaban di atas, saya TIDAK akan menyentuh kode.
