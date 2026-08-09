# Integrasi Landing Page Eksternal dengan wa-clinic-bot (Skema 2: URL Redirect)

Panduan ini menjelaskan cara memasang Landing Page Eksternal (WordPress, Elementor, HTML
polos, dll.) sehingga tetap terhubung penuh ke funnel tracking **wa-clinic-bot**:
`fbclid` & UTM dari iklan tersimpan sebagai `AdClick`, trackingCode ter-generate,
event Meta Pixel ter-fire saat redirect, dan pelanggan langsung masuk ke WhatsApp.

Tidak perlu microservice tambahan — cukup **satu link** dan **satu baris script**.

---

## 1. Gambaran Alur

```
Iklan Meta ──klik──> Landing Page Eksternal
                       │  address bar: ?fbclid=..&utm_source=..
                       ▼
          external-tracker.js (disajikan oleh bot, <script defer>)
                       │  membaca param atribusi di address bar
                       ▼
         Tombol CTA ──> https://bot-domain.com/cta?slug=SLUG_ANDA
                       │  param atribusi disisipkan otomatis ke link
                       ▼
            Endpoint /cta (bot)
                       ├─ generate trackingCode -> simpan AdClick (fbclid, UTM, UA, IP)
                       ├─ fire event Meta Pixel (Contact) sebelum redirect
                       └─ redirect -> https://wa.me/...?text=Promo[KODE]... -> WhatsApp (CAPI Event: Contact)
```

Karena `external-tracker.js` disajikan langsung oleh bot
(`GET /assets/external-tracker.js`), Anda **tidak perlu meng-upload** script ini
ke LP eksternal — cukup memanggilnya via `<script src="...">`.

---

## 2. Prasyarat

- wa-clinic-bot sudah berjalan di domain publik (contoh: `https://bot.example.com`).
- Sudah ada **landing aktif** dengan slug tertentu di Admin Dashboard
  (menu **Landing Page**). Slug inilah yang dipakai di link CTA.
- Nomor WhatsApp tujuan ditentukan oleh **pengaturan Tenant** (bukan dari URL) —
  single source of truth, mustahil disalahgunakan via link.

---

## 3. Instalasi via Admin Dashboard (Copy & Paste + Panduan)

Cara termudah — seluruh snippet siap salin sudah tersedia di **Dashboard →
menu Landing Page** (card **Integrasi Landing Page Eksternal**, tepat di bawah
header halaman).

**Card integrasi berisi:**

- **Input snippet siap salin** — satu baris embed:
  `<script src="https://<domain-bot>/assets/external-tracker.js" defer></script>`
  Domain diambil otomatis dari `window.location.origin`, jadi tidak perlu
  edit manual (aman bila domain berubah).
- **Tombol Salin Script** — menyalin snippet ke clipboard (`navigator.clipboard`
  + fallback `execCommand`) dengan notifikasi toast.
- **Tombol Lihat Panduan Integrasi** — membuka modal panduan lengkap
  (`ExternalIntegrationModal`).

### Isi modal panduan

1. **Alur 4 langkah** — link CTA → tanam script → atribusi iklan tertangkap →
   redirect WhatsApp + trackingCode tercatat.
2. **Script embed** (sama seperti di card) + tombol salin.
3. **Contoh link CTA** — `https://domain-bot/cta?slug=SLUG_ANDA`.
4. **Blok kode per platform** — HTML statis, Elementor/WordPress, WordPress
   `functions.php` — masing-masing dengan tombol **Salin** sendiri.
5. **Tabel whitelist param atribusi** (fbclid, gclid, utm_*, dll).
6. **Info keamanan** berbentuk kotak peringatan.

> Implementasi UI: `packages/admin-dashboard/src/components/modals/ExternalIntegrationModal.tsx`
> dirender dari `packages/admin-dashboard/src/pages/tenant/LandingPage.tsx`.
> Catatan dev: saat dashboard dikembangkan lewat Vite dev standalone,
> `window.location.origin` adalah port dev — uji snippet dengan domain produksi.

---

## 4. Quick Start (HTML polos)

```html
<!-- 1. Ganti tombol CTA menjadi link ke /cta bot -->
<a
  href="https://bot.example.com/cta?slug=promo-bunda-2026"
  class="btn-cta"
>Chat WhatsApp Sekarang</a>

<!-- 2. Tanam script jembatan (cukup satu baris) -->
<script
  src="https://bot.example.com/assets/external-tracker.js"
  defer
></script>
```

Selesai. Ketika pengunjung masuk lewat iklan dengan URL
`https://lp-anda.com/?fbclid=abc&utm_source=ads&utm_campaign=promo2026`,
sebelum tombol CTA diklik, `external-tracker.js` menyisipkan `fbclid`,
`utm_source`, `utm_campaign` (serta param atribusi lain yang ada) ke link `/cta`
secara otomatis.

---

## 5. Instalasi per Platform

### 4a. HTML / Landing Page statis

```html
<a class="btn-cta" href="https://bot.example.com/cta?slug=slug-anda">Chat Sekarang</a>

<script src="https://bot.example.com/assets/external-tracker.js" defer></script>
```

### 4b. Elementor / WordPress + Elementor Pro

1. Pada widget **Button** Elementor, isi **Link** dengan URL eksternal penuh:
   `https://bot.example.com/cta?slug=slug-anda` (jangan pakai link relatif).
2. Supaya script termuat di semua halaman: buka **Theme Builder → Theme Footer**,
   tambahkan widget **HTML**, lalu paste satu baris:
   `https://bot.example.com/assets/external-tracker.js` dalam atribut `src`
   dari tag `<script>`.
3. Alternatif tanpa widged HTML: gunakan plugin Code Snippets untuk menyuntikkan
   `<script src="..." defer></script>` ke `<head>`/`</body>`.

Skrip bekerja `defer` (jalan setelah DOM siap), jadi aman dipasang di header
maupun footer.

### 4c. WordPress (tema klasik / functions.php)

```php
function wa_clinic_landing_tracker() {
    echo '<script src="https://bot.example.com/assets/external-tracker.js" defer></script>';
}
add_action('wp_footer', 'wa_clinic_landing_tracker');
```

Atau cukup tempel baris `<script>` ke `footer.php` melalui
**Appearance → Theme File Editor**.

---

## 6. Parameter yang Disisipkan (Whitelist)

Script hanya membaca dan menyalin param atribusi berikut dari address bar:

| Kategori          | Param                                                          |
|-------------------|----------------------------------------------------------------|
| Meta / Facebook   | `fbclid`, `fbp`, `fbc`                                          |
| Google Ads        | `gclid`, `gclsrc`, `wbraid`, `gbraid`                           |
| Microsoft / Bing  | `msclkid`                                                       |
| TikTok            | `ttclid`                                                        |
| UTM standar       | `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `utm_id` |
| Instagram / lain  | `igshid`                                                        |

**Perilaku penting:**

- **Tidak menimpa** param yang sudah ada di link CTA — contoh `?slug=slug-anda`
  tetap utuh; bila link sudah berisi `utm_source=manual`, tidak diubah.
- **Tidak menyentuh** param sistem bot (`slug`, `p`, `phone`, `msg`,
  `greetings`). Nomor WhatsApp selalu diambil dari pengaturan Tenant, bukan URL
  (sudah di-ignore di endpoint `/cta` untuk cegah penyalahgunaan).
- **Idempoten**: aman dijalankan berulang kali; link yang sudah diproses
  ditandai `data-external-tracker-applied`.

> **Catatan `_fbp`/`_fbc` cookie**: atribusi *click dedup* Meta paling akurat bila
> `fbp`/`fbc` ikut terkirim ke `/cta`. Cookie bersifat per-domain dan bot TIDAK bisa
> membaca cookie LP eksternal (hanya `<script>` on-domain bisa). Jika LP Anda
> sudah punya `_fbp`/`_fbc` (mater meta pixel) dan ingin dedup penuh, lempar
> nilainya ke URL pengunjung (`?fbp=...&fbc=...`) — skirm juga akan meneruskan dua
> param ini.

---

## 7. Verifikasi & Tes

**Cek endpoint aset (pastikan tersaji):**

```
curl -i https://bot.example.com/assets/external-tracker.js
```

Harus: `HTTP/1.1 200`, `Content-Type: application/javascript`, body berisi banner
komentar `external-tracker.js`.

**Cek end-to-end di browser:**

1. Buka LP eksternal dengan URL tes, misal:
   `https://lp.example.com/?fbclid=TEST123&utm_source=meta&utm_campaign=winter2026`
2. Buka DevTools → inspect tombol CTA.
3. Saat tombol diklik, di panel **Network** lihat URL `/cta` — seharusnya sudah
   mengandung `fbclid=TEST123`, `utm_source=meta`, `utm_campaign=winter2026`
   (di samping `slug`).
4. Di **Admin Dashboard → AdClicks** (DB `ad_clicks`) pastikan muncul baris baru
   dengan `trackingCode`, `utmSource`, `utmCampaign`, `fbclid`, `ip`, `userAgent`.
5. WhatsApp menerima pesan `Promo[kode] ...` dari nomor yang benar.

**Cek LP tidak terganggu:** link lain di halaman Anda (menu, nav) yang tidak
berarah `/cta` **tidak ikut diubah** — skrip hanya mengubah link yang
path-nya persis `/cta`.

---

## 8. FAQ & Troubleshooting

- **Tombol CTA tidak pernah berubah link-nya.**
  Pastikan URL tombol benar dimulai dengan `https://bot.example.com/cta` ATAU
  `/cta` (path persis `/cta`). Skrip bergerak saat param atribusi ada di address bar.
- **Bawa CSP ketat di LP saya.**
  Script tanpa `eval`, tanpa `fetch`, tanpa akses cross-origin. Pastikan direktif
  `script-src` Anda mengizinkan domain bot (misal: `https://bot.example.com`).
- **LPnya SPA / render lambat (Elementor)?**
  Skrip mengamati DOM via `MutationObserver` dengan throttle, sehingga link CTA
  yang baru dirender tetap ikut diproses.
- **`fbclid` tidak muncul di `AdClick`?**
  Pastikan `fbclid` benar-benar ada di address bar. Meta kadang mengarahkan ke
  URL ber-fragment; skrip juga membaca bagian `?fbclid=...` di dalam hash.

---

## 9. Keamanan & Batasan

- Script **read-only & fail-open**: tidak memodifikasi DOM selain query string
  link `/cta`, tidak menambah/mengganti event handler, tidak melanggar
  aturan sandbox; error apa pun di-swallow.
- Seluruh logika atribusi & pixel tetap ditangani server-side oleh `/cta`
  (token/credential Meta tidak pernah terpapar).
- Link CTA dari LP jangan diberi `?phone=...` — endpoint `/cta` mengabaikannya
  untuk tujuan redirect dan selalu memakai nomor Tenant.

Referensi: `docs/META_FUNNEL.md`, `docs/SAAS_READINESS_AUDIT.md`.