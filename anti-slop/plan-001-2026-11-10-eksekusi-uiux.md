# Plan 001: Eksekusi Perbaikan UI/UX (41 Temuan, 11 Fase)

- **Tanggal:** 2026-11-10
- **Dasar:** `anti-slop/audit-001` (17), `audit-002` (12), `audit-003` (12), `audit-004` (konsolidasi + kolateral)
- **Status:** RENCANA. Belum ada satu pun tugas dijalankan. Eksekusi menunggu persetujuan tertulis manusia per fase.
- **Prinsip:** setiap fase punya prasyarat, tugas mikro prosedural, kriteria terima otomatis, gerbang regresi, dan rollback sendiri. Tidak ada fase yang boleh dimulai bila gerbang fase sebelumnya gagal.
- **Larangan yang dipatuhi:** tanpa dependency runtime baru, tanpa patch script yang menulis ulang CSS/sumber, tanpa `window.confirm/alert`, tanpa label WAHA, tanpa hardcode data bisnis baru.

---

## 0. Fakta Terverifikasi (dasar plan)

| Fakta | Angka | Bukti |
| :--- | :--- | :--- |
| Halaman dashboard | 30 file di `src/pages/**` | hitungan file |
| Komponen | 204 file `.tsx/.ts` | hitungan file |
| Test UI dashboard | **0 file, tanpa konfigurasi** | tidak ada `*.test.tsx`, `vitest.config`, `jest.config` |
| `text-white` di atas latar solid tanpa token | 110 situs di 42 file | `inventory.js` |
| Em dash di teks (non-komentar) | 140 baris di 53 file | `inventory.js` |
| Emoji di teks (non-komentar) | 423 baris di 51 file | `inventory.js` |
| `text-[9px]`/`[10px]` | 830 situs di 82 file | `inventory.js` |
| Overlay modal manual | 70 blok di 45 file | `inventory.js` |
| `toLocale*` tanpa `timeZone` | 54 situs di 23 file | `inventory.js` |
| Format uang lokal (fungsi berbeda) | 11 definisi | grep `formatRp|formatRupiah|fmtRp` |
| Animasi loop | 62 di 23 file | `inventory.js` |
| `backdrop-blur` | 84 di 47 file | `inventory.js` |
| `catch {}` / `.catch(()=>{})` | 99 di 12 file utama | `audit-003` |
| Dialog konfirmasi dengan penjelasan | 65 dari 66 | grep `confirm({` |
| Gerbang desain | `check:tokens` GAGAL, `check:dark-parity` GAGAL, tidak di CI | eksekusi langsung |
| Halaman publik | 3 file; `layanan.html` dan `pricelist.html` **dihasilkan skrip** | `build_landing.js`, `build_pricelist.js` |
| `layanan.html` dirutekan bot? | **tidak** (hanya `/go`, `/pricelist.html`, `/promo/:slug`, `/assets/:filename`) | `src/routes/landing.route.ts` |
| Katalog di `layanan.html` | 39 layanan + tier ongkir hardcoded, sumber `services_custom.json` (19 Okt 2026) | `build_landing.js:5`, `:861`, `:1268-1292` |

**Koreksi terhadap audit sebelumnya (wajib dibaca sebelum eksekusi):**
1. Perbaikan `layanan.html` **tidak boleh** dilakukan langsung di file itu. File tersebut hasil generate `scripts/build_landing.js` (baris 1383-1384). Setiap edit manual akan hilang saat generator dijalankan.
2. Logika tarif ongkir ada di `scripts/build_landing.js` baris **1268-1292**, bukan di `layanan.html`. Elemen tujuannya `id="ongkirFeeText"` (baris 409).
3. Sudah ada `src/utils/dateWib.ts` dengan 12 fungsi siap pakai (termasuk `formatWibDate`), dan `src/hooks/useFormDraft.ts` untuk draft form. Plan ini **memakai ulang** keduanya, tidak membuat baru.
4. Format uang sudah punya versi bersama di `src/utils/dashboard-metrics.ts:18` (`formatRupiah`), tetapi ada 10 salinan lokal lain.

---

## 1. Aturan Eksekusi (berlaku untuk semua fase)

1. **Satu fase = satu branch + satu PR.** Jangan gabungkan dua paket.
2. **Line number bisa bergeser.** Setiap tugas menyebut nomor baris per 2026-11-10 sebagai titik awal; cari ulang dengan string jangkar yang disertakan (`grep -n`) sebelum mengedit.
3. **Gerbang wajib per fase** (dijalankan dari `packages/admin-dashboard`):
   - `npm run build` (tsc + vite) keluar 0.
   - `npm run check:a11y`, `npm run check:contrast` keluar 0 (dibuat di Fase 0).
   - `npm run check:design` keluar 0 mulai Fase 9.
   - Dari root: `npm run typecheck` keluar 0 dan `npx vitest run tests/unit` tidak menambah kegagalan baru (bandingkan dengan baseline).
4. **Bukti klik-tembus** wajib dicatat per elemen bila fase menyentuh interaksi (modal, form, navigasi). Tanpa itu, fase belum selesai.
5. **Rollback** harus diuji: `git revert` commit fase bersih tanpa konflik.
6. **Larangan**: tidak memakai `|| true` pada langkah gerbang, tidak menambah dependency, tidak mengedit file hasil generate (kecuali lewat generator).

---

## FASE 0: Jaring Pengaman (prasyarat semua fase)

**Menutup:** tidak ada temuan langsung; menurunkan Detection untuk P1, P2, P3, P10.
**Prasyarat:** tidak ada.
**Risiko kolateral:** nol untuk runtime (skrip hanya dibaca, tidak dijalankan produksi).

### T-0.1 Buat `scripts/check-a11y-strings.mjs`

Lokasi: `packages/admin-dashboard/scripts/check-a11y-strings.mjs` (baru).

```js
#!/usr/bin/env node
/**
 * Gerbang string aksesibilitas (tanpa dependency).
 * Memeriksa: label tanpa htmlFor, tombol ikon tanpa nama, div onClick tanpa role,
 * outline-none tanpa pengganti fokus, nav aktif tanpa aria-current.
 * Ratchet: angka per file hanya boleh turun (pola sama dengan check-design-tokens.mjs).
 */
import { readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(PKG, 'src');
const BASELINE = join(PKG, 'scripts', 'a11y-baseline.json');
const UPDATE = process.argv.includes('--update');

function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (p.endsWith('.tsx')) acc.push(p);
  }
  return acc;
}

const counts = {};
const details = [];

for (const file of walk(SRC)) {
  const rel = relative(PKG, file).replace(/\\/g, '/');
  const text = readFileSync(file, 'utf8');
  let n = 0;
  const bump = (msg) => {
    n += 1;
    details.push(`${rel}: ${msg}`);
  };

  // 1. label tanpa htmlFor (tag label tunggal)
  for (const m of text.matchAll(/<label\b[^>]*>/g)) {
    if (!/htmlFor=/.test(m[0])) bump('label tanpa htmlFor');
  }
  // 2. button yang hanya berisi ikon dan tanpa nama aksesibel
  for (const m of text.matchAll(/<button\b[\s\S]*?<\/button>/g)) {
    const block = m[0];
    const hasIcon = /<[A-Z]\w*[^>]*\/>/.test(block);
    const inner = block.replace(/<[^>]+>/g, ' ').replace(/\{[^{}]*\}/g, ' ').trim();
    const hasText = /[A-Za-z]{2,}/.test(inner);
    const named = /aria-label=|aria-labelledby=|title=/.test(block);
    if (hasIcon && !hasText && !named) bump('tombol ikon tanpa nama');
  }
  // 3. div/span onClick tanpa role
  for (const m of text.matchAll(/<(div|span)\b[^>]*onClick=[^>]*>/g)) {
    if (!/role=/.test(m[0])) bump('<div|span> onClick tanpa role');
  }
  // 4. outline-none tanpa pengganti fokus pada baris yang sama
  for (const line of text.split(/\r?\n/)) {
    if (/outline-none|outline-0/.test(line) && !/focus-visible|ring-|border-/.test(line)) bump('outline-none tanpa pengganti');
  }
  if (n) counts[rel] = n;
}

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
if (UPDATE) {
  writeFileSync(BASELINE, JSON.stringify(counts, null, 2) + '\n');
  console.log('Baseline a11y diperbarui:', Object.values(counts).reduce((a, b) => a + b, 0));
  process.exit(0);
}

const over = Object.entries(counts).filter(([f, n]) => n > (baseline[f] ?? 0));
if (over.length) {
  console.error('GAGAL: string aksesibilitas bertambah');
  for (const [f, n] of over) console.error(`  ${f}: ${n} (batas ${baseline[f] ?? 0})`);
  details.slice(0, 40).forEach((d) => console.error('  ' + d));
  process.exit(1);
}
console.log('a11y OK:', Object.values(counts).reduce((a, b) => a + b, 0), 'batas');
```

**Perintah:**
```
cd packages/admin-dashboard
node scripts/check-a11y-strings.mjs --update   # kunci baseline hari ini
node scripts/check-a11y-strings.mjs            # harus exit 0
```
**Kriteria terima:** perintah kedua keluar 0 dan mencetak jumlah batas. Baseline tercipta.
**Rollback:** hapus dua file (`script`, `a11y-baseline.json`).

### T-0.2 Buat `scripts/check-contrast-pairs.mjs`

Lokasi: `packages/admin-dashboard/scripts/check-contrast-pairs.mjs` (baru). Membaca token dari `src/index.css`, menghitung rasio WCAG, lalu memeriksa baris kelas yang memuat `bg-<solid>` bersama `text-white`.

```js
#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = fileURLToPath(new URL('..', import.meta.url));
const css = readFileSync(join(PKG, 'src/index.css'), 'utf8');
const solidTokens = ['accent', 'success', 'danger', 'warning', 'info', 'caution', 'violet'];

function tokens(blockName) {
  const start = css.indexOf(blockName);
  const slice = css.slice(start, start + 4000);
  const out = {};
  for (const name of solidTokens) {
    const m = slice.match(new RegExp(`--c-${name}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)`));
    if (m) out[name] = [+m[1], +m[2], +m[3]];
  }
  return out;
}
const light = tokens(':root {');
const dark = tokens('.dark {');

const lum = (rgb) => {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const l1 = lum(a), l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (p.endsWith('.tsx')) acc.push(p);
  }
  return acc;
}

let fails = 0;
for (const file of walk(join(PKG, 'src'))) {
  const rel = relative(PKG, file).replace(/\\/g, '/');
  readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
    if (!/text-white/.test(line)) return;
    const m = line.match(new RegExp(`bg-(${solidTokens.join('|')})\\b`));
    if (!m) return;
    if (/text-on-solid|text-accent-ink/.test(line)) return;
    const r = ratio([255, 255, 255], dark[m[1]] || [0, 0, 0]);
    if (r < 4.5) {
      fails += 1;
      console.log(`FAIL ${r.toFixed(2)}:1 ${rel}:${i + 1} bg-${m[1]} + text-white`);
    }
  });
}
console.log('Pasangan solid + putih gagal:', fails);
process.exit(fails ? 1 : 0);
```

**Kriteria terima awal:** mencetak 110 kegagalan (bukti bahwa skrip bekerja), exit 1.
**Catatan:** setelah Fase 1 selesai, skrip harus mencetak 0 dan dipakai sebagai gerbang.

### T-0.3 Buat `scripts/check-catalog-sync.mjs`

Lokasi: `packages/admin-dashboard/scripts/check-catalog-sync.mjs` (baru, tidak butuh DB).

```js
#!/usr/bin/env node
/**
 * Deteksi drift katalog: services_custom.json vs artefak layanan.html.
 * Tidak butuh DATABASE_URL. Bila DB tersedia, pemeriksaan harga dilakukan terpisah.
 */
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const jsonPath = join(ROOT, 'services_custom.json');
const htmlPath = join(ROOT, 'src', 'landing', 'public', 'layanan.html');

const json = JSON.parse(readFileSync(jsonPath, 'utf8')).filter((s) => s.isActive);
const html = readFileSync(htmlPath, 'utf8');
const m = html.match(/const CLINIC_SERVICES = (\[[\s\S]*?\]);/);
if (!m) {
  console.error('GAGAL: blok CLINIC_SERVICES tidak ditemukan di layanan.html');
  process.exit(1);
}
const inHtml = JSON.parse(m[1]);

const problems = [];
if (json.length !== inHtml.length) problems.push(`jumlah layanan beda: json ${json.length} vs html ${inHtml.length}`);
for (const svc of json) {
  const other = inHtml.find((x) => x.id === svc.id);
  if (!other) { problems.push(`hilang di html: ${svc.id}`); continue; }
  const a = svc.promoPrice ?? svc.originalPrice;
  const b = other.price;
  if (Number(a) !== Number(b)) problems.push(`harga beda ${svc.id}: json ${a} vs html ${b}`);
}
const ageDays = Math.round((Date.now() - statSync(jsonPath).mtimeMs) / 86400000);
if (ageDays > 30) problems.push(`services_custom.json berumur ${ageDays} hari`);

if (problems.length) {
  console.error('GAGAL: katalog tidak sinkron');
  problems.slice(0, 20).forEach((p) => console.error('  ' + p));
  process.exit(1);
}
console.log('katalog sinkron:', json.length, 'layanan, umur snapshot', ageDays, 'hari');
```

**Kriteria terima:** menjalankan skrip menghasilkan daftar masalah nyata (atau "sinkron" bila memang sinkron). Keputusan atas hasilnya diambil di Fase 9.

### T-0.4 Daftarkan skrip di `packages/admin-dashboard/package.json`

Lokasi: `packages/admin-dashboard/package.json`, blok `"scripts"` (baris 7-13).

Tambahkan tanpa menghapus yang ada:

```json
"check:a11y": "node scripts/check-a11y-strings.mjs",
"check:contrast": "node scripts/check-contrast-pairs.mjs",
"check:catalog": "node scripts/check-catalog-sync.mjs",
"check:design": "npm run check:tokens && npm run check:dark-parity && npm run check:a11y && npm run check:contrast"
```

**Kriteria terima:** `npm run check:a11y` dan `npm run check:contrast` bisa dipanggil; `npm run build` tetap keluar 0.
**Rollback:** kembalikan blok scripts.

**Gerbang Fase 0:** ketiga skrip berjalan, baseline a11y terkunci, `npm run build` keluar 0. Tidak ada perubahan UI sama sekali.

---

## FASE 1: P1 Token, kontras, dan kontrak error

**Menutup:** temuan 1 (kontras), X-09 (catch kosong).
**Prasyarat:** Fase 0.
**Blast radius:** 42 file untuk kontras, 12 file untuk catch.
**Risiko kolateral:** teks putih pada latar transparan/kaca bisa ikut berubah. Jangan pakai penggantian global.

### T-1.1 Klasifikasi 110 situs menjadi dua kelompok

Perintah:
```
cd packages/admin-dashboard
node scripts/check-contrast-pairs.mjs > /tmp/kontras-awal.txt
```
Untuk setiap baris di `/tmp/kontras-awal.txt`, kelompokkan:
- **Kelompok A (ganti ke `text-on-solid`)**: latar memakai token solid (`bg-accent`, `bg-success`, `bg-danger`, `bg-warning`, `bg-info`, `bg-violet`, `bg-caution`) **dan** tidak ada `/10`, `/20`, `bg-black`, `bg-white`.
- **Kelompok B (biarkan `text-white`)**: latar transparan (`bg-white/10`, `bg-black/60`), header tema gelap, atau latar gambar.

Perintah pembantu:
```
grep -rn "text-white" src --include=*.tsx | grep -E "bg-(accent|success|danger|warning|info|violet|caution)\b" | grep -v "text-on-solid"
```

### T-1.2 Ganti kelompok A per batch file

Urutan batch (dari `inventory.js`, terbanyak dulu). Setiap batch = satu commit.

| Batch | File | Jumlah |
| :--- | :--- | ---: |
| 1A | `src/pages/staff/StaffToday.tsx` | 35 |
| 1B | `src/components/livechat/LiveChatMessagePane.tsx` | 8 |
| 1C | `src/components/calendar/CreateReservationModal.tsx` | 6 |
| 1D | `src/components/copilot/AdminCopilotPanel.tsx`, `LiveChatThreadList.tsx`, `AiPersona.tsx` | 12 |
| 1E | `CustomerMapTab.tsx` (3), `AiModelSettingsPanel.tsx` (3), `KnowledgeBase.tsx` (3) | 9 |
| 1F | `AddressBookDrawer.tsx` (2), `CustomerFollowUpSection.tsx` (2), `LiveChatComposer.tsx` (2), `Login.tsx` (2), `StaffLogin.tsx` (2), `CustomerService.tsx` (2), `StaffManagement.tsx` (2) | 14 |
| 1G | 26 file dengan 1 situs masing-masing (daftar dari `inventory.js`) | 26 |

Aturan penggantian per situs:
- `bg-accent ... text-white` menjadi `bg-accent ... text-accent-ink`
- `bg-(success|danger|warning|info|violet|caution) ... text-white` menjadi `... text-on-solid`

Contoh konkret (T-1.2a, `src/pages/auth/Login.tsx:104`):
```tsx
// sebelum
className="w-full py-3 px-4 rounded-xl text-white font-semibold text-sm bg-accent hover:bg-accent-hover ..."
// sesudah
className="w-full py-3 px-4 rounded-xl text-accent-ink font-semibold text-sm bg-accent hover:bg-accent-hover ..."
```
Contoh `UiFeedback.tsx:176` (tombol konfirmasi):
```tsx
// sebelum
`px-4 py-2.5 text-white rounded-xl ... ${confirmState.danger ? 'bg-danger hover:bg-danger-hover' : 'bg-accent hover:bg-accent-hover'}`
// sesudah
`px-4 py-2.5 rounded-xl ${confirmState.danger ? 'text-on-solid bg-danger hover:bg-danger-hover' : 'text-accent-ink bg-accent hover:bg-accent-hover'}`
```

**Kriteria terima per batch:** `node scripts/check-contrast-pairs.mjs` jumlah kegagalan turun sesuai jumlah batch; `npm run build` keluar 0.
**Verifikasi visual wajib:** buka 4 halaman (Login, Overview, LiveChat, StaffToday) di tema terang dan gelap. Catat di PR: "tombol X terlihat, kontras ok".

### T-1.3 Tambahkan larangan ke `check:tokens`

Lokasi: `packages/admin-dashboard/scripts/check-design-tokens.mjs`, setelah blok pemeriksaan hex (sekitar baris 51-60).

```js
// Larangan: text-white berdampingan dengan latar solid tanpa token on-solid
const solidRe = /bg-(accent|success|danger|warning|info|caution|violet)\b/;
let whiteOnSolid = 0;
for (const [f] of Object.entries(counts)) {
  const p = join(PKG, f);
  if (!existsSync(p)) continue;
  readFileSync(p, 'utf8').split(/\r?\n/).forEach((line, i) => {
    if (/text-white/.test(line) && solidRe.test(line) && !/text-on-solid|text-accent-ink/.test(line)) {
      whiteOnSolid += 1;
      console.error(`GAGAL ${f}:${i + 1} text-white di atas latar solid`);
    }
  });
}
if (whiteOnSolid) process.exit(1);
```

**Kriteria terima:** setelah semua batch, `npm run check:tokens` keluar 0.

### T-1.4 Kontrak error: tiga pembungkus

Lokasi baru: `src/services/errorPolicy.ts`.

```ts
import { toast } from '../lib/toastBridge'; // lihat T-1.5

/** Kegagalan opsional: tidak mengganggu pengguna, tidak dilaporkan sebagai error. */
export function fireAndForget(p: Promise<unknown>, label: string): void {
  p.catch((e) => console.debug(`[opsional] ${label}`, e));
}

/** Kegagalan opsional dengan satu percobaan ulang senyap. */
export function retrySilently<T>(fn: () => Promise<T>, label: string, retries = 1): Promise<T | null> {
  const attempt = (n: number): Promise<T | null> =>
    fn().catch((e) => {
      if (n > 0) return attempt(n - 1);
      console.debug(`[dilewati] ${label}`, e);
      return null;
    });
  return attempt(retries);
}

/** Kegagalan wajib terlihat: pengguna harus tahu dan bisa mencoba lagi. */
export async function mustSucceed<T>(fn: () => Promise<T>, label: string): Promise<T> {
  try {
    return await fn();
  } catch (e: any) {
    toast(`${label} gagal: ${e?.message || 'coba lagi'}`, 'error');
    throw e;
  }
}
```

Butuh jembatan toast di luar React: `src/lib/toastBridge.ts`.

```ts
type ToastFn = (text: string, type?: 'success' | 'error' | 'info') => void;
let impl: ToastFn | null = null;
export function bindToast(fn: ToastFn) { impl = fn; }
export function toast(text: string, type: 'success' | 'error' | 'info' = 'info') {
  impl ? impl(text, type) : console.warn('[toast belum terpasang]', text);
}
```

Sambungkan di `src/components/common/UiFeedback.tsx` (di dalam `UiFeedbackProvider`, setelah `toast` didefinisikan, sekitar baris 50):
```tsx
useEffect(() => { bindToast(toast); }, [toast]);
```

### T-1.5 Migrasikan 6 catch berisiko

| File:baris | Handler | Ganti menjadi |
| :--- | :--- | :--- |
| `src/pages/staff/StaffToday.tsx:681` | `ensurePaymentInfo().catch(() => {})` | `mustSucceed(() => ensurePaymentInfo(), 'Memuat info pembayaran')` |
| `src/pages/staff/StaffToday.tsx:964` | `markConversationRead` | tetap `fireAndForget(p, 'tandai dibaca')` (perilaku sengaja, beri nama) |
| `src/pages/tenant/AiSandbox.tsx:272` | reset sandbox | `mustSucceed(..., 'Reset sandbox')` |
| `src/components/customer/CustomerMapTab.tsx` (12 situs) | pembersihan peta | `fireAndForget` berlabel |
| `src/components/calendar/CreateReservationModal.tsx` (11 situs) | restore draft/decode | `fireAndForget` berlabel |
| `src/contexts/AuthContext.tsx` (10 situs) | refresh token | `retrySilently` |

**Kriteria terima:** `npm run check:a11y` tetap 0; jumlah `catch {}` turun minimal 40; `npm run build` 0; uji manual buka Live Chat dan tandai satu percakapan dibaca.

**Gerbang Fase 1:** `check:contrast` = 0, `check:tokens` = 0, tangkapan layar 4 halaman di 2 tema terlampir, `npm run build` 0.
**Rollback:** revert per batch; token tidak diubah sehingga pembalikan aman.

---

## FASE 2: P8 Bahasa, atribut dokumen, dan teks

**Menutup:** 7 (em dash), 8 (emoji), V-01 (`lang`), V-10 sebagian (istilah di nav), V-11 (`aria-current`), V-12 (boot).
**Prasyarat:** Fase 0 (untuk gerbang a11y).
**Blast radius:** 51 file untuk emoji, 53 file untuk em dash, 1 layout, 1 bilah boot, 1 index.html.
**Risiko kolateral:** rendah. Risiko utama hanya bila teks yang diganti dipakai test integrasi backend.

### T-2.1 `index.html`

Lokasi: `packages/admin-dashboard/index.html`.
- Baris 2: `<html lang="en">` menjadi `<html lang="id">`.
- Baris 18: `<title>Kala Moms & Baby Spa — Admin Dashboard</title>` menjadi:
```html
<title>Admin Dashboard</title>
```
Alasan: em dash dihapus, dan nama brand tidak lagi tertanam di build (temuan 16). Nama brand dipasang runtime oleh `ThemeProvider`/`App`:
```tsx
// src/App.tsx, di dalam App komponen, sebelum return
useEffect(() => {
  const name = import.meta.env.VITE_CLINIC_NAME || 'Admin Dashboard';
  document.title = `${name} | Admin`;
}, []);
```

**Kriteria terima:** `document.documentElement.lang === 'id'`; `document.title` tidak memuat em dash; `grep -n "—" index.html` kosong.

### T-2.2 Rename nama file label & judul: hapus em dash

Perintah untuk daftar lengkap:
```
cd packages/admin-dashboard
grep -rn "—" src --include=*.tsx | grep -v "^\s*//" | grep -v "{\/\*"
```
Ganti per file, urutan terbanyak: `FollowUpTemplates.tsx` (17), `AiModelSettingsPanel.tsx` (10), `MetaCapiQueue.tsx` (9), `StaffToday.tsx` (8), `CreateReservationModal.tsx` (7), lalu sisanya.

Pola penggantian (wajib kontekstual, bukan global):
- `"X — Y"` menjadi `"X: Y"` bila Y adalah keterangan.
- `"X — Y"` menjadi `"X, Y"` bila Y adalah lanjutan kalimat.
- Rentang waktu tetap memakai en dash (`08.00 - 17.00` atau `08.00 s.d. 17.00`).

Contoh terverifikasi:
```tsx
// src/components/livechat/LiveChatMessagePane.tsx:1327
<span>Catatan Internal: {msg.sender_name || 'Staf'}</span>
// src/components/calendar/ReservationStatusIcon.tsx:82
return { label: 'HOLD, slot ditahan sementara', icon: null };
// src/components/calendar/ReservationStatusIcon.tsx:100
return { label: 'Pending, menunggu konfirmasi', icon: <AlertCircle size={11} aria-hidden="true" /> };
```

**Kriteria terima:** `grep -rn "—" src --include=*.tsx | grep -v "//" | wc -l` = 0.
**Rollback:** revert per file.

### T-2.3 Hapus emoji dari teks UI

Daftar per file dari `inventory.js`. Prioritas dan aturan:
1. **Judul dan badge** (wajib): `CreateReservationModal.tsx` (17), `Reservations.tsx` (24), `TodayTreatments.tsx` (24), `StaffToday.tsx` (57).
2. **Toast** (wajib): `Layout.tsx` baris 714, 718, 722 (`🔊`, `🔔`, `🔇`).
3. **Pesan sistem teknis** (`Debug.tsx` 33, `AiModelSettingsPanel.tsx` 46): boleh dipertahankan bila menandai status nyata, tetapi wajib alasan tertulis di komentar satu baris.
4. **Dialog berisiko** (`⚠️`, `📸` di `StaffToday.tsx:2039`, `:2056`): ganti dengan ikon Lucide yang sama maknanya (`AlertTriangle`, `Camera`) agar isyarat bahaya tidak hilang.

Contoh:
```tsx
// sebelum (StaffToday.tsx:2039)
title: '⚠️ Pembayaran Belum Lunas',
// sesudah
title: 'Pembayaran Belum Lunas',
```
Ikon dipasang di komponen dialog, bukan di string, sehingga pembaca layar tidak mengejanya.

**Kriteria terima:** jumlah baris emoji di `grep -rnP "[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]" src --include=*.tsx` turun minimal 80 persen; tidak ada emoji di judul (`<h1|h2|h3>`).

### T-2.4 `aria-current` pada nav

Lokasi: `src/components/common/Layout.tsx:638-660` (`const isActive = location.pathname === item.path;`).

Tambahkan pada elemen link nav (baris ~646):
```tsx
aria-current={isActive ? 'page' : undefined}
```

**Kriteria terima:** snapshot aksesibilitas menunjukkan satu item dengan `current: page`; `npm run check:a11y` 0.

### T-2.5 Status boot

Lokasi: `src/components/common/BootProgress.tsx` (92 baris).

Bungkus bilah dengan:
```tsx
<div role="status" aria-live="polite" aria-label="Memuat aplikasi">
  <div className="..." />
  <span className="sr-only">{currentPhaseLabel}</span>
</div>
```
`currentPhaseLabel` diambil dari state fase yang sudah ada.

**Kriteria terima:** snapshot aksesibilitas menampilkan status dengan teks yang berubah antar fase.

**Gerbang Fase 2:** `check:a11y` 0, `check:contrast` 0, `npm run build` 0, `grep` em dash = 0, emoji turun ≥80 persen.
**Rollback:** revert per file; tidak ada perubahan struktur.

---

## FASE 3: P2 Modal bersama dan skala z-index

**Menutup:** 3 (45 modal), 4 (70 tombol ikon), V-07 (z-index), X-06 (0/30).
**Prasyarat:** Fase 1 (warna) dan Fase 2 (label/tombol).
**Blast radius:** 45 file, termasuk alur reservasi, invoice, chat, peta, pelanggan.
**Risiko kolateral:** tertinggi kedua. Modal bersarang, drawer mobile, scroll lock.

### T-3.1 Tetapkan skala z-index sebagai token

Lokasi: `src/index.css`, di dalam `:root` (setelah baris 42).

```css
/* Skala lapisan tunggal. Angka manual di komponen DILARANG. */
--z-base: 0;
--z-sticky: 10;
--z-sidebar: 30;
--z-overlay: 40;
--z-dialog: 50;
--z-popover: 60;
--z-toast: 70;
```
Lalu di `tailwind.config.js`, tambahkan pada `theme.extend`:
```js
zIndex: {
  sticky: 'var(--z-sticky)',
  sidebar: 'var(--z-sidebar)',
  overlay: 'var(--z-overlay)',
  dialog: 'var(--z-dialog)',
  popover: 'var(--z-popover)',
  toast: 'var(--z-toast)',
},
```

**Kriteria terima:** kelas `z-dialog`, `z-toast` tersedia; `grep -rn "z-\[9" src` menurun setelah T-3.4.

### T-3.2 Ganti `src/components/ui/Modal.tsx` (versi baru)

Lokasi: `src/components/ui/Modal.tsx` (121 baris, ganti seluruh isi).

```tsx
import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  variant?: 'dialog' | 'sheet';
  className?: string;
  closeOnBackdrop?: boolean;
  initialFocusRef?: React.RefObject<HTMLElement>;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export const Modal: React.FC<ModalProps> = ({
  open, onClose, title, subtitle, children, footer,
  size = 'md', variant = 'dialog', className = '', closeOnBackdrop = true, initialFocusRef,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const titleId = useRef(`modal-title-${Math.random().toString(36).slice(2, 9)}`);
  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement;
    const t = window.setTimeout(() => {
      const target = initialFocusRef?.current || panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      target?.focus();
    }, 0);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const nodes = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      if (!nodes.length) return;
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', onKey);
      restoreRef.current?.focus?.();
    };
  }, [open, onClose, initialFocusRef]);

  if (!open) return null;

  const sizeClass = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg sm:max-w-xl', xl: 'max-w-2xl sm:max-w-3xl', full: 'max-w-5xl' }[size];
  const shell =
    variant === 'sheet'
      ? `relative w-full ${sizeClass} bg-surface border border-divider rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col mt-auto sm:my-auto`
      : `relative w-full ${sizeClass} bg-surface border border-divider rounded-2xl shadow-2xl overflow-hidden flex flex-col my-auto`;

  return createPortal(
    <div className="fixed inset-0 z-dialog flex items-end sm:items-center justify-center p-0 sm:p-5">
      <div
        className="absolute inset-0 bg-black/55 backdrop-blur-xs"
        onClick={() => closeOnBackdrop && onClose()}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId.current : undefined}
        className={`${shell} ${className}`}
      >
        {variant === 'sheet' && <div className="w-10 h-1 bg-strong rounded-full mx-auto mt-2 sm:hidden" />}
        {(title || subtitle) && (
          <div className="px-5 py-4 border-b border-divider bg-surface-2 flex items-center justify-between shrink-0">
            <div className="min-w-0 pr-4">
              {title && <h2 id={titleId.current} className="text-sm font-bold text-ink truncate">{title}</h2>}
              {subtitle && <p className="text-xs text-ink-2 mt-0.5">{subtitle}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Tutup dialog"
              className="text-ink-3 hover:text-ink p-1.5 rounded-lg hover:bg-fill-1 transition cursor-pointer shrink-0"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        )}
        <div className="p-5 overflow-y-auto max-h-[calc(100dvh-180px)] space-y-4">{children}</div>
        {footer && (
          <div className="px-5 py-3.5 border-t border-divider bg-surface-2 flex items-center justify-end gap-2 shrink-0">{footer}</div>
        )}
      </div>
    </div>,
    document.body
  );
};
```

**Kriteria terima:** modal baru lolos pemeriksaan manual: Tab berputar di dalam, Escape menutup, fokus kembali ke pemicu, `role="dialog"` ada.

### T-3.3 Migrasikan dialog konfirmasi dan toast di `UiFeedback.tsx`

Lokasi: `src/components/common/UiFeedback.tsx:138-190`.

- Bungkus panel konfirmasi dengan `role="dialog" aria-modal="true" aria-labelledby` dan tambahkan handler `Escape`.
- Toast (baris 122-135) diberi `role="status" aria-live="polite"`, tombol tutup diberi `aria-label="Tutup notifikasi"`, dan jeda saat hover (simpan timer di ref, batalkan saat `onMouseEnter`).
- Ganti kelas `text-white` di tombol konfirmasi sesuai Fase 1.

**Kriteria terima:** Escape menutup konfirmasi; toast diumumkan (uji dengan pembaca layar atau `aria-live` di inspector); `check:a11y` 0.

### T-3.4 Migrasi 45 overlay per modul

Urutan wajib (dari yang paling sederhana ke paling khusus). Satu modul = satu commit.

| Putaran | File | Catatan |
| :--- | :--- | :--- |
| 4.1 | `LiveChatSyncModal.tsx`, `LiveChatPaymentProofModal.tsx`, `ExternalIntegrationModal.tsx`, `LocationPickerModal.tsx` | tanpa scroll khusus |
| 4.2 | `DailyScheduleModal.tsx`, `QuickHoldModal.tsx`, `ReservationDetailModal.tsx`, `ChatHistoryModal.tsx` | perlu `size="lg"` |
| 4.3 | `CustomerEditForm.tsx`, `AddressBookDrawer.tsx` | `variant="sheet"` di mobile |
| 4.4 | `InvoiceGeneratorModal.tsx`, `LiveChatModals.tsx`, `FleetMapModal.tsx`, `DispatchMapModal.tsx` | layout dua kolom |
| 4.5 | `StaffToday.tsx` (9 overlay) | per overlay satu commit |
| 4.6 | `TodayTreatments.tsx` (7), `Reservations.tsx` (3), `StaffManagement.tsx` (3) | |
| 4.7 | `CustomerDatabase.tsx` (2), `FollowUpQueue.tsx` (2), `CustomerFollowUpSection.tsx` (2) | |
| 4.8 | `CreateReservationModal.tsx` (3 overlay) | **paling akhir**, paling banyak kekhususan |
| 4.9 | `MediaImage.tsx`, `UiFeedback.tsx`, `Layout.tsx` (2) | lapisan khusus: `z-popover`, `z-toast` |

Setiap migrasi: hapus `fixed inset-0 ... bg-black/...` manual, ganti dengan `<Modal variant=... size=... onClose=...>`, pertahankan `id` dan kelas isi.

**Kriteria terima per putaran:** jumlah `fixed inset-0` + `bg-black` turun sesuai putaran; 5 kombinasi uji manual dilakukan dan dicatat; tidak ada halaman yang tidak bisa digulir setelah modal ditutup.

### T-3.5 Nama aksesibel untuk 70 tombol ikon

Perintah daftar:
```
node scripts/check-a11y-strings.mjs --update   # jangan; gunakan laporan detail
grep -rn "aria-label" src --include=*.tsx | wc -l
```
Aturan: setiap tombol yang isinya hanya `<Icon />` diberi `aria-label` yang menjelaskan aksi, bukan ikonnya.
Contoh terverifikasi:
```tsx
// src/components/common/LocationPickerModal.tsx:170
<button onClick={onClose} aria-label="Tutup pemilih lokasi" className="..."><X size={16} aria-hidden="true" /></button>
// src/components/calendar/DailyScheduleModal.tsx:115
<button onClick={onClose} aria-label="Tutup jadwal harian" className="..."><X size={18} aria-hidden="true" /></button>
```

**Gerbang Fase 3:** `check:a11y` 0 (baseline turun), jumlah overlay manual ≤ 5 (sisanya di `ui/Modal.tsx` dan `MediaImage`), uji 5 kombinasi lulus, `npm run build` 0.
**Rollback:** per file, karena setiap migrasi satu commit.

---

## FASE 4: P4 Header halaman, state, dan daftar

**Menutup:** 13, V-04, X-04, X-05.
**Prasyarat:** Fase 1 dan 3.
**Blast radius:** 30 halaman.
**Risiko kolateral:** struktur DOM berubah; tinggi halaman bergeser.

### T-4.1 Buat `src/components/ui/PageHeader.tsx`

```tsx
import React from 'react';

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle, actions, meta }) => (
  <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
    <div className="min-w-0">
      <h1 className="text-xl font-bold tracking-tight text-ink truncate">{title}</h1>
      {subtitle && <p className="text-xs text-ink-2 mt-0.5">{subtitle}</p>}
      {meta}
    </div>
    {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
  </div>
);
```

### T-4.2 Ganti judul halaman di 18 file tanpa `h1`

| File | Baris saat ini | Ganti |
| :--- | :--- | :--- |
| `Overview.tsx` | 149 (`<h2 className="text-xl ...">Overview</h2>`) | `<PageHeader title="Overview" ... />` |
| `Reservations.tsx` | header halaman | `<PageHeader title="Kalender & Reservasi" />` |
| `Settings.tsx` | header | `<PageHeader title="Pengaturan Operasional" />` |
| `KnowledgeBase.tsx` | header | `<PageHeader title="Knowledge Base FAQ" />` |
| `QuickReplies.tsx` | header | `<PageHeader title="Balasan Cepat" />` |
| `FollowUpTemplates.tsx` | header | `<PageHeader title="Template Follow-Up" />` |
| `DeliveryTiers.tsx` | header | `<PageHeader title="Tarif Jarak & Ongkir" />` |
| `CustomerService.tsx` | header | `<PageHeader title="Customer Service & CTA" />` |
| `AiSandbox.tsx` | header | `<PageHeader title="AI Sandbox" />` |
| `AiEvaluations.tsx` | header | `<PageHeader title="Evaluasi Kualitas AI" />` |
| `ChatExport.tsx` | header | `<PageHeader title="Ekspor Chat Harian" />` |
| `Debug.tsx` | header | `<PageHeader title="Diagnostik Sistem" />` |
| `LandingPage.tsx` | header | `<PageHeader title="Landing Page Builder" />` |
| `MetaCapiQueue.tsx` | header | `<PageHeader title="Antrean Meta CAPI" />` |
| `MetaClickCatcher.tsx` | header | `<PageHeader title="Meta Click Catcher" />` |
| `Login.tsx`, `StaffLogin.tsx` | kartu login | tetap `h1` tersembunyi (`sr-only`) agar dokumen punya satu `h1` |
| `StitchShowcase.tsx` | header | ditangani Fase 9 (halaman dihapus) |

**Kriteria terima:** skrip pemeriksa baru `node -e` sederhana atau perintah:
```
cd packages/admin-dashboard
for f in src/pages/tenant/*.tsx; do c=$(grep -c "<h1" "$f"); echo "$c $f"; done
```
Setiap file harus 1 (kecuali `StitchShowcase`). Halaman dengan `h1` yang sudah ada (`StaffToday`, `LiveChatMonitor`, dst.) tidak diubah.

### T-4.3 Buat `src/components/ui/StateViews.tsx`

Berisi tiga komponen:
- `EmptyState({ title, description, action })`: wajib menyebut **sebab** dan **langkah berikutnya**.
- `ErrorState({ title, description, onRetry })`: wajib punya tombol "Coba lagi".
- `SkeletonRows({ rows, columns })`: tinggi baris sama dengan baris data nyata.

Aturan pemakaian:
- Dilarang memakai teks "Tidak ada data" saja. Minimal: "Belum ada reservasi untuk tanggal ini" + aksi "Buat reservasi".
- `SkeletonRows` dipakai pada daftar yang memuat >20 baris.

### T-4.4 Terapkan di 4 halaman tersibuk

| Halaman | State kosong | State error | Loading |
| :--- | :--- | :--- | :--- |
| `LiveChatMonitor` | "Belum ada percakapan" + aksi "Muat ulang" | banner error + "Coba lagi" | skeleton 8 baris |
| `Reservations` | "Belum ada jadwal pada tanggal ini" + "Buat reservasi" | `ErrorState` | skeleton 8 baris |
| `TodayTreatments` | "Tidak ada kunjungan hari ini" | `ErrorState` | skeleton 5 baris |
| `CustomerDatabase` | "Belum ada pelanggan yang cocok" + "Hapus filter" | `ErrorState` | skeleton 10 baris |

**Kriteria terima:** di setiap halaman, paksa state dengan mematikan API (DevTools offline), memastikan ketiga state tampil dan teksnya menjelaskan sebab dan aksi.

### T-4.5 Paginasi untuk 2 daftar terbesar

`MetaCapiQueue.tsx` dan `ClinicServices.tsx`: bila jumlah baris >200, tambahkan paginasi memakai `Pagination` yang sudah ada (`src/components/common/Pagination.tsx`).
**Verifikasi dulu** jumlah baris nyata dari API sebelum memutuskan (jangan menebak).

**Gerbang Fase 4:** setiap rute 1 `h1`, 4 halaman punya 3 state, `npm run build` 0, `check:a11y` 0.

---

## FASE 5: P3 Label form dan validasi terpusat

**Menutup:** 2, V-02, V-03, X-08 (bagian form publik).
**Prasyarat:** Fase 3 (modal) dan Fase 4 (state error).
**Blast radius:** 331 toast error, 30 halaman.
**Risiko kolateral:** tertinggi dari sisi operasional.

### T-5.1 Perbaiki `src/components/ui/Fields.tsx` (id deterministik)

Masalah saat ini: `const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);` menghasilkan id sama untuk dua field berlabel sama.

Ganti dengan:
```tsx
const reactId = React.useId();
const inputId = id || (label ? `field-${reactId}` : undefined);
```
Berlaku untuk `Input`, `Textarea`, `Select` (tiga tempat, baris 40, 55, 76 kira-kira).

**Kriteria terima:** dua input berlabel sama punya id berbeda; `label[for]` cocok.

### T-5.2 Perbaiki Login dan StaffLogin

`Login.tsx` baris 64-98 dan `StaffLogin.tsx` baris 62-98:
- Tambah `id="login-identifier"` + `<label htmlFor="login-identifier">`.
- Tambah `id="login-password"` + `htmlFor`, `autoComplete="current-password"`.
- Identifier: `autoComplete="username"`, `inputMode="email"` pada varian email, `enterKeyHint="next"`.
- Tambah tombol tampilkan password (opsional, `aria-pressed`).

**Kriteria terima:** `document.querySelectorAll('label')` semuanya punya `htmlFor` yang menunjuk `input` ada; `check:a11y` 0.

### T-5.3 Modul validasi reservasi

Lokasi baru: `src/lib/validateReservation.ts`.

```ts
export interface DraftForValidation {
  customerId?: string | null;
  items: Array<{ id: string; name?: string; isCustom?: boolean }>;
  bookingDate?: string | null;
  startTime?: string | null;
  addressMode?: 'existing' | 'new';
  newAddressText?: string | null;
}

export interface FieldIssue { field: string; message: string }

export function validateReservation(d: DraftForValidation): FieldIssue[] {
  const issues: FieldIssue[] = [];
  if (!d.customerId) issues.push({ field: 'customerId', message: 'Pilih pasien terlebih dahulu.' });
  if (!d.items?.length) issues.push({ field: 'items', message: 'Pilih minimal satu layanan.' });
  if (!d.bookingDate) issues.push({ field: 'bookingDate', message: 'Tentukan tanggal kunjungan.' });
  if (!d.startTime) issues.push({ field: 'startTime', message: 'Tentukan jam mulai.' });
  const custom = d.items?.find((i) => i.isCustom && !i.name?.trim());
  if (custom) issues.push({ field: `item.${custom.id}`, message: 'Nama layanan kustom wajib diisi.' });
  if (d.addressMode === 'new' && !d.newAddressText?.trim()) {
    issues.push({ field: 'newAddressText', message: 'Alamat baru wajib diisi.' });
  }
  return issues;
}
```

### T-5.4 Test unit validator (wajib sebelum mengganti handler)

Lokasi: `packages/admin-dashboard/src/lib/validateReservation.test.ts` (file test pertama di paket ini).
Tambahkan ke `package.json`: `"test:int": "vitest run src/lib --config ../../vitest.config.ts"` hanya bila root config kompatibel; bila tidak, jalankan lewat root: `npx vitest run packages/admin-dashboard/src/lib/validateReservation.test.ts`.

Kasus wajib:
1. Semua kosong menghasilkan 4 isu sekaligus.
2. Hanya customer diisi menghasilkan 3 isu.
3. Draft valid menghasilkan 0 isu.
4. Custom item tanpa nama menghasilkan 1 isu.
5. Alamat baru kosong menghasilkan 1 isu.
6. **Regresi**: 20 draft nyata (ambil dari log atau DB) wajib menghasilkan 0 isu.

**Kriteria terima:** semua kasus hijau, termasuk 20 draft nyata.

### T-5.5 Ringkasan error dan ikatan field di modal reservasi

Lokasi: `src/components/calendar/CreateReservationModal.tsx`.
- Ganti blok toast berurutan di baris 1625, 1629, 1633, 1637 dengan satu pemanggilan `validateReservation`.
- Tambahkan state `issues` dan render `FormErrorSummary` di atas form.
- Untuk setiap field, kirim `error={issues.find(i => i.field === 'customerId')?.message}` ke `<Input>/<Select>` (komponen sudah mendukung `error`).
- Tambah `aria-invalid` dan `aria-describedby` di `Fields.tsx` (satu tempat, berlaku semua form):

```tsx
<input
  aria-invalid={hasError || undefined}
  aria-describedby={hasError ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
  ...
/>
{error && <p id={`${inputId}-error`} className="text-[11px] font-medium text-danger">{error}</p>}
```

**Kriteria terima:** satu tekan Simpan dengan form kosong menampilkan semua pesan sekaligus; pesan menetap (bukan toast) sampai field diperbaiki; `aria-invalid` muncul di DOM.

### T-5.6 Tambahkan komponen `FormErrorSummary`

Lokasi baru: `src/components/ui/FormErrorSummary.tsx`.
```tsx
import React from 'react';
import type { FieldIssue } from '../../lib/validateReservation';

export const FormErrorSummary: React.FC<{ issues: FieldIssue[]; className?: string }> = ({ issues, className = '' }) => {
  if (!issues.length) return null;
  return (
    <div role="alert" className={`rounded-xl border border-danger-line bg-danger-soft p-3 text-xs text-danger ${className}`}>
      <p className="font-bold mb-1">Periksa {issues.length} hal berikut:</p>
      <ul className="list-disc pl-4 space-y-0.5">
        {issues.map((i) => <li key={i.field}>{i.message}</li>)}
      </ul>
    </div>
  );
};
```

### T-5.7 Migrasikan sisa form secara bertahap

Urutan: `AiPersona` → `Settings` → `ClinicServices` → `KnowledgeBase` → `StaffManagement` → `QuickReplies` → `FollowUpTemplates` → `DeliveryTiers` → `CustomerService` → `LandingPage`.
Aturan per form: validator kecil (5-10 baris), `issues` state, satu ringkasan, ikatan `error` per field. Toast hanya untuk kegagalan server.

**Gerbang Fase 5:** validator lulus 20 draft nyata, satu tekan menampilkan semua pesan di 3 form utama, `check:a11y` 0, `npm run build` 0, tidak ada alur yang dulu sah jadi terblokir (uji manual 5 reservasi).
**Rollback:** flag `USE_NEW_VALIDATOR` di `CreateReservationModal` untuk kembali ke handler lama tanpa revert.

---

## FASE 6: P5 Tipografi dan target sentuh

**Menutup:** 11, 14, X-02.
**Prasyarat:** Fase 4 (struktur) dan **tidak bersamaan** Fase 7.
**Blast radius:** semua permukaan.
**Risiko kolateral:** layout bergeser; teks panjang bisa terpotong.

### T-6.1 Keputusan font (gate keputusan)

Pilih satu:
- **Opsi A (tanpa unduh):** hapus deklarasi `'Plus Jakarta Sans'` di `src/index.css:243`, resmikan stack sistem di `tailwind.config.js:49`. Kelebihan: tanpa permintaan jaringan, tanpa FOUT. Kekurangan: tipografi tidak khas.
- **Opsi B (satu font):** muat satu keluarga (mis. `Plus Jakarta Sans` 400/600/700) lewat `@font-face` lokal di `public/fonts/` (tanpa CDN), `font-display: swap`, preload satu berkas.

**Rencana memakai Opsi A** kecuali pemilik produk memilih B. Opsi A sudah menutup temuan "deklarasi mati".

### T-6.2 Samakan tipografi 3 halaman publik

- `go.html`: Outfit (via Google Fonts).
- `layanan.html`: hasil generate `scripts/build_landing.js` (deklarasi Plus Jakarta tanpa muat).
- `pricelist.html`: Fredoka + Nunito.

Bila Opsi A dipilih: ganti ketiganya ke stack sistem, hapus tautan Google Fonts, dan ubah deklarasi di `build_landing.js` (cari `font-family: 'Plus Jakarta Sans'` di template generator, bukan di file hasil) serta di `build_pricelist.js`.
Bila Opsi B: satu berkas font yang sama untuk ketiganya.

**Kriteria terima:** ketiga halaman memakai keluarga font yang sama; `document.fonts` menunjukkan keluarga itu termuat (atau nol bila Opsi A); `check:catalog` tetap 0.

### T-6.3 Naikkan minimum teks

- `src/index.css:395-408`: blok `@media (max-width: 768px)` sudah menaikkan `text-xs` ke 13px dan `[9px]/[10px]` ke 11px. Naikkan batas minimum desktop pula:
```css
@media (min-width: 769px) {
  [class*="text-[9px]"], [class*="text-[10px]"] { font-size: 0.6875rem !important; line-height: 0.875rem !important; }
}
```
- Ganti pemakaian `text-[9px]` menjadi `text-[11px]` pada 82 file, diprioritaskan di `StaffToday` (75), `ClinicServices` (42), `Debug` (41), `CreateReservationModal` (31), `CustomerDatabase` (31), `AiSandbox` (30).
Perintah daftar:
```
grep -rn "text-\[9px\]" src --include=*.tsx
```

### T-6.4 Target sentuh 44px

- `src/index.css:426-428`: ubah `min-height: 38px` menjadi `min-height: 44px` untuk tombol aksi, tetapi **kecualikan** tombol di dalam tabel dan chip:
```css
@media (max-width: 768px) {
  button:not(.no-touch-min):not(table button):not(.inline-chip):not(.aspect-square) {
    min-height: 44px;
  }
}
```
- `src/components/ui/Button.tsx:25-27`: `sm` dari `min-h-[32px]` menjadi `min-h-[38px]`, `md` dari `38px` menjadi `44px`, `lg` tetap `44px`.

**Kriteria terima:** di 360px, tombol aksi utama ≥44px; tabel tidak melar (uji 3 tabel terbesar); `npm run build` 0.

**Gerbang Fase 6:** uji 360/768/1440 tanpa overflow horizontal; tidak ada teks <11px; font konsisten di 4 permukaan.
**Rollback:** kembalikan `index.css` dan `Button.tsx`; halaman publik dikembalikan lewat generator.

---

## FASE 7: P6 Motion, elevasi, dan state navigasi

**Menutup:** 9, 10, 15, V-05, V-08, X-10, X-11.
**Prasyarat:** Fase 4 (tinggi halaman stabil), Fase 3 (modal).
**Blast radius:** 23 file animasi, 47 file blur, 13 panel Settings, semua rute.

### T-7.1 Kurangi animasi loop

Aturan: satu denyut hanya untuk status yang benar-benar live, dan berhenti setelah 20 detik.
- `LiveChatMonitor.tsx:770`: titik status koneksi. Ganti `animate-pulse` dengan `animate-none` + warna tetap; status sudah punya label teks.
- `StaffToday.tsx:3514`: `animate-action-pulse` pada tombol selesai. Batasi dengan kelas baru:
```css
.animate-action-pulse { animation: actionPulse 2.2s ease-in-out 6; }
```
(6 iterasi = sekitar 13 detik, lalu berhenti.)
- `CustomerDatabase.tsx` (12), `AiSandbox.tsx` (5), `AiEvaluations.tsx` (3), `Reservations.tsx` (2), `TodayTreatments.tsx` (2): hapus `animate-pulse` pada indikator yang tidak live.

**Kriteria terima:** jumlah `animate-pulse|animate-bounce|animate-ping` turun ≥80 persen; tidak ada elemen berdenyut setelah 20 detik.

### T-7.2 Turunkan blur dan bayangan

Aturan: blur hanya pada lapisan overlay (sudah dipusatkan di `Modal.tsx`), hapus dari kartu dan bilah biasa.
- Hapus `backdrop-blur` di `StaffToday.tsx` (10), `TodayTreatments.tsx` (10), `MediaImage.tsx` (4, sisakan 1 pada penampil), `Layout.tsx` (4, sisakan pada popover).
- Ganti `shadow-lg/xl/2xl` pada kartu dengan `shadow-xs`; sisakan `shadow-2xl` hanya untuk dialog.

**Kriteria terima:** jumlah `backdrop-blur` ≤ 10; tidak ada kartu dengan `shadow-lg` ke atas.

### T-7.3 Hapus CSS mati

Lokasi: `src/index.css`.
- Hapus `.gradient-text` (baris 461-465).
- Hapus `.glass-panel` (442-446) dan `.glass-card` (448-459), ganti pemakaiannya dengan `Card` bila ada.
- Hapus `@keyframes pulseGlow` (541-548) bila tidak dipakai (verifikasi dengan grep `pulseGlow`).

**Kriteria terima:** grep nama kelas tersebut di `src/**/*.tsx` = 0 sebelum dihapus dari CSS.

### T-7.4 Scroll restore

Lokasi baru: `src/components/common/ScrollToTop.tsx`.
```tsx
import { useEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

export const ScrollToTop: React.FC = () => {
  const { pathname } = useLocation();
  const navType = useNavigationType();
  const positions = useRef<Record<string, number>>({});
  useEffect(() => {
    if (navType === 'POP') {
      window.scrollTo(0, positions.current[pathname] ?? 0);
    } else {
      window.scrollTo(0, 0);
    }
    return () => { positions.current[pathname] = window.scrollY; };
  }, [pathname, navType]);
  return null;
};
```
Pasang di `src/App.tsx` tepat di dalam `<BrowserRouter>` sebelum `<Routes>`.

**Kriteria terima:** dari daftar pelanggan yang sudah digulir, buka detail, tekan Back, posisi kembali; buka halaman lain, mulai dari atas.

### T-7.5 Dirty guard untuk konfigurasi

Lokasi baru: `src/hooks/useDirtyGuard.ts`. Memakai `useUiFeedback` (konfirmasi) dan `useFormDraft` (draft) yang sudah ada.
```ts
import { useEffect } from 'react';

export function useDirtyGuard(dirty: boolean, label = 'Perubahan belum disimpan') {
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = label;
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, label]);
}
```
Pemakaian:
- `AiPersona.tsx`: hitung `dirty` dengan membandingkan state dengan nilai awal; pasang guard; pakai `useFormDraft` untuk menyimpan draft.
- `Settings.tsx:739-1062`: sebelum mengganti `subTab`, bila panel kotor panggil `confirm({ title: 'Tinggalkan perubahan?', message: '...' })`; bila batal, hentikan pergantian.

**Kriteria terima:** mengetik di AiPersona lalu menutup tab memunculkan peringatan; ganti tab dengan perubahan memunculkan konfirmasi; tanpa perubahan tidak ada peringatan.

### T-7.6 URL state untuk filter

Lokasi baru: `src/hooks/useUrlState.ts`. Memakai `useSearchParams` dengan `replace: true` untuk perubahan cepat.
Terapkan pada: `Reservations` (tanggal, view), `CustomerDatabase` (tab, q, filter), `FollowUpQueue` (status, rentang), `MetaClickCatcher` (status, tanggal), `MetaCapiQueue` (status).

**Kriteria terima:** set filter, refresh, filter tetap; salin URL, hasil sama; tombol Back mengembalikan filter sebelumnya.

### T-7.7 Reduced motion di halaman publik

Tambahkan blok yang sama seperti dashboard ke `scripts/build_landing.js` (template) dan `pricelist.html` (sudah ada satu, periksa cakupannya), serta `go.html`:
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; scroll-behavior: auto !important; }
}
```

**Gerbang Fase 7:** tidak ada loop tak berujung; 1 `window.scrollTo` global + ScrollToTop; dirty guard bekerja; filter tersimpan di URL; reduced motion ada di 3 halaman publik.
**Rollback:** per tugas; ScrollToTop bisa dilepas satu baris.

---

## FASE 8: P7 Format data kanonik

**Menutup:** V-06 (tanggal), V-09 (uang), V-10 (istilah), 12 (hierarki KPI), 17 (tabel 1240px).
**Prasyarat:** Fase 6 (tipografi), tidak bersamaan Fase 5.
**Blast radius:** 23 file tanggal, 14 file uang, ~300 label istilah.

### T-8.1 Uang: satu fungsi

Lokasi baru: `src/utils/money.ts`.
```ts
export function formatRupiah(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return 'Rp ' + Number(value).toLocaleString('id-ID');
}
/** Untuk kartu sempit. Contoh: Rp 1,5 jt, Rp 250 rb. */
export function formatRupiahRingkas(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  if (!n) return 'Rp 0';
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(1).replace('.0', '').replace('.', ',')} jt`;
  if (n >= 1_000) return `Rp ${Math.round(n / 1000)} rb`;
  return `Rp ${n}`;
}
export function formatGratis(value: number, freeLabel = 'Gratis'): string {
  return Number(value) === 0 ? freeLabel : formatRupiah(value);
}
```
Ganti 11 definisi lokal (daftar terverifikasi):
`LiveChatThreadList.tsx:38`, `InvoiceGeneratorModal.tsx:59`, `dashboard-metrics.ts:18`, `StaffToday.tsx:237`, `AiEvaluations.tsx:59`, `AiSandbox.tsx:47`, `CustomerDatabase.tsx:461`, `DeliveryTiers.tsx:117`, `FinancialAnalytics.tsx:142`, `MetaCapiQueue.tsx:68`, `TodayTreatments.tsx:125`.
Untuk `dashboard-metrics.ts`, pertahankan ekspor lama sebagai re-export agar pemanggil tidak rusak.

**Kriteria terima:** snapshot test `formatRupiah(0|1500|1500000|null)`; grep definisi lokal = 0; nominal di dashboard, invoice, dan chat identik untuk nilai yang sama.

### T-8.2 Tanggal: wajib lewat `dateWib.ts`

Aturan: dilarang `new Date(...).toLocale*` di `src/components/**` dan `src/pages/**`.
- Tambahkan ke `check:a11y-strings.mjs` (atau skrip baru) pemeriksaan: baris dengan `toLocaleDateString|toLocaleTimeString` tanpa `formatWib`/`timeZone` di jalur `components|pages` = pelanggaran.
- Migrasikan 54 situs di 23 file, urutan: `LiveChatMessagePane` (6), `CustomerDatabase` (5), `WeekScheduleGrid` (4), `ReservationDetailModal` (4), `Reservations` (4), lalu sisanya.
Pola:
```tsx
// sebelum
new Date(r.booking_date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })
// sesudah
formatWibDate(r.booking_date, { day: '2-digit', month: 'short' })
```
`formatWibDate` sudah ada di `src/utils/dateWib.ts:130` dan sudah menyuntik `timeZone: Asia/Jakarta`.

**Catatan penting:** untuk field tanggal murni (`YYYY-MM-DD`), jangan mengonversi dua kali. Uji dua bentuk input (dengan dan tanpa jam) di test.

**Kriteria terima:** test unit `formatWibDate('2026-11-10')` dan `formatWibDate('2026-11-10T23:30:00Z')`; uji perangkat dengan zona waktu `America/New_York` menunjukkan tanggal yang sama.

### T-8.3 Glosarium istilah

Lokasi baru: `src/config/glossary.ts` berisi konstanta istilah kanonik (Pasien, Layanan, Terapis, Ongkir, Jadwal).
Keputusan istilah (gate produk): **Pasien** (bukan Customer/Pelanggan), **Layanan** (bukan Treatment), **Terapis** (bukan Staf/Bidan bila merujuk peran), **Ongkir**.
Terapkan bertahap per modul, mulai dari label nav (`rolePermissions.ts:21-222`) dan judul halaman.

**Kriteria terima:** pada modul yang dimigrasikan, hitungan istilah non-kanonik = 0; nav 27 modul memakai bahasa Indonesia konsisten (nama produk teknis tetap: WAHA, CAPI, CTA).

### T-8.4 Hierarki KPI dan tabel 1240px

- `Overview.tsx:193-231`: satu kartu dipilih sebagai fokus (mis. "Reservasi Hari Ini") memakai ukuran angka lebih besar (`text-3xl`), tiga lainnya `text-2xl` dengan label lebih kecil. Alasan ditulis di komentar satu baris.
- `CohortRetentionTable.tsx:271`: `min-w-[1240px]` diganti `min-w-0` + kolom pertama `sticky left-0 bg-surface` atau ubah ke kartu per kohort di bawah `md`.

**Gerbang Fase 8:** snapshot test format hijau; uji zona waktu; istilah modul pertama bersih; `npm run build` 0.
**Rollback:** per modul; fungsi lama tetap ada sampai pemanggil terakhir dipindah (pola seam kanonis).

---

## FASE 9: P9 Metadata publik, penghapusan showcase, dan gerbang CI

**Menutup:** 5 (StitchShowcase), 6 (design.md + gerbang), X-03 (metadata), X-08 (publik), 16 (brand), X-01 (katalog), X-07 (izin).
**Prasyarat:** Fase 1, 5, 6, dan **keputusan pemilik produk** untuk dua hal di T-9.1 dan T-9.2.
**Blast radius:** halaman publik (dilihat pelanggan) dan pipeline deploy.

### T-9.1 Gate keputusan: distribusi `layanan.html`

Fakta: `layanan.html` tidak dirutekan bot. Pilih satu:
- **Opsi A (dirutekan seperti pricelist):** tambahkan rute `/layanan` di `src/routes/landing.route.ts` yang menyuntik `<script id="layanan-data" type="application/json">` dari DB ke `</head>` (meniru `pricelist.route.ts:56-97`), lalu hapus `const CLINIC_SERVICES = [...]` dari template generator dan ganti dengan pembacaan `window.__LAYANAN_DATA__`. Ikuti pola nonce (`replace(/<script>/g, ...)`) yang sudah ada.
- **Opsi B (tetap statis + gerbang regenerasi):** tambahkan `npm run build:landing` yang menjalankan `node scripts/build_landing.js`, jalankan di CI sebagai pemeriksaan "artefak harus sama dengan hasil generate", dan wajibkan memperbarui `services_custom.json` dari DB sebelum generate.

**Keputusan ini wajib diambil manusia sebelum tugas berikutnya dijalankan.**

### T-9.2 Hapus duplikasi tarif ongkir dari generator

Lokasi: `scripts/build_landing.js:1268-1292` (fungsi tarif manual).
- Ganti dengan pembacaan data tier dari payload yang sama dengan katalog (Opsi A) atau dari `services_custom.json` + `delivery_tiers` yang diekspor (Opsi B).
- Jangan mengedit `src/landing/public/layanan.html` langsung.

**Kriteria terima:** ubah satu tier di dashboard, regenerasi (atau muat ulang rute), angka di halaman ikut berubah. Tidak ada `if (km <= 5)` di generator.

### T-9.3 Metadata berbagi di 3 halaman publik

Tambahkan di template masing-masing (`go.html` langsung; `layanan.html` lewat `scripts/build_landing.js`; `pricelist.html` lewat `scripts/build_pricelist.js`):
```html
<link rel="canonical" href="__CANONICAL_URL__" />
<meta property="og:type" content="website" />
<meta property="og:title" content="__OG_TITLE__" />
<meta property="og:description" content="__OG_DESCRIPTION__" />
<meta property="og:image" content="__OG_IMAGE__" />
<meta property="og:url" content="__CANONICAL_URL__" />
<meta name="twitter:card" content="summary_large_image" />
```
`pricelist.html` sudah punya penyuntikan runtime; tambahkan placeholder yang sama ke jalur penyuntikan di `landing.route.ts`.
Untuk `layanan.html`, placeholder baru harus ikut diproses generator (Opsi B) atau rute (Opsi A).

Tambahkan JSON-LD di `pricelist.html` (sudah punya penyuntikan) dan template lain:
```html
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"MedicalClinic","name":"__CLINIC_NAME__","areaServed":["Surabaya","Sidoarjo"],"openingHours":"Mo-Su 08:00-17:00","url":"__CANONICAL_URL__"}
</script>
```

**Kriteria terima:** pratinjau tautan di WhatsApp menampilkan judul dan gambar; Rich Results Test menerima JSON-LD.

### T-9.4 Aksesibilitas halaman publik dan tautan mati

- `go.html`: isi `href` CTA dengan tautan `wa.me` sejak HTML (bukan `#`), beri `alt` pada gambar.
- `layanan.html` (lewat generator): 5 input diberi `label[for]`/`id`, 43 tombol ikon diberi `aria-label`.
- `pricelist.html`: 3 `<a href="#">` diganti tombol nyata atau dihapus; gambar diberi `width`/`height`.
- Tambahkan reduced motion bila belum (lihat T-7.7).

**Kriteria terima:** Lighthouse aksesibilitas ≥0,95 di ketiga halaman; dengan JavaScript dimatikan, CTA `go.html` tetap membuka WhatsApp.

### T-9.5 Hapus `StitchShowcase`

Lokasi: `src/pages/StitchShowcase.tsx` (795 baris) dan `src/App.tsx:47, 114-117`.
- Hapus 4 rute (`/stitch-preview`, `/admin/stitch-preview`, `/stitch`, `/admin/stitch`) dan import lazy.
- Hapus file halaman.
- Hapus pengecualian di `scripts/check-dark-parity.mjs` (`EXCLUDED_FILES`).
- Catat keputusan pembalikan D-5 di `docs/KNOWN_ISSUES.md` (sudah ada entri #323, tambahkan catatan).

**Kriteria terima:** keempat URL mengembalikan halaman 404 yang ada (`*` route), `check:dark-parity` tidak lagi mengecualikan file.

### T-9.6 Brand dari konfigurasi, bukan build

- `public/manifest.json`: `name`/`short_name` netral (`"Admin Dashboard"`), `description` netral, `background_color` disamakan dengan kanvas (`#f0f2f5` terang), `theme_color` mengikuti token accent.
- `src/config/brand.ts`: pertahankan `VITE_CLINIC_NAME` sebagai override, tetapi fallback netral (`'Klinik'`) dan tambahkan catatan bahwa nama tenant idealnya dari API.
- `index.html`: judul netral (sudah di T-2.1).

**Kriteria terima:** `grep -rn "Kala" packages/admin-dashboard/public packages/admin-dashboard/index.html` = 0.

### T-9.7 Izin level aksi (butuh matriks backend)

Langkah:
1. Inventaris read-only: daftar aksi mutasi per rute admin dan role yang diizinkan backend.
2. Buat `src/config/actionPermissions.ts` berisi `canDo(role, action)` berdasarkan hasil langkah 1 (bukan tebakan).
3. Terapkan pada 10 aksi paling berisiko (hapus reservasi, tandai lunas, hapus pelanggan, publish landing, reset sesi WhatsApp, kirim follow-up, hapus layanan, ubah harga, hapus template, hapus staf): sembunyikan tombol bila tidak berhak, atau nonaktifkan dengan tooltip alasan.
4. Hapus prop `allowedRoles` yang tidak terpakai, atau pakai di minimal satu rute.

**Kriteria terima:** login sebagai `advertiser` dan `admin_cs`, tidak ada aksi yang berakhir 403 tanpa penjelasan.

### T-9.8 Perbarui `design.md`

Ganti isi dengan: nama token (bukan hex), 3 dials (ENERGY/RHYTHM/MOTION) minimal untuk dashboard (1/1/1) dan halaman publik (2/2/1), alasan tipografi, aturan satu fokus per layar, dan larangan hex mentah. Hapus klaim "WCAG compliant" yang belum diuji, ganti dengan "dijaga oleh `check:contrast`".

### T-9.9 Aktifkan gerbang di CI (paling akhir)

Lokasi: `.github/workflows/ci.yml`, setelah langkah `Build Admin Dashboard` (sekitar baris 48-50).
```yaml
      - name: Design & A11y Gates
        run: |
          cd packages/admin-dashboard
          npm run check:design
```
Prasyarat mutlak: `check:design` hijau **dua kali berturut-turut** sebelum langkah ini ditambahkan.

**Gerbang Fase 9:** semua kriteria di atas; `check:design` hijau; CI hijau; pratinjau tautan publik benar.
**Rollback:** hapus langkah CI; kembalikan rute showcase; kembalikan manifest.

---

## FASE 10: Verifikasi menyeluruh dan penutupan

### T-10.1 Jalankan seluruh gerbang

```
cd packages/admin-dashboard && npm run build && npm run check:design
cd ../.. && npm run typecheck && npm test
```
**Kriteria terima:** build 0, `check:design` 0, typecheck 0, suite test tanpa kegagalan baru (bandingkan dengan baseline `docs/audit/2026-11-09/after-s5-final.json`).

### T-10.2 Klik-tembus terpandu (wajib dicatat)

Daftar minimal yang harus dicatat per elemen:
1. Login (label, error, tampil password, Enter).
2. Overview (4 KPI, error state saat offline).
3. Reservasi: buat, edit, batal, konflik jadwal, modal Escape.
4. Live Chat: pilih thread, kirim pesan, gagal kirim, tandai dibaca.
5. Today Treatments: selesaikan kunjungan, tandai lunas, foto rumah.
6. Settings: ganti tab dengan perubahan, simpan, muat ulang.
7. Pelanggan: cari, filter, buka detail, hapus.
8. Tema: terang dan gelap di 5 halaman.
9. 360px: 5 halaman tersibuk.
10. Tiga halaman publik: CTA WhatsApp, pratinjau tautan.

### T-10.3 Perbarui dokumen repo

- `docs/KNOWN_ISSUES.md` #323: tandai item yang selesai dengan bukti.
- `docs/FEATURE_INVENTORY.md`: perbarui bila rute dihapus (showcase) atau ditambah (`/layanan`).
- `anti-slop/`: tulis laporan penutup `audit-005` berisi hasil sebelum/sesudah.

---

## 11. Matriks Traceability (41 temuan → fase)

| Fase | Temuan yang ditutup |
| :--- | :--- |
| 0 | prasyarat (tanpa temuan) |
| 1 | 1, X-09 |
| 2 | 7, 8, V-01, V-10 (nav), V-11, V-12 |
| 3 | 3, 4, V-07, X-06 |
| 4 | 13, V-04, X-04, X-05 |
| 5 | 2, V-02, V-03 |
| 6 | 11, 14, X-02 |
| 7 | 9, 10, 15, V-05, V-08, X-10, X-11 |
| 8 | 12, 17, V-06, V-09, V-10 (sisa) |
| 9 | 5, 6, 16, X-01, X-03, X-07, X-08 |
| 10 | verifikasi seluruh temuan |

Semua 41 ID tercakup. Tidak ada temuan tanpa fase.

---

## 12. Estimasi dan Ketergantungan Ringkas

| Fase | Beban | Bisa paralel dengan | Tidak boleh bersama |
| :--- | :--- | :--- | :--- |
| 0 | 0,5 hari | apa saja | tidak ada |
| 1 | 2 hari | 2 | 3 |
| 2 | 1,5 hari | 1 | tidak ada |
| 3 | 2,5 hari | 4 (setelah T-4.1) | 7 (z-index/scroll) |
| 4 | 2 hari | 5 (setelah T-5.1) | 6 |
| 5 | 3 hari | 4 | 6 |
| 6 | 1,5 hari | — | 5, 7 |
| 7 | 2 hari | — | 3, 6 |
| 8 | 2,5 hari | — | 6 |
| 9 | 3 hari (termasuk keputusan produk) | — | 1, 5, 6 |
| 10 | 1,5 hari | — | apa saja |

Total perkiraan 20-22 hari kerja satu orang, atau 9-11 hari kalender bila Fase 1+2, 3+4, dan 7+8 dijalankan berpasangan oleh dua orang.

---

## 13. Kriteria Selesai Keseluruhan (Definition of Done)

1. `npm run build`, `npm run check:design`, `npm run typecheck` hijau.
2. `check:contrast` 0 kegagalan di kedua tema.
3. `check:a11y` 0 pelanggaran baru, baseline turun ke angka yang disepakati.
4. Setiap rute punya tepat satu `h1` dan tiga state yang menyebut sebab serta aksi.
5. Tidak ada modal buatan sendiri di luar `ui/Modal.tsx` dan `MediaImage`.
6. Setiap label terhubung ke input; setiap tombol ikon punya nama; setiap dialog tertutup dengan Escape.
7. Tidak ada em dash di teks UI, emoji dekoratif 0 di judul dan toast.
8. Tanggal, uang, dan istilah memakai satu sumber kanonik.
9. Halaman publik memakai satu tipografi, punya metadata berbagi, dan tidak memuat katalog hardcoded.
10. `docs/KNOWN_ISSUES.md` #323 mencatat status akhir per temuan dengan bukti.

---

## 14. Keputusan yang Harus Diambil Manusia Sebelum Eksekusi

1. **`layanan.html`:** Opsi A (dirutekan seperti pricelist) atau Opsi B (tetap statis + gerbang regenerasi)?
2. **Tipografi:** Opsi A (stack sistem, tanpa unduh) atau Opsi B (satu font dimuat lokal)?
3. **Glosarium:** setuju Pasien, Layanan, Terapis, Ongkir?
4. **Izin aksi:** ada matriks izin backend yang bisa dijadikan acuan, atau perlu diinventaris dulu?
5. **Showcase:** `StitchShowcase` dihapus permanen atau dipindah ke environment pengembangan?

Tanpa lima jawaban ini, Fase 6, 8, dan 9 tidak boleh dimulai. Fase 0-5, 7, dan 10 sudah bisa dijalankan karena tidak bergantung pada keputusan tersebut.

---

## 15. Batasan Plan

- Nomor baris berlaku per 2026-11-10 dan bisa bergeser; setiap tugas menyertakan string jangkar.
- Semua kriteria terima berisi perintah yang bisa diulang. Yang tidak bisa diotomatiskan (klik-tembus, uji pembaca layar) ditandai wajib dicatat manual, bukan diklaim.
- Tidak ada dependency baru. Tiga skrip Fase 0 memakai Node saja.
- Plan ini belum dieksekusi. Menunggu persetujuan tertulis per fase.
