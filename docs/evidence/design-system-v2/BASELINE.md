# Visual Baseline Rujukan — Design System v2

Dokumentasi rujukan 6 layar utama sebelum perombakan token (sebagai titik acuan komparasi visual):

| No | Layar / Rute | Elemen Kritis yang Diamati | Titik Verifikasi Bebas Regresi |
| :--- | :--- | :--- | :--- |
| 1 | **Overview** (`/admin/overview`) | Kartu KPI ringkasan, grafik tren mingguan, quick stats | Warna kartu tidak pudar, font angka tabular rapi sejajar |
| 2 | **LiveChat** (`/admin/live-chat`) | Daftar percakapan kiri, kanvas tengah, bubble masuk/keluar, panel info kanan | Kontras gelembung chat masuk (#202C33) vs keluar (#005C4B) presisi |
| 3 | **Reservations** (`/admin/reservations`) | View List/Hari/Minggu/Bulan, filter status, modal detail reservasi | Full-bleed kalender tetap utuh, badge status konsisten |
| 4 | **Customer Database** (`/admin/customers`) | Tabel data pelanggan, badge segmentasi, form pencarian | Kerapian baris tabel, kontras teks dan tag |
| 5 | **Financial Analytics** (`/admin/financial-analytics`) | Recharts line/bar chart, kartu pendapatan, tooltip | Tooltip Recharts tidak silau di mode gelap (bebas bug JourneyHistogram) |
| 6 | **Clinic Services** (`/admin/services`) | Daftar treatment, toggle aktif, badge kategori & durasi | Tombol toggle tidak rusak, modal edit layanan konsisten |

### Protokol Audit Visual & Non-Regresi:
- Setiap perubahan pada Fase 1 hingga Fase 5 wajib diverifikasi pada 6 layar di atas dalam dua mode (Light & Dark).
- Diuji pada breakpoint desktop (≥1024px) dan mobile (<768px).
- Tidak boleh ada perubahan layout yang mematahkan workflow operasional admin klinik.
