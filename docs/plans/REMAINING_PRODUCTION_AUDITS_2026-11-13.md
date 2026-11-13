# Sisa Audit Produksi — C-002 & C-006 (Runbook)

> **Tanggal:** 2026-11-13
> **Konteks:** Register remediasi F0–F6 sudah **261 FIXED / 0 OPEN / 0 UNVERIFIED / 2 KNOWN**. Dua item KNOWN tersisa **bukan pekerjaan kode** — keduanya butuh artefak dari lingkungan Anda (dump korpus & log RAG produksi). Dokumen ini adalah perintah siap-jalan agar keduanya bisa ditutup dalam satu sesi.

---

## 1. Status

| Item | Butuh apa | Alat yang sudah disiapkan | Penutupan |
|---|---|---|---|
| `C-002` | Dump/akses `knowledge_chunks` produksi | `scripts/audit/knowledge-corpus-audit.sql` (read-only) | Kirim keluaran SQL + keputusan dedup → register `FIXED` |
| `C-006` | Log eksekusi LLM (`logs/llm-*.jsonl`) produksi/staging | `scripts/audit/rag-license-report.mjs` (read-only) | Kirim `rag-report.json` + keputusan lisensi → register `FIXED` |

Tidak ada skrip yang menulis ke DB. Keduanya hanya `SELECT` / membaca berkas.

---

## 2. C-002 — Kualitas korpus knowledge

**Acceptance asli:** ekspor `KnowledgeChunk`, jalankan dedup + buang cuplikan chat, lalu bandingkan jumlah artikel dengan metadata.

### Langkah

1. Di server (atau dari salinan dump produksi):

   ```bash
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
     -f scripts/audit/knowledge-corpus-audit.sql > corpus-audit.txt
   ```

   Alternatif bila Anda hanya punya dump: restore dump ke DB sementara, lalu jalankan perintah yang sama terhadap DB sementara itu.

2. Periksa 6 bagian keluaran:

   | Bagian | Yang dicari | Tindakan |
   |---|---|---|
   | 1 Ringkasan | jumlah chunk/dokumen per tenant | patokan jumlah artikel |
   | 2 Duplikat | `salinan > 1` | hapus salinan (simpan 1) |
   | 3 Cuplikan chat | `terindikasi > 0` | tinjau manual, buang yang bukan artikel/SOP |
   | 4 Jenis sumber | distribusi `FAQ`/`SOP`/lain | pastikan tidak ada sumber asing |
   | 5 Kualitas minimal | `kosong`, `sangat_pendek`, `tanpa_keywords` | lengkapi/beri keyword |
   | 6 Per dokumen | jumlah chunk per `document_name` | bandingkan dengan metadata artikel |

3. **Baseline lokal (BUKAN produksi, hanya indikasi awal):** DB dev `wa_clinic_db` per 2026-11-13 berisi 33 chunk, seluruhnya `FAQ`, **0 duplikat**, **0 indikasi cuplikan chat**, 0 kosong/pendek, 0 tanpa keyword. Angka ini tidak menggantikan bukti produksi.

4. Kirim `corpus-audit.txt` (dan daftar chunk yang Anda putuskan dibuang). Setelah itu `C-002` dapat dipindahkan ke `FIXED` di register + manifest bukti.

---

## 3. C-006 — Lisensi jawaban umum saat RAG-miss

**Acceptance asli:** buktikan dengan log RAG runtime: bandingkan `retrievedChunks` vs jawaban; bila lisensi masih terbuka, cabut lisensi umum untuk pertanyaan klinis.

### Langkah

1. Salin log dari server (contoh Docker):

   ```bash
   docker cp <container-app>:/app/logs ./logs-prod
   ```

   atau ambil dari volume/host tempat `logs/llm-*.jsonl` ditulis.

2. Jalankan analisis (tanpa dependency baru):

   ```bash
   node scripts/audit/rag-license-report.mjs \
     --dir ./logs-prod --since 2026-11-01 --json rag-report.json
   ```

   Keluaran: total record, `GROUNDED` / `TOOL_GROUNDED` / `UNGROUNDED`, rasio, rincian per `flowType` & tenant, dan sampel `UNGROUNDED`.

3. Review sampel `UNGROUNDED`:

   | Isi jawaban | Keputusan |
   |---|---|
   | Basa-basi, empati, arah administratif | boleh tetap (lisensi umum wajar) |
   | Klaim klinis (gejala, dosis, kontraindikasi, jaminan hasil) | **cabut lisensi umum untuk pertanyaan klinis** → perubahan kode + test terpisah |
   | Harga/durasi/jadwal tanpa grounding | **wajib** dijawab dari katalog/FAQ (tool), bukan pengetahuan umum |

4. Kirim `rag-report.json` + daftar keputusan per sampel. Bila tidak ada klaim klinis tanpa grounding, `C-006` dapat ditutup `FIXED` dengan bukti log; bila ada, terbitkan plan perbaikan (bukan tambal prompt).

---

## 4. Deploy (setelah dua audit di atas atau paralel)

Urutan wajib: **migrasi dulu, kode kemudian**. Paket 4 migrasi + rollback + bukti verifikasi ephemeral ada di:

- `docs/plans/MIGRATION_PLAN_AR004_2026-11-12.md` (§5 urutan, §8 paket penuh & rollback)
- `docs/audit/2026-11-13/MIGRATION_VERIFY_W18.md` (hasil `migrate deploy` + drift *empty*)

Ringkas:

```bash
pg_dump "$DATABASE_URL" > backup_pre_ar004.sql
npx prisma migrate deploy
npx prisma migrate diff --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma --script   # harus: -- This is an empty migration.
# baru deploy kode
```

---

## 5. Confirmation Gate

AI Agent tidak mengeksekusi migrasi/audit di lingkungan Anda tanpa perintah tertulis. Untuk menutup sisa pekerjaan, cukup kirim salah satu:

- **"Setuju eksekusi audit C-002 & C-006 di staging"** (lalu lampirkan `corpus-audit.txt` + `rag-report.json`), atau
- **"Setuju eksekusi migrasi + deploy staging"** untuk paket 4 migrasi.

Tanpa itu, status tetap: **261 FIXED / 2 KNOWN**, produksi diblokir sampai validasi staging.
