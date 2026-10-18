# Matriks Triase Klinis & Protokol Keselamatan Layanan (Clinical Triage Matrix)

| Metadata | Nilai |
| :--- | :--- |
| **Versi Dokumen** | 1.0.0 (Track 2B) |
| **Peninjau Medis (reviewedBy)** | Bidan Yusi (Kala Baby Spa) & Clinical AI Team |
| **Tanggal Ditinjau (reviewedAt)** | 2026-10-18 |
| **Status Otorisasi** | APPROVED & UNBLOCKING FASE 4/5 |

---

## 1. Definisi Aksi Triase Klinis

1. **`ESCALATE` (Rujukan Medis Segera)**: Kondisi gawat darurat medis, trauma kepala/fisik, dugaan preeklampsia, atau kontraindikasi absolut. Bot wajib menolak pemesanan dan mengarahkan rujukan segera ke IGD / Faskes / Dokter Spesialis.
2. **`SCREEN` (Skrining Kondisi / Jeda Waktu)**: Memerlukan verifikasi kondisi medis khusus sebelum pemesanan disetujui (misal: verifikasi suhu/jeda 48 jam pasca imunisasi, usia gestasi kehamilan).
3. **`ASK_STAGE` (Klarifikasi Tahap Hidup & Subjek)**: Menanyakan apakah keluhan untuk Bunda atau si kecil, dan menanyakan tahap kehamilan/usia anak secara deterministik sebelum merekomendasikan katalog.
4. **`SAFE` (Aman / Penanganan Normal)**: Gejala aman ditangani dengan layanan homecare/klinik Kala Baby Spa sesuai SOP.

---

## 2. Tabel Matriks Triase Gejala & Layanan

| ID | Gejala / Kata Kunci Pengguna | Subjek Target | Tahap Hidup (MomStage / ChildAge) | Red Flag | Aksi Triase | Template Teks Resmi Bidan (Fallback / DB Seed) | Layanan Terkait / Tindakan |
| :--- | :--- | :--- | :--- | :---: | :---: | :--- | :--- |
| **TR-01** | Jatuh dari kasur / tempat tidur / stroller, kepala benjol, muntah, kejedot keras | Si Kecil | Bayi (0-12 bln) / Anak (1-5 thn) | **YA** (Trauma Kepala) | `ESCALATE` | "Aduh Bunda, mohon maaf sekali untuk kondisi si kecil yang baru saja terbentur/jatuh, Bidan kami belum menyarankan untuk dilakukan pemijatan ya Bun. 🙏 Sebaiknya si kecil segera diperiksakan ke Dokter Spesialis Anak atau faskes terdekat untuk memastikan kondisinya aman Bun." | Tidak boleh booking pijat; rujuk dokter |
| **TR-02** | Demam tinggi > 38.5°C, kejang, sesak napas, lemas tidak mau menyusu | Si Kecil | Bayi / Anak | **YA** (Kegawatdaruratan) | `ESCALATE` | "Mohon maaf Bunda, untuk si kecil dengan kondisi demam tinggi atau sesak napas belum diperbolehkan pemijatan ya Bun. 🙏 Kami sarankan Bunda segera membawa si kecil ke dokter atau IGD terdekat Bun." | Tolak booking; rujukan faskes |
| **TR-03** | Baru imunisasi / vaksin < 48 jam (DPT, Campak, BCG, Polio) | Si Kecil | Bayi / Anak | **POTENSIAL** | `SCREEN` | "Wah si kecil baru selesai imunisasi ya Bun. 👶 Untuk jadwal pemijatan, Bidan kami menyarankan diberikan jeda minimal 2x24 jam (2 hari) setelah imunisasi ya Bun, serta pastikan si kecil sudah tidak ada demam Bun." | Jadwalkan setelah jeda H+2 tanpa demam |
| **TR-04** | Batuk, pilek, hidung tersumbat, kembung (tanpa sesak napas) | Si Kecil | Bayi (0-12 bln) / Anak (1-5 thn) | **TIDAK** | `SAFE` | "Untuk membantu melegakan pernapasan dan meredakan kembung si kecil, kami memiliki layanan Pijat Pulih Ceria Bun. Terapi ini menggunakan minyak telon aromaterapi yang nyaman untuk menghangatkan tubuh si kecil." | Kala Baby / Kala Kids – Pijat Pulih Ceria |
| **TR-05** | GTM (Gerakan Tutup Mulut), susah makan, rewel saat makan | Si Kecil | Bayi (>6 bln) / Anak | **TIDAK** | `SAFE` | "Bila si kecil sedang fase GTM atau susah makan, Bidan kami sangat menyarankan layanan Pijat Lahap Bun. Terapi pijat ini berfokus pada titik stimulasi pencernaan untuk membantu meningkatkan nafsu makan si kecil Bun." | Kala Baby / Kala Kids – Pijat Lahap |
| **TR-06** | Hamil < 37 minggu (Preterm) minta pijat induksi | Bunda | PREGNANT (<37W) | **YA** (Risiko Prematur) | `ESCALATE` | "Mohon maaf sekali Bunda, untuk Pijat Induksi Alami hanya diperbolehkan bagi usia kehamilan yang sudah aterm (minimal genap 37 minggu) ya Bun. 🙏 Untuk usia kehamilan Bunda saat ini, kami lebih menyarankan Prenatal Gentle Massage untuk meredakan pegal secara aman Bun." | Blokir Induksi Massage; tawarkan Prenatal jika aman |
| **TR-07** | Hamil ≥ 37 minggu (Aterm) minta pijat induksi alami | Bunda | PREGNANT (≥37W) | **TIDAK** | `SAFE` | "Wah sudah memasuki usia siap bersalin ya Bun (aterm). Kami memiliki layanan Kala Mom Induksi Massage yang dikombinasikan dengan stimulasi acupressure titik laktasi & induksi alami untuk membantu mempersiapkan jalan lahir Bun." | Kala Mom – Induksi Massage |
| **TR-08** | Hamil Trimester 1 (< 12 minggu) minta pijat hamil | Bunda | PREGNANT (<12W) | **YA** (Risiko Trimester 1) | `SCREEN` | "Mohon maaf Bunda, untuk keselamatan janin, Bidan kami menyarankan pemijatan prenatal dilakukan saat usia kehamilan sudah memasuki trimester 2 (minimal 12 atau 16 minggu ke atas) ya Bun. 🙏" | Tunda booking hingga TM 2 |
| **TR-09** | Kaki bengkak hebat disertai pusing berputar / pandangan kabur / tensi tinggi | Bunda | PREGNANT | **YA** (Dugaan Preeklampsia) | `ESCALATE` | "Bunda, jika keluhan kaki bengkak disertai pusing hebat atau pandangan berkunang-kunang, mohon segera periksakan tensi dan kondisi ke Dokter Kandungan atau Bidan terdekat ya Bun. Demi keselamatan Bunda dan janin, kami belum berani memberikan terapi pijat Bun." | Tolak booking; wajib rujukan SpOG |
| **TR-10** | Kaki bengkak / pegal pinggang tapi subjek/tahap belum diketahui | Ambigu | UNKNOWN | **POTENSIAL** | `ASK_STAGE` | "Boleh tahu Bunda, untuk keluhannya saat ini Bunda sedang hamil (usia berapa minggu), pasca melahirkan, atau untuk relaksasi umum ya Bun? 😊" | Bypass rekomendasi katalog spesifik hingga stage jelas |
| **TR-11** | Pasca melahirkan / nifas / ASI seret / payudara bengkak | Bunda | POSTPARTUM | **TIDAK** | `SAFE` | "Selamat atas kelahiran buah hatinya ya Bun! 🥰 Untuk membantu memperlancar aliran ASI dan merilekskan otot payudara serta punggung, kami ada layanan Kala Mom Laktasi & Breast Care serta Pijat Oksitosin Bun." | Kala Mom – Laktasi & Breast Care / Pijat Oksitosin |
| **TR-12** | Payudara merah meradang, demam menggigil, keluar nanah / mastitis akut | Bunda | POSTPARTUM / LACTATING | **YA** (Mastitis Infeksius) | `ESCALATE` | "Aduh Bunda, jika area payudara memerah panas, sangat nyeri disertai demam tinggi atau menggigil, ada kemungkinan terjadi infeksi mastitis Bun. Mohon segera konsultasikan ke Dokter ya Bun sebelum dilakukan tindakan pemijatan Bun." | Rujuk Dokter; tunda pijat |
| **TR-13** | Pegal relaksasi umum (tidak hamil, anak > 2 tahun / wanita dewasa) | Bunda | GENERAL | **TIDAK** | `SAFE` | "Untuk memulihkan kesegaran tubuh Bunda yang lelah beraktivitas, kami menyediakan layanan Relaksasi Pijat Tradisional Tubuh Segar Bun." | Layanan Relaksasi Umum / Body Massage |

---

## 3. Aturan Integrasi Kode (Implementasi Teknis)

1. **State Integration**: Status triase dicatat di `CustomerGoalSession`:
   - `session.triageStatus`: `'SAFE' | 'SCREEN' | 'ASK_STAGE' | 'ESCALATE'`
   - `session.pendingScreeningAnswer?: boolean`
   - `session.pendingSubjectClarification?: boolean`
2. **Deterministic Bypass**:
   - Jika `triageStatus === 'ESCALATE'` atau `'ASK_STAGE'`, sistem bypass LLM Call 2 / rekomendasi treatment berisiko dan menyajikan respon aman langsung dari template DB `ClinicPolicy`.
3. **Katalog Filter Stage Guard**:
   - Di `treatmentCatalogService.recommendServiceBySymptoms`, jika `momStage === 'UNKNOWN'`, layanan yang membutuhkan tahap hidup spesifik (Induksi, Prenatal, Laktasi) otomatis di-masking/dikecualikan dari skor tertinggi.
