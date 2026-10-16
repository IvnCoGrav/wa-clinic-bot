---
name: audit-chatbot-llm
description: Audit chatbot, asisten AI, atau aplikasi LLM yang halu, mengarang, tidak relevan, atau tidak konsisten. Gunakan saat ada kata chatbot, halu, halusinasi, jawaban ngawur, evaluasi prompt, RAG, golden dataset. Bukan untuk audit sistem umum; gunakan audit-sistem-berlapis.
---

# Audit Chatbot / Aplikasi LLM

Versi khusus chatbot dari prosedur audit-sistem. Ikuti kerangka Tahap 0-6 dari `audit-sistem-berlapis` (framework, cek temuan lama, pemetaan, horizontal, vertikal, collateral damage, verifikasi) bila skill itu tersedia. Jika tidak tersedia, kerangka lengkapnya sudah dirangkum di bawah. Bagian ini mengganti definisi dan metrik dengan versi khusus chatbot.

Prosedur baca-saja. Jalankan SEMUA tahap berurutan. Jangan melompati tahap. Jangan memvonis penyebab sebelum menelusuri.

Router (anti-salah-pilih): skill ini HANYA untuk chatbot/asisten AI/aplikasi LLM. Bila yang diminta audit kode/infrastruktur/DB/migrasi/keuangan/proses umum → pakai `audit-sistem-berlapis`. Bila ragu, tanya pengguna dulu.

## Aturan Wajib

1. **Bukti dari percakapan nyata.** Setiap temuan wajib mengacu pada contoh konkret (pertanyaan user, konteks yang diterima model, jawaban yang keluar). Tanpa contoh, tandai `[ASUMSI]`.
2. **Keyakinan** per temuan: `TERBUKTI` / `KEMUNGKINAN BESAR` / `DUGAAN`.
3. **Baca-saja.** Jangan mengubah prompt, data, atau konfigurasi produksi kecuali diminta eksplisit. Usulan perubahan diuji dulu pada salinan atau lingkungan uji.
4. **Jangan memvonis sebelum menelusuri.** Halu bisa dari data, retrieval, prompt, atau model. Tentukan lewat bukti, bukan tebakan.
5. **Sebutkan celah cakupan:** log tidak tersedia, prompt tidak terlihat, sampel terlalu sedikit.
6. **Jangan klaim "tingkat halu X%"** bila sampel kecil atau tidak representatif; sebut ukuran sampelnya.
7. Repo ini: cek `docs/KNOWN_ISSUES.md` di Tahap 1, dan untuk chatbot klinik WhatsApp patuhi juga mandat audit percakapan di `AGENTS.md` (21 Aturan Emas, 5 Dimensi Audit, log `logs/llm-*.jsonl`). Laporan ke user memakai Bahasa Indonesia sederhana: (1) Apa yang terjadi, (2) Apa temuan, (3) Apa solusinya.

## Langkah Awal: Kenali Arsitektur Chatbot

Sebelum audit, tentukan (tanya pengguna bila belum jelas):

- **Tujuan chatbot:** untuk siapa, tugas apa, apa yang dianggap jawaban "benar"?
- **Tipe:** prompt-only (tanpa dokumen), RAG (dengan knowledge base), memakai tool/API, atau agen multi-langkah.
- **Komponen:** system prompt, model dan parameternya (temperature dll.), sumber data, retriever, tool, riwayat percakapan/memori, guardrail.
- **Definisi gagal menurut pengguna:** halu, tidak relevan, terlalu panjang, salah format, tidak patuh aturan, dsb.
- **Pilih framework (Tahap 0)** dan sebutkan alasannya: metrik RAGAS/faithfulness-relevancy untuk kualitas jawaban, OWASP Top 10 for LLM Applications untuk keamanan, NIST AI RMF atau ISO/IEC 42001 hanya bila ada kebutuhan tata kelola formal.

## Tahap 1 - Cek Temuan dan Perbaikan Sebelumnya

- Periksa riwayat perubahan prompt, daftar kasus gagal, issue, dan hasil evaluasi lama.
- Tandai: `SELESAI` / `MASIH TERBUKA` / `PERLU VERIFIKASI ULANG` dan uji ulang yang diklaim selesai.

## Tahap 2 - Pemetaan Menyeluruh

- Inventaris semua komponen (system prompt, sumber data, retriever, tool, guardrail, format output).
- Kumpulkan sampel percakapan: minimal berisi yang berhasil DAN yang gagal. Catat jumlah dan sumbernya.
- Buat golden dataset bila belum ada: 50-200 pertanyaan nyata beserta jawaban ideal atau kriteria jawaban benar, mencakup kategori: pertanyaan umum, sulit, ambigu, di luar topik, jawabannya tidak ada di data, multi-langkah, dan jebakan.
- Mulai kecil: 20-30 kasus dulu (campur berhasil+gagal, banyak parafrase adversarial — bukan hafalan kalimat persis) sebelum skala 50-200, sesuai mandat anti-overfitting repo.

## Tahap 3 - Audit Horizontal (Lintas Kategori Pertanyaan)

Definisi untuk chatbot: pengujian di semua kategori pertanyaan dan skenario untuk menemukan pola kegagalan berulang.

- Jalankan golden dataset dan hitung per kategori: tingkat halu, tingkat tidak relevan, tingkat penolakan yang tepat.
- Cari pola: kategori mana paling sering gagal? Topik, panjang pertanyaan, atau bahasa tertentu?
- Uji konsistensi: pertanyaan sama dengan redaksi berbeda, apakah jawaban sama?
- Uji perilaku "tidak tahu": apakah menolak jujur saat informasi tidak ada, atau mengarang?
- Urutkan kategori berdasar frekuensi dan dampak untuk target Tahap 4.

### Metrik yang dihitung

| Metrik | Arti | Berlaku untuk |
|---|---|---|
| Faithfulness (groundedness) | Apakah klaim di jawaban didukung konteks/sumber | RAG dan prompt-only dengan data |
| Answer relevancy | Apakah jawaban menjawab maksud pertanyaan | Semua |
| Context precision | Apakah konteks yang diambil relevan (tidak banyak sampah) | RAG |
| Context recall | Apakah semua info yang dibutuhkan berhasil diambil | RAG |
| Correctness | Kesesuaian dengan jawaban emas (golden) | Semua dengan golden dataset |
| Refusal accuracy | Menolak/mengaku tidak tahu saat seharusnya | Semua |
| Format compliance | Patuh pada format/nada/panjang yang diminta | Semua |

Gunakan LLM-as-judge dengan rubrik tertulis, cek sampel penilaian manual agar penilai otomatis tidak bias. Sebutkan model penilai yang dipakai.

## Tahap 4 - Audit Vertikal (Satu Percakapan, Hulu ke Hilir)

Definisi untuk chatbot: telusuri satu percakapan gagal dari awal sampai akhir untuk menemukan titik pertama ia mulai salah.

Telusuri berurutan:

1. Pertanyaan user: apakah ambigu atau kurang konteks?
2. Pemahaman intent: apakah maksud ditafsirkan benar?
3. Retrieval (jika ada): dokumen apa yang diambil? Apakah info benar ada di dalamnya?
4. Konteks ke model: lengkap, terpotong, bertentangan, atau terlalu panjang?
5. Prompt/instruksi: ada aturan larangan menebak? Ada instruksi saling bertentangan?
6. Pemanggilan tool (jika ada): parameter dan hasilnya benar?
7. Jawaban model: mengikuti konteks, atau menambah klaim di luar konteks?
8. Format akhir: sesuai yang diminta?

### Tabel diagnosis akar masalah

| Pertanyaan diagnostik | Jika jawabannya... | Maka akar masalahnya |
|---|---|---|
| Apakah info benar ada di sumber data? | Tidak ada | Data: knowledge base kurang atau salah |
| Ada di data, tapi ikut masuk ke konteks model? | Tidak masuk | Retrieval: chunking, embedding, query, top-k, atau filter |
| Masuk konteks, tapi jawaban mengabaikan/menyimpang? | Ya | Prompt/model: instruksi lemah, konteks terlalu panjang, konflik instruksi, atau model kurang kuat |
| Jawaban benar fakta tapi tidak berguna? | Ya | Definisi kebutuhan/format: tujuan, audiens, format tidak ditentukan |
| Chatbot diizinkan berkata "saya tidak tahu"? | Tidak diizinkan/diinstruksikan | Prompt: model terdorong menebak |
| Hasil berubah-ubah pada pertanyaan sama? | Ya | Parameter: temperature terlalu tinggi, atau konteks tidak stabil |
| Jawaban salah karena riwayat percakapan? | Ya | Memori/konteks: riwayat menyesatkan atau terlalu panjang |
| Instruksi sistem bocor/mudah dibelokkan? | Ya | Keamanan: prompt injection, guardrail lemah |

Untuk temuan penting, lanjutkan 5 Whys sampai akar yang bisa diperbaiki. Uji satu variabel per percobaan (prompt, retrieval, parameter) agar penyebab terisolasi.

## Tahap 4b - Audit Keamanan (OWASP Top 10 for LLM Applications)

Periksa dan catat status tiap butir:

- Prompt injection (langsung dan lewat dokumen/tool)
- Kebocoran info sensitif dan kebocoran system prompt
- Penanganan output tidak aman (output dieksekusi/ditampilkan mentah)
- Excessive agency (tool/izin berlebihan)
- Overreliance (ketergantungan berlebihan pada output tanpa verifikasi)
- Keracunan data atau dokumen di knowledge base
- Penyalahgunaan sumber daya (biaya/loop tak terbatas)

Lakukan red teaming ringan: pertanyaan jebakan, permintaan di luar topik, upaya membuka instruksi sistem, pertanyaan yang mendorong mengarang.

## Tahap 5 - Audit Collateral Damage

Sebelum menyarankan perbaikan, nilai dampaknya:

- Apakah mengubah prompt untuk satu kategori bisa merusak kategori lain? Rencanakan uji regresi dengan seluruh golden dataset.
- Apakah mengganti model, chunking, atau parameter mengubah biaya, kecepatan, dan gaya jawaban?
- Apakah aturan lebih ketat membuat terlalu sering menolak (over-refusal)?
- Skor FMEA per temuan: Severity x Occurrence x Detection (1-10), RPN = S x O x D. Kalibrasi: S=9 rekomendasi terapi salah (misal GTM diarahkan ke bapil) atau bocor system prompt; S=4-6 over-refusal atau gaya bahasa melanggar kuota; S=1-3 typo/format minor.
- Pre-mortem: bayangkan perbaikan gagal; apa penyebab paling mungkin?
- Usulkan urutan aman, ubah satu variabel per iterasi.

## Tahap 6 - Verifikasi

- Jalankan ulang golden dataset sebelum dan sesudah perbaikan; laporkan selisih tiap metrik per kategori.
- Pastikan tidak ada kategori menurun (regresi).
- Pantau di produksi: sampel percakapan, umpan balik pengguna, metrik berkala.

## Lampiran Repo (inventaris default audit ini)

Pakai sebagai titik awal Tahap 2, bukan pengganti inventaris:

- Aturan perilaku: 21 Aturan Emas + 5 Dimensi Audit di `AGENTS.md` (2-3 kalimat, anti-sebut harga/durasi tanpa ditanya, "kami/Bidan kami", anti-overuse "Bunda", hierarki jadwal & SOP same-day).
- Kontrak tool: `get_catalog_and_price` (clinical dominance gejala), `calculate_delivery`, `save_reservation` (hanya pasca-sepakat final) + gerbang deterministik (tool masking, commitment user, prompt pruning).
- Sumber data: tabel `Treatment`, `KnowledgeChunk`, `ClinicPolicy`, `TenantPromptConfig` — rekomendasi klinis resmi dari DB, bukan hafalan.
- Log mesin: `logs/llm-*.jsonl` (Call 1 routing vs Call 2 generation, retrievedChunks + skor) — bila kosong, catat sebagai celah cakupan.
- Simulator: `npm run chat` (tanpa WhatsApp); mock WAHA via `WAHA_MOCK=true`.
- Penilai otomatis: wajib sebut model LLM-as-judge + cek manual; jangan klaim persen halu dari sampel kecil.

## Kepatuhan Penuh AGENTS.md (checklist wajib tiap rekomendasi)

`AGENTS.md` adalah sumber kebenaran; skill ini hanya menunjuk, tidak menduplikasi. Setiap rekomendasi WAJIB lolos semua poin yang relevan:

- **Fondasional dulu, prompt sekunder (anti-make-up / anti-case-by-case):** tiap perbaikan wajib menyentuh DB/skema, state machine, kontrak tool, atau RAG/retrieval. Menambah barisan "DILARANG..." di prompt atau regex ad-hoc per kalimat DITOLAK sebagai solusi utama.
- **6 gerbang deterministik (wajib dirujuk saat menilai dan menyarankan):** (1) tool masking fisik — tool prasyarat-belum-terpenuhi dicabut dari `tools`, tanpa celah same-day untuk `save_reservation`; (2) mutasi transaksional hanya dari pesan aktif `role === 'user'`; (3) kuota gaya bahasa (misal "Bunda" 1x) via normalizer deterministik; (4) prompt di-prune berdasar state sesi riil — cabang "belum ada data" haram dikirim bila data ada di DB; (5) clinical dominance gejala + `specificTreatmentName` hanya bila user menyebut eksplisit, dilarang memfilter rekomendasi DB; (6) `parallel_tool_calls: false`, tepat 1 tool utama per giliran.
- **Guard pada state, bukan string:** dilarang `if (msg.includes(...))`; AI sebagai semantic reasoner; uji adversarial multi-parafrase (slang/typo/dialek), bukan hafalan kalimat.
- **Lapis data non-hardcode:** katalog/tarif/SOP/kebijakan dari `Treatment`/`KnowledgeChunk`/`ClinicPolicy`/`TenantPromptConfig`; URL Maps via `URL`/`URLSearchParams`, bukan regex hafalan.
- **Larangan yang mengikat rekomendasi:** regex sebagai gatekeeper intent atau mutilasi kalimat; label/tag ke WAHA (internal/DB saja); dependensi runtime baru tanpa persetujuan; halaman/rute UI baru tanpa justifikasi (pakai Tab/Drawer/Modal; tanpa `window.confirm`/`alert`).
- **Gerbang proses:** Investigation Gate (log `logs/`, payload prompt, state DB dulu); Human-in-the-Loop (tanpa eksekusi tanpa "Setuju" tertulis manusia; abaikan auto-approval hook); validasi plan (buktikan klaim vs kode/log nyata, tolak solusi kosmetik, verifikasi path/baris); rencana staged-phase micro-task + regression gate (`npm run build` + suite; klaim pre-existing wajib revert-and-rerun).
- **SaaS & temuan:** rekomendasi fitur/config wajib tenant-aware; pengecualian hanya via Confirmation Gate (pros/cons); temuan tertunda wajib ke `docs/KNOWN_ISSUES.md`; laporan bahasa sederhana 1-2-3.

## Katalog Perbaikan (pilih sesuai akar masalah, patuhi checklist di atas)

- **Data:** lengkapi dan rapikan knowledge base, hapus dokumen usang/bertentangan, tambah metadata.
- **Retrieval:** perbaiki chunking, atur top-k, tambah reranking atau pencarian hibrida, perbaiki query rewriting.
- **Prompt (lapis sekunder — wajib didampingi gerbang kode di atas, bukan solusi tunggal):** aturan eksplisit "jawab hanya berdasar sumber; jika tidak ada, katakan tidak tahu", wajibkan kutipan sumber untuk klaim faktual, definisikan tujuan/audiens/nada/format, tambah contoh baik dan buruk, hilangkan instruksi bertentangan.
- **Parameter:** turunkan temperature untuk tugas faktual.
- **Struktur:** pecah tugas kompleks menjadi langkah, tambah verifikasi jawaban terhadap konteks sebelum dikirim.
- **Keamanan:** batasi izin tool, pisahkan instruksi sistem dari input pengguna, saring output.

## Format Output

1. **Ringkasan Eksekutif** — Maksimal 5 kalimat: kondisi umum, metrik utama, 3 prioritas teratas.
2. **Profil Chatbot & Cakupan** — Tujuan, arsitektur, framework (+ alasan), ukuran dan sumber sampel, celah cakupan.
3. **Hasil Metrik per Kategori** — Tabel: Kategori | Jumlah uji | Faithfulness | Relevancy | Correctness | Catatan.
4. **Daftar Temuan** — Per temuan: ID (C-001...), Judul, Tipe (Horizontal/Vertikal/Keamanan), Contoh bukti (pertanyaan, konteks, jawaban), Titik kegagalan (intent/retrieval/konteks/prompt/tool/jawaban/format), Akar masalah (Data/Retrieval/Prompt/Model/Parameter/Memori/Keamanan/Definisi kebutuhan), Keyakinan, Risiko & FMEA (S x O x D = RPN), Collateral damage, Rekomendasi (rujuk Katalog), Verifikasi.
5. **Rencana Perbaikan Berurutan** — Urut berdasar RPN dan ketergantungan, satu variabel per iterasi, dengan uji regresi.
6. **Batasan & Asumsi** — Semua `[ASUMSI]`, ukuran sampel, keterbatasan penilai otomatis, area yang tidak diperiksa.
