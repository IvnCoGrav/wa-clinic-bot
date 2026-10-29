# PLAN (REVISI): Otoritas Identitas Pelanggan Berbasis Provenance — 2026-10-29

> **Status: DRAFT — BELUM DIEKSEKUSI.** Eksekusi hanya boleh dimulai setelah pengguna manusia menuliskan persetujuan eksplisit ("Setuju/Lanjut") di chat. Plan ini menggantikan versi "Penegakan Otoritas Reservasi & Arsitektur Identitas Pelanggan Berbasis State Machine (Revisi Kepatuhan Penuh)" yang diaudit pada 2026-10-29.

## 0. Ringkasan Perubahan dari Plan Lama

| # | Plan lama | Masalah (bukti) | Revisi |
|---|---|---|---|
| 1 | Otoritas ditentukan `prisma.reservation.count()` di dalam `updateCustomerName` | `tests/setup.ts:105-113` mem-mock `reservation.count` agar **selalu reject**; query diletakkan di luar `try` (`customer.service.ts:978-984`) → semua unit test gagal & produksi throw saat DB hiccup | Otoritas ditentukan **kolom provenance** (`name_source`), bukan hitungan reservasi. Tidak ada query tambahan di hot-path |
| 2 | Kirim `{ source: 'RESERVATION' }` tanpa `reservationId` di `machine.ts:423` | `saveReservation` di `machine.ts:370` hasilnya dibuang → `reservationId` tidak tersedia → baris yang baru dibuat ikut terhitung → pelanggan baru dianggap repeat → nama `nndw` tetap terkunci | Tulis nama di `machine.ts:423` **dihapus** (duplikat). Sumber tunggal: `reservation-core → reservation-lifecycle` yang sudah punya `reservationId` |
| 3 | Title Case di dalam `sanitizeCustomerNameForStorage` | Memecah assertion committed: `name-sanitizer.test.ts:122` (`'Bunda ella'`), `customer-name-protection.test.ts:220-221` | Sanitizer tetap **gate murni**. Title Case dilakukan di write-seam (phase 3), bukan di sanitizer |
| 4 | Ganti regex emoji dengan `\p{Extended_Pictographic}` | **Regresi**: flag (🇮🇩) tidak cocok property itu (diuji di Node), ZWJ `\u200D` & VS16 `\uFE0F` tersisa | Union property + strip eksplisit `[\u200D\uFE0F\u20E3\u{1F3FB}-\u{1F3FF}]` |
| 5 | Gate sanitizer dijalankan sebelum gate otoritas | Nama asli non-standar (marga `Ng`, ada digit) dibuang diam-diam → justru mempertahankan pushname | Evaluasi otoritas **dulu**; sumber `RESERVATION`/`ADMIN` hanya ditolak oleh gate placeholder murni |
| 6 | Zero-vowel ban global | False-positive pada marga/inisial legal → nama asli hilang | Zero-vowel hanya aktif untuk sumber `pushname`/`sync` (`strict: true`) |
| 7 | Skrip healing: hanya `isGenericCustomerName(current)` | `"Bunda anggi zulfika"` bukan generic → acceptance criterion Title Case **tidak tercapai** | Skrip healing punya 3 kelas aksi: (a) generic→pulihkan, (b) format→rapikan, (c) tak bisa dipulihkan→null |
| 8 | Skrip healing tanpa tenant/backup | `findMany` semua tenant, audit log hardcode `default-tenant`, cetak nomor HP, tanpa transaksi | Tenant-scoped, `--tenant`, `--limit`, masking, transaksi, backup, idempoten |
| 9 | Call-site hanya 4 | Aktual 9 penulis `Customer.name` (lihat Phase 4) | Semua penulis dikonvergensi ke satu seam |

## 1. Kontrak Kebenaran (Hierarchy of Truth)

Ranking monoton (`name_source`):

| Rank | Nilai | Penulis |
|---|---|---|
| 0 | `unknown` (NULL, data lama) | backfill/migrasi |
| 1 | `pushname` / `sync` | webhook WAHA, WAHA history sync, Google Contacts import |
| 2 | `reservation` | formulir reservasi (chat/WAHA form), admin parse form |
| 3 | `admin` | edit eksplisit admin di dashboard (force) |

Aturan tulis (deterministik, tanpa regex semantik):

```
incomingRank = RANK[source]
storedRank   = RANK[customer.name_source] ?? 0

if (name kosong/generic tersimpan)            -> TULIS        // pemulihan
else if (incomingRank > storedRank)           -> TULIS        // eskalasi otoritas
else if (incomingRank === storedRank) {
    if (normalized(incoming) === normalized(stored)) -> TULIS  // hanya rapikan kapitalisasi
    else -> TOLAK (log + audit)
}
else                                          -> TOLAK        // turun kasta
```

Konsekuensi yang disengaja (butuh persetujuan pada Q3):
- Pelanggan baru: `pushname (1)` → `reservation (2)` = **selalu menang**. Ini yang memperbaiki `nndw`/`pii`.
- Pelanggan lama: `reservation (2)` → `reservation (2)` dengan nama berbeda = **ditolak** (anti-pembajakan nama anak kedua). Koreksi typo hanya via admin (`rank 3`) atau skrip healing.
- Data lama (`name_source NULL = 0`): reservasi berikutnya otomatis memperbaiki nama. Backfill (Phase 2c) mencegah pelanggan lama ikut tertimpa.

## 2. Phase 0 — Baseline Gate (wajib lulus sebelum menyentuh kode)

```powershell
git status --porcelain          # harus kosong
npm run typecheck               # 0 error (baseline 2026-10-29: LULUS)
npx vitest run tests/unit/customer-name-protection.test.ts tests/unit/name-sanitizer.test.ts tests/unit/customer-name-healing.test.ts
```
Acceptance: 3 file hijau, `typecheck` exit 0. Jika ada yang merah, **berhenti** dan catat sebagai pre-existing (revert-and-rerun) sebelum lanjut.

## 3. Phase 1 — Sanitizer (murni teknis, tanpa Title Case)

### 1.1 `src/utils/name-sanitizer.ts` — normalisasi Unicode + emoji

Di awal `sanitizeCustomerNameForStorage` (sebelum semua regex) **dan** di awal `isGenericCustomerName`:

```ts
// NFKD: karakter estetis (ℍ𝕖𝕟𝕪) & superscript (²) → ASCII; buang combining mark.
name = name.normalize('NFKD').replace(/[\u0300-\u036F]/g, '');
```

Ganti baris emoji (`:354`) dengan:

```ts
// Emoji pictographic + flag + skin-tone + ZWJ/VS16/keycap residue.
name = name
  .replace(/\p{Extended_Pictographic}/gu, '')
  .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '')
  .replace(/[\u200D\uFE0F\u20E3\u{1F3FB}-\u{1F3FF}]/gu, '')
  .trim();
```

### 1.2 `isGenericCustomerName(name, opts?: { strictPushnameGate?: boolean })`

Tambahkan parameter opsional (default `false` = perilaku sekarang, kompatibel):

```ts
if (opts?.strictPushnameGate) {
  // Hukum fonetik: tanpa vokal (a,i,u,e,o) & tanpa y → inisial/handle/ketikan acak.
  const hasVowel = /[aeiou]/i.test(stripped);   // 'y' TIDAK dihitung vokal
  if (!hasVowel) return true;
}
```

Catatan: `y` sengaja tidak dihitung agar `ddy`/`Sry` tidak false-positive; `pii` tetap tidak tertangkap aturan ini (didokumentasikan di Known Issues, ditangani oleh otoritas provenance, bukan heuristik).

### Acceptance Phase 1

```powershell
npx vitest run tests/unit/name-sanitizer.test.ts tests/unit/customer-name-protection.test.ts
npx tsx -e "const{isGenericCustomerName:g,sanitizeCustomerNameForStorage:s}=require('./src/utils/name-sanitizer');console.log(g('nndw',{strictPushnameGate:true}),g('nv',{strictPushnameGate:true}),g('SR',{strictPushnameGate:true}),g('Ida',{strictPushnameGate:true}),JSON.stringify(s('Bunda ℍ𝕖𝕟𝕪 🫶')),JSON.stringify(s('Bunda 🇮🇩 Rina')))"
```
Harus: `true true true false "Bunda Heny" "Bunda Rina"`. Test lama **tidak boleh** diubah.

## 4. Phase 2 — Schema provenance (CONFIRMATION GATE)

> Migrasi aditif, 2 kolom nullable. **Butuh persetujuan eksplisit** (AGENTS.md: migrasi = Confirmation Gate). Jika ditolak → pakai **Mode B** di §9.

### 2.1 `prisma/schema.prisma` (`model Customer`)

```prisma
  /// Provenance nama: pushname|sync|reservation|admin (NULL = data lama/unknown).
  name_source             String?
  /// PushName mentah WhatsApp (audit & fallback tampilan; TIDAK dipakai untuk identitas).
  whatsapp_push_name      String?
```

### 2.2 Migrasi

```powershell
npx prisma migrate dev --name add_customer_name_provenance
```
`prisma/migrations/<ts>_add_customer_name_provenance/migration.sql` harus berisi hanya:

```sql
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "name_source" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "whatsapp_push_name" TEXT;
```

### 2.3 Backfill (data-driven, tanpa hardcode nama)

`src/scripts/backfill-customer-name-source.ts`:

```ts
// name_source='reservation' untuk customer yang PUNYA minimal 1 reservasi non-cancelled (fakta DB),
// 'pushname' bila nama terisi tanpa reservasi, NULL bila nama kosong.
await prisma.$executeRawUnsafe(`
  UPDATE customers c SET name_source = CASE
    WHEN c.name IS NULL OR btrim(c.name) = '' THEN NULL
    WHEN EXISTS (SELECT 1 FROM reservations r WHERE r.customer_id = c.id AND r.status <> 'cancelled')
      THEN 'reservation'
    ELSE 'pushname' END
  WHERE c.name_source IS NULL`);
```
Dry-run default, `--commit` untuk menulis, `--tenant=<id>` opsional.

### Acceptance Phase 2
```powershell
npx prisma migrate diff --from-url "$env:DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script   # "-- This is an empty migration."
npx tsx src/scripts/backfill-customer-name-source.ts            # dry-run: jumlah baris per kategori
```

## 5. Phase 3 — Seam kanonis `updateCustomerName`

### 3.1 `src/services/customer.service.ts:962-1009` — tulis ulang utuh

```ts
export type CustomerNameSource = 'pushname' | 'sync' | 'reservation' | 'admin';

const NAME_SOURCE_RANK: Record<string, number> = {
  unknown: 0, pushname: 1, sync: 1, reservation: 2, admin: 3,
};

public async updateCustomerName(
  customerId: string,
  name: string,
  tenantId: string,
  options?: { force?: boolean; source?: CustomerNameSource }
): Promise<any> {
  const source = options?.force ? 'admin' : (options?.source ?? 'sync');
  const current = await this.getCustomerById(customerId, tenantId);

  // 1) Otoritas lebih dulu (anti D5): sumber resmi hanya divalidasi placeholder murni.
  const isAuthoritative = source === 'reservation' || source === 'admin';
  const safeName = isAuthoritative
    ? sanitizeCustomerNameForStorage(name) || ''
    : sanitizeCustomerNameForStorage(name) || '';
  const candidate = safeName.trim();
  if (!candidate) return current;                       // anti data-loss
  if (!isAuthoritative && isGenericCustomerName(candidate, { strictPushnameGate: true })) return current;

  // 2) Provenance gate.
  const stored = (current?.name || '').trim();
  const storedRank = NAME_SOURCE_RANK[(current as any)?.name_source ?? 'unknown'] ?? 0;
  const incomingRank = NAME_SOURCE_RANK[source] ?? 0;
  const sameIdentity = stored.toLowerCase() === candidate.toLowerCase();
  const storedIsPlaceholder = !stored || isGenericCustomerName(stored);

  const allowed =
    source === 'admin' ||
    storedIsPlaceholder ||
    incomingRank > storedRank ||
    (incomingRank === storedRank && sameIdentity);
  if (!allowed) {
    console.log(`[CUSTOMER NAME SHIELD] tolak '${candidate}' (src=${source}) atas '${stored}' (src=${(current as any)?.name_source ?? 'unknown'}) customer=${customerId}`);
    return current;
  }

  const finalName = toTitleCasePreservingPrefix(candidate);   // Bunda/Ayah + Title Case
  ... // prisma.customer.update({ data: { name: finalName, name_source: source } }) + memory fallback
}
```

`toTitleCasePreservingPrefix` = helper murni baru di `src/utils/customer-name-healing.ts`:

```ts
export function toTitleCasePreservingPrefix(name: string): string {
  const m = /^(bunda|ayah)\s+(.*)$/i.exec(name.trim());
  if (!m) return toTitleCase(name);
  return `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${toTitleCase(m[2])}`;
}
```

### 3.2 `src/services/waha-history-sync.service.ts:248,482`
Tambahkan `{ source: 'sync' }`, dan simpan pushName mentah: `customer.whatsapp_push_name = contactName` (bukan ke `name`).

### 3.3 `src/services/customer.service.ts:198` (`getOrCreateCustomer`)
- `safeName` dari pushname → `sanitizeCustomerNameForStorage` lalu `isGenericCustomerName(..., { strictPushnameGate: true })`.
- `create({ name: null, whatsapp_push_name: rawName, name_source: null })` — **pushName tidak pernah** masuk `name`.

### Acceptance Phase 3
```powershell
npm run typecheck
npx vitest run tests/unit/customer-name-protection.test.ts tests/unit/customer-name-healing.test.ts
```

## 6. Phase 4 — Konvergensi seluruh penulis nama

| File | Baris (per 2026-10-29) | Aksi |
|---|---|---|
| `src/services/customer.service.ts` | 988 | kanonis (sudah) |
| `src/services/customer.service.ts` | 1076 (`updateCustomer`) | teruskan `source: 'admin'` (edit admin eksplisit) |
| `src/services/reservation-lifecycle.service.ts` | 58 | `{ source: 'reservation' }` (sudah punya `reservationId`) |
| `src/state-machine/machine.ts` | 416-427 | **hapus blok** (duplikat lifecycle; tidak punya `reservationId`) |
| `src/routes/admin/reservation-crud.route.ts` | 759 | `{ source: 'admin', force }` |
| `src/routes/admin/reservation-dispatch.route.ts` | 1245 | ganti tulis langsung `custUpdate.name` → `updateCustomerName(..., { source: 'admin' })` |
| `src/routes/admin/reservation-dispatch.route.ts` | 2206 | `{ source: 'reservation' }` |
| `src/routes/admin/reservation-series.service.ts` | 239 → lifecycle | ikut otomatis (kirim `customerName` bila ada) |
| `scripts/recover-lost-reservations.ts` | 127 | `{ source: 'reservation' }`; buang tempelan `kecamatan` ke nama |

Acceptance: `grep -rn "data: { name" src/ scripts/` hanya menyisakan `customer.service.ts:988` (seam) + skrip healing.

## 7. Phase 5 — Skrip healing (`src/scripts/heal-non-human-customer-names.ts`)

Tiga kelas aksi, semua **data-driven dari `reservations.raw_text`**:

| Kelas | Kondisi | Aksi |
|---|---|---|
| A | `isGenericCustomerName(current, {strict:true})` + ada nama valid di raw_text | ganti ke `Bunda <Nama>` |
| B | nama valid tapi format bukan Title Case | rapikan (`toTitleCasePreservingPrefix`) |
| C | generic & tidak ada raw_text valid | `null` |

Wajib:
- `--tenant=<id>` (default: semua tenant **dengan** filter eksplisit per tenant), `--limit=N`, dry-run default.
- Output PII ter-mask (pakai `src/utils/pii-masker.ts`).
- `--commit`: satu `prisma.$transaction` per batch + tabel audit `HEAL_CUSTOMER_NAME` (tenant_id **nyata**, bukan hardcode).
- Backup: `--export=backup.json` sebelum menulis.
- Idempoten: dry-run kedua setelah commit harus melaporkan 0 aksi.

## 8. Phase 6 — Test adversarial (wajib, bukan happy-path)

`tests/unit/customer-name-provenance.test.ts` (baru):

1. `pushname nndw` → `getOrCreateCustomer` menyimpan `name=null`, `whatsapp_push_name='nndw'`.
2. reservasi pertama (`source: 'reservation'`) → `name='Bunda Nandawulan'`, `name_source='reservation'`.
3. reservasi kedua nama berbeda (`source: 'reservation'`) → **ditolak**, nama master utuh.
4. reservasi kedua nama sama beda kapitalisasi → **diterima**, hanya format dirapikan.
5. `sync` setelah `reservation` → ditolak.
6. `admin` (`force`) setelah `reservation` → diterima.
7. Nama formulir tanpa vokal (`Ng`) tetap tersimpan (sumber resmi bypass zero-vowel).
8. `pushname 'Ng'` (sumber non-resmi) → ditolak, `name` tetap null.
9. Data lama `name_source=null` + reservasi baru → nama diperbaiki (self-heal).
10. Emoji/flag/ZWJ: `'Bunda 🇮🇩 Heℕy 🫶'` → `'Bunda Heny'` (tanpa residu).
11. Ambang: `name` kosong dari formulir → nama lama tidak hilang.
12. Tenant isolation: nama di tenant B tidak tersentuh oleh heal tenant A.

Gate: `npx vitest run tests/unit/customer-name-provenance.test.ts tests/unit/customer-name-protection.test.ts tests/unit/name-sanitizer.test.ts`

## 9. Mode B — Tanpa migrasi (fallback bila Phase 2 ditolak)

- Provenance disimpan di `Customer.preferences.__nameSource` (JSON yang sudah ada) + `preferences.__pushName`.
- Logika `updateCustomerName` identik; hanya `readSource()`/`writeSource()` yang berbeda.
- Konsekuensi: tidak bisa di-query/index, rawan tertimpa `updateCustomer` yang menulis `preferences` utuh (`customer.service.ts:1115`) — **wajib** merge, bukan replace.

## 10. Phase 7 — Gate deploy

```powershell
npm run typecheck                 # 0 error
npm test                          # full suite; failure baru = blocker
# bukti pre-existing bila ada: revert file ke HEAD → test sama → harus tetap gagal
```
Deploy (butuh persetujuan manusia, jam sepi, `deploy_config.txt`):
```bash
git pull origin master
docker compose build app && docker compose up -d --no-deps app
docker compose ps                                   # healthy
curl -s -o /dev/null -w "%{http_code}\n" https://app.kalababyspa.online/health
curl -s -o /dev/null -w "%{http_code}\n" "https://app.kalababyspa.online/cta?divisi=iklan-utama"
```
Sebelum `heal --commit`: backup tabel `customers` (`pg_dump -t customers`), simpan 7 hari. Rollback: `git revert` + `migrate resolve` **tidak** menghapus kolom (aditif, aman dibiarkan).

## 11. FMEA Ringkas (urutan eksekusi)

| Phase | Risiko utama | S | O | D | RPN | Mitigasi |
|---|---|---|---|---|---|---|
| 1 | Nama asli hilang karena heuristik | 7 | 3 | 4 | 84 | strict gate hanya non-resmi |
| 2 | Migrasi produksi | 9 | 2 | 2 | 36 | aditif + IF NOT EXISTS + backup |
| 3 | Nama tidak ter-update (salah kasta) | 6 | 4 | 3 | 72 | test matrix 12 skenario |
| 4 | Penulis tertinggal → kontrak bocor | 5 | 5 | 6 | 150 | grep gate + test integrasi |
| 5 | Healing salah tulis massal | 8 | 3 | 2 | 48 | dry-run + backup + transaksi + idempoten |
| 7 | Deploy 502 | 5 | 3 | 2 | 30 | runbook existing |

## 12. Known Issues yang WAJIB dicatat (docs/KNOWN_ISSUES.md)

- `pii`/`ddy` tidak tertangkap zero-vowel (y dihitung/diabaikan) → diselesaikan oleh provenance, bukan heuristik.
- Mode B: provenance di JSON tidak ter-index & rawan overwrite `preferences`.
- Nama legal tanpa vokal (`Ng`) dari formulir tetap disimpan, tetapi **tidak** bisa dipulihkan otomatis bila sudah terlanjur jadi pushname.
