# Fixing Plan — AI Scope Gate: Mid-Flow Exception Terkontaminasi Pesan Bot (Opsi A)

- **Tanggal:** 2026-10-05
- **Status:** EXECUTED (2026-10-05) — Opsi A diterapkan; lihat CHANGELOG & KNOWN_ISSUES #229.
- **Kasus pemicu:** 6285109356888 (Bunda Rina)
- **Prinsip:** solusi fondasional (gerbang kode deterministik berbasis state), tanpa tambalan prompt, tanpa regex, tanpa hafalan kalimat, tanpa dependency/migrasi baru.

---

## 1. Gejala (terbukti dari data + log live, 2026-10-05 WIB)

Kronologi percakapan:

| Waktu | Arah | Isi ringkas |
|---|---|---|
| 2026-09-29 | — | Kunjungan/treatment terakhir tercatat (reservasi `confirmed`). |
| 2026-10-05 12:38 | OUT (BOT) | Follow-up `NEXT_TREATMENT` terkirim: "Halo Bunda Rina! ..." |
| 2026-10-05 14:27 | IN | Customer: "massage terakhir 5 hr yg lalu tgl 30 Sept" |
| 2026-10-05 14:28 | OUT (BOT) | Bot **membalas** ("dek Jasmine usianya berapa ya?") |
| 2026-10-05 14:29 | OUT (BOT) | Pesan bot lain **ditarik** |
| 2026-10-05 14:55 | OUT (ADMIN) | CS ambil alih via WhatsApp HP → `human_handling` aktif |
| 2026-10-05 15:05 | IN | Customer balas — **bot diam** (benar) |

Yang salah: bot menjawab pukul 14:28, padahal customer adalah **pasien repeat yang seharusnya langsung ke CS manusia**, bukan dijawab AI.

---

## 2. Akar masalah (multi-layer, terbukti dari kode)

Gerbang pintu masuk `enforceAiScopeGate` sudah **mendeteksi** status pasien repeat dengan benar (log server 14:27):

```
[AI SCOPE] Customer 628***ab43b283 (EXISTING_PATIENT_MANUAL) masih mid-flow
(RESERVATION_SENT). Menunda silence sampai reset berikutnya.
```

Namun eskalasi ke CS **dibatalkan oleh pengecualian mid-flow**:

1. `src/services/ai-scope-gate.service.ts:116-122` — bila percakapan dianggap "masih mid-flow", pembisuan ditunda (`return { action: 'pass' }`) sehingga bot tetap menjawab.
2. `src/services/ai-scope-gate.service.ts:41-52` (`isAtResetBoundary`) — batas "reset/idle" diukur memakai `conversation.last_message_at`, yaitu **aktivitas terakhir apa pun, termasuk pesan keluar bot sendiri**.
3. Pesan follow-up bot pukul 12:38 (OUT) **menyegarkan** `last_message_at`. Percakapan yang sebenarnya sudah tidur 6 hari (sejak 29 Sep) terbaca "aktif 1,6 jam" → dianggap mid-flow → bot menjawab.

Kesimpulan: **bot tersandung oleh jejak pesannya sendiri.** Ini keluarga isu "two clocks" (KNOWN_ISSUES #67): jam acuan untuk kebijakan bot terkontaminasi pesan outbound. Kolom yang benar (`Conversation.last_customer_message_at`, hanya chat masuk customer) sudah ada dan diupdate untuk jalur WAHA (`src/routes/webhook.route.ts:1115`).

### Mengapa bukan salah deteksi
Config server: `REPEAT_PATIENT_BYPASS_BOT` tidak diset → default aktif (benar). Tenant `NEW_ONLY`, cutoff 2026-09-30; Rina (created 2026-08-26) juga legacy — **dua alasan independen** sepakat dia bukan jatah bot. Yang bocor hanya pengecualian mid-flow.

---

## 3. Solusi terpilih — Opsi A

**Mengukur jeda idle dari `last_customer_message_at` (chat masuk customer), dengan fallback ke `last_message_at` bila kolom belum terisi.**

Rasional: yang rusak adalah "jam pengukurnya" (tercemar pesan bot), bukan aturannya. Aturan "pasien lama → CS" tetap; hanya cara menghitung "aktif" yang dibetulkan. Blast radius paling kecil.

Opsi yang tidak dipilih (dicatat untuk kelengkapan):
- **B** — alasan `EXISTING_PATIENT`/`ACTIVE_APPOINTMENT` menang mutlak atas mid-flow: risiko membebani CS untuk pasien lama yang hanya tanya sepele.
- **C** — pesan follow-up keluar tidak menyentuh penanda idle/state: efek menyerupai A tapi menyentuh lebih banyak modul.

---

## 4. Rencana bertahap (staged phases, micro-tasks + acceptance criteria)

### Fase 0 — Kunci base (read-only, tanpa ubah kode)
- **0.1** `git status --short -- src/services/ai-scope-gate.service.ts src/routes/waba-webhook.route.ts tests/unit/ai-scope-gate.test.ts` → harus bersih (tanpa pekerjaan tim yang belum di-commit di 3 file ini).
- **0.2** Catat base rev: `git rev-parse --short HEAD`.
- **Acceptance:** base tercatat; 3 file bersih.

### Fase 1 — Test merah dulu (TDD, `tests/unit/ai-scope-gate.test.ts`)
Tiru pola test mid-flow `:105-117`. Pakai customer legacy (alasan ineligible sama; tak perlu mock patient-lifecycle).
- **T-A (replay Rina, wajib MERAH):** state `RESERVATION_SENT` + `last_message_at: 5 menit lalu` (simulasi follow-up bot) + `last_customer_message_at: 6 hari lalu` → expect `silence` + `escalateSpy` dipanggil 1x.
- **T-B (mid-flow asli dipertahankan):** sama, tapi `last_customer_message_at: 5 menit lalu` → expect `pass`, escalate 0x.
- **T-C (fallback migrasi):** `last_customer_message_at: null` + `last_message_at` segar → `pass`; `last_message_at` 48 jam → `silence` (perilaku lama utuh).
- **Perintah:** `npx vitest run tests/unit/ai-scope-gate.test.ts` → T-A merah, sisanya hijau.
- **Acceptance:** persis itu. Semua hijau = test salah tulis.

### Fase 2 — Implementasi (2 sentuhan, deterministik)
- **2.1** `src/services/ai-scope-gate.service.ts:47` — ganti acuan jeda:
  ```ts
  // Jam acuan = chat MASUK terakhir customer (bukan aktivitas apa pun): pesan keluar
  // bot (mis. follow-up) tidak boleh "menghidupkan" percakapan tidur. Fallback ke
  // last_message_at bila kolom belum terisi (WABA lama / data lawas) = perilaku lama.
  const lastCustomer = (conversation as any).last_customer_message_at ?? conversation.last_message_at;
  const last = lastCustomer ? new Date(lastCustomer).getTime() : 0;
  ```
  + sesuaikan komentar header fungsi (Indonesia, 1–2 baris).
- **2.2** `src/routes/waba-webhook.route.ts:334` — paritas WAHA (`webhook.route.ts:1115`): setelah `getOrCreateConversation`, tambah:
  ```ts
  conversationService.updateLastCustomerMessageAt(conversation.id, tenantId).catch(() => {});
  ```
  Tanpa ini, kolom selalu null di jalur WABA → fallback terus → bug setara di WABA tak sembuh.
- **Cek mental Rina:** 07:27 → `last_customer_message_at` = 29 Sep (objek in-memory dibaca SEBELUM update chat ini) → idle 6 hari → boundary → `silence`. Chat cepat 5-menitan (T-B) tetap `pass`.
- **Acceptance:** `npx vitest run tests/unit/ai-scope-gate.test.ts` hijau; `npm run build` (tsc) bersih.

### Fase 3 — Regression gate
- **3.1** Target: `ai-scope-gate`, `ai-eligibility`, `command-service`, webhook route tests → hijau.
- **3.2** Penuh: `npm test` + `npm run build`. Pembeda: `tests/unit/live-chat-enroute-status.test.ts` SUDAH merah sebelum perubahan (fixture `2026-10-03` lapuk / time-rot) — bukan regresi; selain itu nol merah baru.
- **Acceptance:** nol test lama merah (di luar file lapuk yang tercatat).

### Fase 4 — Dokumentasi (Indonesia)
- **4.1** `docs/KNOWN_ISSUES.md` — entri baru: gejala Rina + bukti log + akar (jam terkontaminasi) + fix Opsi A.
- **4.2** `CHANGELOG.md` — entri Indonesia (perilaku yang berubah: percakapan tidur-di-mata-customer tak lagi dibalas bot meski ada follow-up outbound baru).

---

## 5. Batasan, blast radius & rollback

- **Blast radius:** `isAtResetBoundary` hanya dipakai oleh gerbang ini. Perilaku yang berubah HANYA percakapan "dorman di mata customer tapi aktif di mata bot" — tepat kelas bugnya.
- **Tanpa:** dependency baru, migrasi schema, ubahan prompt/teks, perubahan siapa yang berhak ke CS.
- **Rollback:** `git revert` satu commit (perubahan aditif & terlokalisasi).
- **Verifikasi ulang produksi:** setelah deploy, cek log `[AI SCOPE]` bahwa customer repeat dengan chat tertunda > IDLE_TIMEOUT di-silence (bukan "menunda silence").

---

## 6. Di luar cakupan (dicatat)

- Sisa observasi KNOWN_ISSUES #128 (baris Rina terjadwal non-baku; `REMINDER_H1`/`REVIEW_H1_BABY` batal tanpa `cancel_reason`).
- Isu "two clocks" umum (#67) untuk cooldown follow-up — plan ini hanya menyentuh gerbang AI-scope, bukan worker follow-up.
