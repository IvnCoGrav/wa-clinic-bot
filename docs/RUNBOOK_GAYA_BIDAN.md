# Runbook Kurasi Gaya Bidan Yusi — PLAN 9 FASE 9.4

> Siklus mingguan yang dapat diulang admin untuk menaikkan kualitas gaya balasan bot.
> Bahasa: Indonesia (sesuai AGENTS.md).

## Prasyarat

- `ENABLE_SELF_LEARNING=true` di environment staging/produksi (default `false` — loop mati).
- `LLM_API_KEY` tersedia untuk harness kualitas (bukan bagian CI offline).
- Akses dashboard: **AI Bot Persona → tab Percakapan Ideal** dan **Knowledge Base → Staging**.

## Siklus (ulangi tiap minggu)

### 1. Ukur baseline minggu ini

```powershell
npx tsx scripts/audit-prompt-cost.ts --days=7
npx tsx tests/evals/persona-quality-harness.ts --limit=10
```

Catat: rata-rata skor persona + jumlah turn di bawah ambang.

### 2. Tinjau antrean usulan gaya

1. Buka **AI Bot Persona → Percakapan Ideal → filter "Perlu Review"**.
2. Setiap usulan (`tags: style-harvest, needs-review`, `is_active=false`):
   - Baca `customerMessage` + `idealResponse` (jawaban asli admin).
   - **Aktifkan** bila: hangat, natural, tanpa nominal harga, tanpa PII, tanpa `**`.
   - **Tolak** (hapus) bila: mengandung harga basi, data pribadi, atau gaya tidak sesuai.
   - **Edit** bila: isinya bagus tapi perlu poles minor → simpan, lalu aktifkan.
3. Aturan keras: **tidak ada aktivasi massal tanpa baca**. Satu exemplar buruk yang aktif akan ditiru bot di setiap turn relevan.

### 3. Validasi pasca-aktivasi

```powershell
npx tsx tests/evals/persona-quality-harness.ts --limit=10
npm run test:golden
```

Bandingkan delta skor vs langkah 1. Bila skor turun: nonaktifkan exemplar yang baru diaktifkan (satu per satu) sampai penyebab ketemu.

### 4. Catat

- Tambah entri CHANGELOG (format repo: akar masalah + file:line + hasil).
- Bila menemukan pola kegagalan berulang (mis. todong jam, halusinasi harga), catat ke `docs/KNOWN_ISSUES.md` — jangan tambal prompt diam-diam.

## Batas Aman

- Maksimal **5 aktivasi exemplar per minggu** (mencegah drift gaya mendadak).
- Exemplar harvest **tidak pernah** auto-aktif — selalu lewat review manusia.
- Harga/nominal dalam exemplar = ilustrasi pola (lihat disclaimer blok few-shot di `persona.ts`); harga resmi tetap dari tool `get_catalog_and_price` + validator numerik.
