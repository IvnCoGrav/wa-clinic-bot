# Click Catcher Microservice

**Click Catcher** adalah layanan mikro (microservice) super ringan dan cepat yang berfungsi sebagai halaman perantara untuk menangkap parameter atribusi iklan Meta (`fbclid`, UTM parameters) dan browser cookies (`_fbp`, `_fbc`), mengirimkannya ke core service `wa-clinic-bot` untuk dicatat, dan mengarahkan (redirect) customer ke WhatsApp dengan kode promo/tracking yang sudah digenerate.

> **Catatan Monorepo**: Microservice ini adalah bagian dari monorepo `wa-clinic-bot`. Kode sumbernya berada di `packages/click-catcher/` dan dijalankan bersama service utama via `docker-compose.yml` di root monorepo.

## 🛡️ Prinsip Desain: Fail-Open & Kecepatan Tinggi

1. **Fail-Open (Conversion First)**: Prioritas utama adalah kenyamanan customer dan tingkat konversi (ATC). Jika API `wa-clinic-bot` mati, mengalami DNS timeout, atau request berlangsung melebihi batas waktu **maksimal 2 detik**, script secara otomatis akan mengalihkan customer langsung ke WhatsApp (tanpa kode atribusi). Calon pembeli tidak akan pernah stuck di halaman loading.
2. **Tanpa Database / State**: Halaman ini murni stateless dan tidak menggunakan database atau Prisma. Semua data klik diteruskan langsung ke endpoint `/api/tracking/click` di `wa-clinic-bot`.
3. **No-JS Fallback**: Jika customer menggunakan browser lawas, mematikan JavaScript, atau diblokir oleh ad-blocker agresif, disediakan tombol **Hubungkan Manual** yang mengarah langsung ke WhatsApp tujuan.
4. **Kecepatan di bawah 1 detik**: Halaman UI dirancang minimalis dengan CSS murni agar memuat instan di perangkat mobile dengan koneksi lambat sekalipun.

---

## 🛠️ Environment Variables (.env)

Buat file `.env` berdasarkan contoh di `.env.example`:

```env
# URL base dari wa-clinic-bot
# - Di Docker Compose: http://app:3000  (nama service di docker-compose.yml)
# - Di lokal (development): http://localhost:3000
TRACKING_API_BASE_URL=http://localhost:3000

# API key pengaman tracking, HARUS SAMA dengan TRACKING_API_KEY di wa-clinic-bot (.env root)
TRACKING_API_KEY=my_secure_random_tracking_api_key

# ID Meta/Facebook Pixel Anda
FB_PIXEL_ID=your_fb_pixel_id

# Nomor WhatsApp tujuan default jika parameter phone kosong di query string
DEFAULT_WHATSAPP_PHONE=628123456789

# Port untuk Click Catcher
PORT=3002
```

---

## 🚀 Cara Menjalankan

### Via Docker Compose (Recommended — jalankan seluruh sistem)

Dari root monorepo (`wa-clinic-bot/`):
```bash
docker-compose up
```
Ini akan menjalankan `wa-clinic-bot` (port 3000), `click-catcher` (port 3002), PostgreSQL, dan WAHA sekaligus.

### Standalone (Development Lokal)

```bash
cd packages/click-catcher
npm install
npm run dev
```

Akses halaman redirect melalui browser:
```
http://localhost:3002/go?fbclid=fb_123&utm_source=meta&utm_campaign=winter_promo&phone=628123456789
```

---

## 🔗 Integrasi dengan Checkout Page (Scalev, Dll)

### Skenario 1: Custom Link/Redirect di Tombol Checkout/ATC
Jika platform checkout seperti **Scalev** mendukung custom link redirect untuk tombol WhatsApp:
1. Ganti link WhatsApp langsung (`https://wa.me/628123...`) pada pengaturan tombol checkout Anda dengan link menuju Click Catcher:
   ```
   https://track.domainanda.com/go?phone=628123456789&fbclid={{fbclid}}&utm_source=meta&utm_medium=cpc&utm_campaign={{campaign_name}}
   ```
2. Pastikan variabel placeholder (seperti `{{fbclid}}` atau `{{campaign_name}}`) disesuaikan dengan format tag dinamis yang didukung platform checkout Anda agar terisi secara otomatis saat tombol diklik.

### Skenario 2: Custom JavaScript Injection (Jika Tombol WhatsApp Tidak Bisa Diubah)
Jika tombol WhatsApp di checkout page tidak bisa diubah langsung, Anda bisa menyuntikkan (inject) script JavaScript minimal di halaman checkout Scalev untuk mengubah perilaku klik tombol WhatsApp:
```javascript
document.addEventListener('DOMContentLoaded', function() {
  // Cari semua element link yang mengarah ke wa.me
  const waLinks = document.querySelectorAll('a[href*="wa.me"]');
  
  waLinks.forEach(function(link) {
    const originalHref = link.href;
    const urlObj = new URL(originalHref);
    const phone = urlObj.pathname.replace('/', '') || '628123456789';
    
    // Ambil fbclid dari cookie atau URL saat ini
    const urlParams = new URLSearchParams(window.location.search);
    const fbclid = urlParams.get('fbclid') || '';
    
    // Ubah href mengarah ke Click Catcher
    link.href = `https://track.domainanda.com/go?phone=${phone}&fbclid=${fbclid}&utm_source=meta&utm_medium=checkout_page`;
  });
});
```

---

## 🔮 Catatan Pengembangan Masa Depan

Komponen **Click Catcher** dirancang agar dapat dipasang ulang (reusable) di depan landing page builder buatan sendiri maupun platform pihak ketiga lainnya.
Cukup arahkan tautan CTA ke subdomain redirection Anda (`track.domainanda.com/go?phone=xxx&...`) dari halaman kampanye mana pun untuk langsung melacak performa iklan digital Anda secara end-to-end tanpa kehilangan tracking piksel.
