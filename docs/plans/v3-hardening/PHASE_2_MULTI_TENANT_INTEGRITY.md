# PHASE 2: INTEGRITAS DATA MULTI-TENANT & CONCURRENCY CONTROL

> **Estimasi Total:** 3–5 Hari Kerja  
> **Prasyarat:** Phase 1 selesai.  
> **Tujuan Strategis:** Mengisolasi data katalog layanan antar tenant di level in-memory cache dan mengeliminasi race condition (read-modify-write hazard) saat customer mengirim pesan ganda dalam waktu berdekatan (<500ms).

---

## 🔹 MIKRO-TASK 2.1 — Partitioning Cache Katalog Multi-Tenant (ID: A2-05)

### 1. Masalah & Lokasi Kode
Di `src/services/treatment-catalog.service.ts` baris 35 & 431–432:
```typescript
const serviceCatalog: Map<string, ClinicServiceItem> = new Map();
...
export async function loadServicesFromDb(tenantId: string): Promise<void> {
  ...
  serviceCatalog.clear(); // ❌ MENGHAPUS KATALOG TENANT LAIN!
  dbServices.forEach((s) => { serviceCatalog.set(s.service_id, ...); });
}
```
`serviceCatalog` adalah `Map` tunggal global. Jika tenant A dan tenant B di-load bersamaan, tenant B akan menghapus data tenant A dari memori.

### 2. Modifikasi: `src/services/treatment-catalog.service.ts`
Ubah `serviceCatalog` menjadi nested Map per-tenant:

```typescript
// Ganti baris 35:
// SEBELUM:
// const serviceCatalog: Map<string, ClinicServiceItem> = new Map();

// SESUDAH:
// Struktur: Map<tenantId, Map<serviceId, ClinicServiceItem>>
const tenantServiceCatalog: Map<string, Map<string, ClinicServiceItem>> = new Map();

/** Helper untuk mendapatkan atau membuat catalog map per-tenant */
function getTenantCatalog(tenantId: string = DEFAULT_TENANT_ID): Map<string, ClinicServiceItem> {
  let cat = tenantServiceCatalog.get(tenantId);
  if (!cat) {
    cat = new Map<string, ClinicServiceItem>();
    tenantServiceCatalog.set(tenantId, cat);
  }
  return cat;
}
```

Perbarui `loadServicesFromDb` (baris 423–435):
```typescript
export async function loadServicesFromDb(tenantId: string): Promise<void> {
  try {
    const { prisma } = await import('../db/client');
    const dbServices = await prisma.clinicService.findMany({
      where: { tenant_id: tenantId },
      orderBy: { sort_order: 'asc' },
    });

    const targetCatalog = getTenantCatalog(tenantId);
    targetCatalog.clear(); // ✅ HANYA menghapus cache milik tenant yang bersangkutan!

    if (dbServices.length > 0) {
      dbServices.forEach((s) => {
        // ... mapping logic tetap sama ...
        targetCatalog.set(s.service_id, mappedItem);
      });
    } else {
      // Fallback: seed default services ke catalog tenant ini
      DEFAULT_CLINIC_SERVICES.forEach((s) => targetCatalog.set(s.id, { ...s }));
    }
  } catch (err: any) {
    console.warn(`[TREATMENT CATALOG] DB load failed for tenant ${tenantId}:`, err.message);
  }
}
```

Perbarui `getAllServices`, `getServiceById`, `upsertService`, `deleteService` di kelas `TreatmentCatalogService` agar menerima parameter opsional `tenantId: string = DEFAULT_TENANT_ID` dan memanggil `getTenantCatalog(tenantId)`.

Lalu di `src/v3/tools/get-catalog.tool.ts`:
Pastikan pemanggilan `treatmentCatalogService.getAllServices(true)` di baris 79 menyertakan `ctx.tenantId`:
```typescript
// Di src/v3/tools/get-catalog.tool.ts:
export async function executeGetCatalog(input: GetCatalogInput, tenantId: string = DEFAULT_TENANT_ID): Promise<GetCatalogOutput> {
  const allServices = treatmentCatalogService.getAllServices(true, tenantId);
  // ...
}
```

### 3. Acceptance Test & Verifikasi
Buat unit test di `tests/unit/services/multi-tenant-catalog.test.ts`:
1. Load katalog untuk Tenant A (`tenant_alpha`) dengan 3 layanan.
2. Load katalog untuk Tenant B (`tenant_beta`) dengan 5 layanan berbeda.
3. Periksa `treatmentCatalogService.getAllServices(true, 'tenant_alpha')` → tepat 3 item Tenant A.
4. Periksa `treatmentCatalogService.getAllServices(true, 'tenant_beta')` → tepat 5 item Tenant B.
**Kriteria Lolos:** Cache Tenant A tidak terhapus saat Tenant B dimuat.

---

## 🔹 MIKRO-TASK 2.2 — Concurrency Serializer & Optimistic Locking pada GoalTracker (ID: A3-02)

### 1. Masalah & Lokasi Kode
Di `src/v3/state/goal-tracker.ts` baris 135–175 (`updateGoalSession`):
Jika pengguna mengirim pesan 1 (berisi lokasi) dan pesan 2 (berisi pilihan treatment) secara paralel dalam selang 200ms:
- Worker 1 membaca session A (tanpa lokasi & treatment).
- Worker 2 membaca session A (tanpa lokasi & treatment).
- Worker 1 selesai memproses lokasi dan menulis `{ location: 'Pepe' }`.
- Worker 2 selesai memproses treatment dan menulis `{ selectedTreatment: 'Pijat Ceria' }`, **MENIMPA dan MENGHAPUS** lokasi yang baru ditulis Worker 1!

### 2. Modifikasi: `src/v3/state/goal-tracker.ts`
Terapkan **In-Memory Per-Conversation Promise Mutex** untuk men-serialize eksekusi update per percakapan:

```typescript
// Tambahkan di atas kelas GoalTracker:
const conversationLocks = new Map<string, Promise<any>>();

/**
 * Memastikan fungsi callback untuk conversationId yang sama dieksekusi
 * secara berurutan (serialized queue) tanpa race condition.
 */
async function withConversationLock<T>(conversationId: string, fn: () => Promise<T>): Promise<T> {
  const currentLock = conversationLocks.get(conversationId) || Promise.resolve();
  let release: () => void;
  const nextLock = new Promise<void>((resolve) => { release = resolve; });
  conversationLocks.set(conversationId, currentLock.then(() => nextLock));

  await currentLock;
  try {
    return await fn();
  } finally {
    release!();
    if (conversationLocks.get(conversationId) === nextLock) {
      conversationLocks.delete(conversationId);
    }
  }
}
```

Bungkus body `updateGoalSession` dengan `withConversationLock`:
```typescript
public static async updateGoalSession(
  conversationId: string,
  updates: Partial<CustomerGoalSession>,
  tenantId = DEFAULT_TENANT_ID
): Promise<CustomerGoalSession> {
  return withConversationLock(conversationId, async () => {
    // Baca state paling segar di dalam lock
    const current = await this.getGoalSession(conversationId, tenantId);
    const merged: CustomerGoalSession = {
      ...current,
      ...updates,
      location: updates.location ? { ...current.location, ...updates.location } : current.location,
      childProfile: updates.childProfile ? { ...current.childProfile, ...updates.childProfile } : current.childProfile,
      booking: updates.booking ? { ...current.booking, ...updates.booking } : current.booking,
    };

    try {
      const conv = await prisma.conversation.findFirst({ where: { id: conversationId, tenant_id: tenantId } });
      if (conv?.customer_id) {
        const updateData: any = { preferences: merged };
        if (merged.customerName) updateData.name = merged.customerName;
        if (merged.location) {
          if (merged.location.kelurahan) updateData.kelurahan = merged.location.kelurahan;
          if (merged.location.kecamatan) updateData.kecamatan = merged.location.kecamatan;
          if (merged.location.kota) updateData.kota = merged.location.kota;
          if (merged.location.distanceKm != null) updateData.distance_km = merged.location.distanceKm;
          if (merged.location.ongkirPromo != null || merged.location.ongkirNormal != null) {
            updateData.ongkir = merged.location.ongkirPromo || merged.location.ongkirNormal;
          }
          if (merged.location.isOutOfCoverage != null) updateData.is_out_of_coverage = merged.location.isOutOfCoverage;
        }

        await prisma.customer.updateMany({
          where: { id: conv.customer_id, tenant_id: tenantId },
          data: updateData,
        });
      }
    } catch (err: any) {
      console.warn('[GOAL TRACKER UPDATE ERROR]', err.message);
    }

    return merged;
  });
}
```

### 3. Acceptance Test & Verifikasi
Buat concurrency test di `tests/unit/v3/goal-tracker-concurrency.test.ts`:
```typescript
it('menangani 2 pembaruan paralel tanpa kehilangan data', async () => {
  const convId = 'test_conv_concurrent';
  // Jalankan 2 update bersamaan
  const p1 = GoalTracker.updateGoalSession(convId, { location: { rawText: 'Waru', kelurahan: 'Tropodo' } });
  const p2 = GoalTracker.updateGoalSession(convId, { selectedTreatment: 'Pijat Ceria' });
  await Promise.all([p1, p2]);

  const finalState = await GoalTracker.getGoalSession(convId);
  expect(finalState.location?.kelurahan).toBe('Tropodo');
  expect(finalState.selectedTreatment).toBe('Pijat Ceria');
});
```
**Kriteria Lolos:** Keduanya berhasil tersimpan tanpa ada data yang tertimpa (`location` dan `selectedTreatment` sama-sama ada di session akhir).

---

## 📋 Checklist Validasi Phase 2
- [ ] Task 2.1 selesai: in-memory catalog terisolasi per `tenantId`.
- [ ] Task 2.2 selesai: serial lock mencegah hazard penimpaan concurrent update.
- [ ] Jalankan regression suite: `npm test`.
