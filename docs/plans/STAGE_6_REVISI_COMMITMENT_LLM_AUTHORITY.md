# STAGE 6 (REVISI) — Wewenang Komitmen Diserahkan ke Call 1 (LLM), Bukan Heuristik

- **Status:** RENCANA — menunggu review & persetujuan. Belum ada perubahan kode.
- **Sumber:** Audit V3 RC-05 (commitment semantics) + koreksi arah dari user (tidak menambah API call; Call 1 sudah ada).
- **Prinsip:** AI (LLM) = semantic reasoner; keputusan "tanya vs beli" memakai konteks percakapan penuh via Call 1 yang SUDAH dipanggil. Kode deterministik hanya sebagai *pagar state*, bukan otak.

---

## 1. Masalah (terbukti)

Keputusan "customer bertanya atau membeli" saat ini diambil **dua kali, dua-duanya tanpa konteks LLM**, dan keduanya mendahului/menggantikan pemahaman Call 1:

1. `generation-stage.ts:406` — `extractFastIntents(cleanIncomingText)` (string matching) menentukan intent.
2. `generation-stage.ts:447` — `evaluateToolMasking(...)` (string + state) menentukan tool yang dikirim.
3. `cart-manager.ts:500` — `isConsultativeQuestion = text.includes('?') && ...` menentukan cart terisi/tidak.

Call 1 (`routeTools`, `generation-stage.ts:483-505`) **sudah** LLM dengan history + system prompt, tetapi ia hanya menerima **hasil** keputusan pra-LLM (tool sudah di-mask/di-force). Ia tidak diberi wewenang memberi verdict komitmen.

**Bukti empiris (test reproduksi, sudah dijalankan):**
- `tests/unit/v3/cart-declarative-consultation.test.ts` → **2 gagal**: "pijat pulih ceria buat adek umur 3 bulan bisa nggak" & "pijat oksitosin itu untuk ibu melahirkan ya" → masuk cart (seharusnya konsultasi).
- 2 kasus komitmen sah ("boleh bund", "boleh deh bunda, pijat ceria buat adek") → benar (cart terisi).

---

## 2. Arah solusi (tanpa API call baru)

Call 1 yang sudah ada mengeluarkan **verdict terstruktur** dalam **satu** respons (via tool-call argumen atau field terstruktur), lalu `CartManager` & `tool-masker` **membaca verdict itu** alih-alih menghitung ulang dari string.

Verdict minimal:
- `commitment`: `EXPLORING` (tanya/cerita) | `CONSIDERING` (minat, belum pasti) | `COMMITTED` (memutuskan beli).
- `referencedServiceIds`: layanan yang benar-benar dirujuk/dipilih pada turn ini (opsional).
- `handoffRequested`: boolean (permintaan manusia) — prioritas tertinggi.

Pagar deterministik tetap ada, tetapi **berbasis state**: mis. selama `commitment !== COMMITTED`, tool `save_reservation` tetap di-mask dan agregasi total tidak ditampilkan. Pagar itu soal **state**, bukan mencocokkan kalimat.

---

## 3. Perubahan kontrak (yang perlu direview)

| Komponen | Sekarang | Setelah |
|---|---|---|
| `routeTools` (`generation-stage.ts:393`) | kembalikan `RoutingOutput` (tool calls + content) | + `commitment` + `referencedServiceIds` + `handoffRequested` |
| `CartManager.syncCartItems` (`cart-manager.ts:122`) | hitung sendiri tanya/beli dari string | terima `commitment` sebagai parameter; mutasi cart hanya bila `COMMITTED` (atau afirmasi anasforik sah yang dikonfirmasi Call 1) |
| `evaluateToolMasking` (`tool-masker.ts:242`) | ambil keputusan dari string+state | tetap memakai state; prasyarat treatment/lokasi/tanggal tetap deterministik, tetapi "komitmen" dibaca dari verdict Call 1 |
| `extractFastIntents` (`persona.ts:22`) | menentukan intent pra-LLM | tetap ada untuk forcing deterministik keamanan (lokasi/vaksin/jatuh), tetapi **tidak** lagi menjadi otoritas "beli vs tanya" |

**Catatan penting:** forcing keamanan deterministik (lokasi `calculate_delivery`, vaksin, jatuh) **dipertahankan** — itu garda keselamatan klinis, bukan keputusan komitmen.

---

## 4. Mengapa test lama berubah, bukan "dilonggarkan"

Beberapa test (mis. `cart-consultation-gate.test.ts`, `cart-declarative-consultation.test.ts`) mengunci perilaku string-matching. Setelah kontrak berubah, test tersebut **memang harus diperbarui** karena spesifikasinya berubah: keputusan pindah ke LLM verdict. Ini **bukan** penurunan validasi demi test pass; ini pemindahan tanggung jawab yang disetujui.

Test yang **wajib tetap hijau tanpa perubahan** (kontrak keamanan/komitmen): masking `save_reservation` saat belum COMMITTED, forcing lokasi/vaksin/jatuh, anti-cart-dari-pesan-asisten.

---

## 5. Rencana bertahap (micro-task)

### ST6-1 — Definisikan kontrak verdict (types saja)
- **Files:** `src/v3/domain/types.ts` (tambah tipe `CommitmentLevel`, `TurnInterpretation`).
- **Steps:** tambah tipe; belum dipakai produksi.
- **Acceptance:** `npx tsc --noEmit` 0.
- **Risiko:** nol (tipe saja).

### ST6-2 — Call 1 mengeluarkan verdict (tanpa mengubah konsumen)
- **Files:** `src/v3/agent/prompt/phases/router-*.layer.ts`, `generation-stage.ts:routeTools`.
- **Steps:** tambah instrumen prompt agar Call 1 mengembalikan `commitment` + `referencedServiceIds` (via argumen tool atau field kontrak) **sambil tetap** memilih ≤1 tool. Shadow: **catat** verdict, belum mengubah perilaku cart.
- **Acceptance:** log `ROUTER_COMMITMENT_VERDICT` muncul; suite lama tetap hijau (verdict belum dipakai).
- **Risiko:** sedang (prompt). Rollback: matikan logging.

### ST6-3 — Konsumsi verdict di CartManager (shadow → enforce per tenant)
- **Files:** `cart-manager.ts`, `agent-runner.ts`.
- **Steps:** `syncCartItems` menerima `commitment`; tahap awal **shadow** (bandingkan keputusan lama vs baru, catat beda); lalu enforce via feature flag per tenant.
- **Acceptance:** test reproduksi (2 gagal → hijau); kasus komitmen sah tetap hijau; matrix 20/20.
- **Risiko:** sedang-tinggi. Rollback: flag off.

### ST6-4 — Selaraskan tool-masker dengan verdict
- **Files:** `tool-masker.ts`, `booking-commit-gate.ts`.
- **Steps:** prasyarat treatment/lokasi/tanggal tetap deterministik; "komitmen" dibaca dari verdict; `save_reservation` hanya terbuka bila `COMMITTED`.
- **Acceptance:** booking tetap tidak bisa premature; konsultasi tidak membuka booking.
- **Risiko:** sedang. Rollback: flag off.

### ST6-5 — Bersihkan heuristik yang kalah wewenang
- **Files:** `cart-manager.ts` (hapus `text.includes('?')` sebagai otoritas), `persona.ts` (turunkan peran intent komitmen).
- **Steps:** hanya setelah ST6-3/ST6-4 stabil; hapus jalur mati.
- **Acceptance:** tidak ada perhitungan tanya/beli berbasis string yang tersisa di jalur keputusan.
- **Risiko:** rendah (kode mati) bila shadow sudah terbukti.

---

## 6. Gerbang regresi tiap micro-task
- `npx tsc --noEmit` 0.
- Suite: `cart-*`, `booking-commit-*`, `tool-masking-*`, `v3-conversation-matrix`, `golden-corpus`.
- Test baru `cart-declarative-consultation.test.ts` hijau.
- Test keamanan (forc. lokasi/vaksin/jatuh, anti-cart-asisten) **tidak berubah**.
- `npm run build` 0.

---

## 7. Yang perlu keputusan/review sebelum eksekusi
1. Setujui bahwa **Call 1** menjadi otoritas verdict komitmen (bukan `extractFastIntents`/`syncCartItems`).
2. Setujui **definisi** `COMMITTED`: apakah "boleh bund" atas tawaran tunggal = COMMITTED (ya, sesuai contoh user)? Apakah "mau yang itu" (tanpa verba) = COMMITTED atau CONSIDERING?
3. Model LLM yang dipakai Call 1 saat ini (`deepseek-v4-1-flash`) — cukupkah untuk verdict ini, atau perlu model berbeda untuk task routing? (Ini keputusan kualitas vs biaya.)
4. Izin mengubah test lama yang mengunci string-matching (dengan justifikasi kontrak berubah, bukan pelonggaran).

---

## 8. Catatan mandat
- Tanpa dependency runtime baru.
- Tenant-aware (verdict per tenant; model config dari DB).
- Tidak menyentuh guardrail keamanan klinis (vaksin/jatuh/medis).
- Perubahan perilaku user-visible → dicatat di `CHANGELOG.md`; limitasi → `docs/KNOWN_ISSUES.md`.
