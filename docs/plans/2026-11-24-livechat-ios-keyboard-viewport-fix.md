# Plan Perbaikan — Live Chat iOS: Kolom Ketik Naik & Area Chat Kosong Saat Mengetik

- **Tanggal:** 2026-11-24
- **Status:** **IMPLEMENTED — SMOKE TEST PENDING** (core fix terverifikasi pada iPhone fisik Safari & PWA standalone; 4 smoke test interaksi + matriks regresi Android/iPad/desktop belum dijalankan). **Deployed app-only 2026-11-24 11:37 WIB** dari commit `7c730356`; WAHA/worker/DB tidak disentuh.
- **Lingkup:** `packages/admin-dashboard` — halaman `/admin/live-chat`, mode mobile iPhone Safari/PWA.
- **Bukan lingkup:** isi chat, template treatment, jadwal, backend, WAHA, database, prompt AI.
- **Bukti awal:** rekaman `ScreenRecording_11-24-2026 10-17-06_1.mp4` + validasi kode/build 2026-11-24.

### Status verifikasi 2026-11-24

- [x] iPhone Safari: keyboard muncul → panel penuh, tanpa celah hitam, kolom ketik di atas keyboard.
- [x] iPhone PWA standalone: hasil sama.
- [ ] Smoke test `/` (Balasan Cepat) tampil tepat di atas kolom ketik.
- [ ] Smoke test kirim pesan + auto-scroll instan.
- [ ] Smoke test buka/tutup keyboard berulang tanpa pergeseran.
- [ ] Smoke test modal/drawer `fixed` menutup layar penuh.
- [ ] Regresi Android Chrome, iPad, desktop.
- [x] `npm run build` dashboard + `npm run check:reuse` (0 pelanggaran baru).
- [x] `node scripts/verify-livechat-viewport.mjs` (8/8 lulus).

---

## 1. Ringkasan masalah yang tervalidasi

Saat kolom “Tulis balasan…” difokuskan dan keyboard iOS muncul:

1. Panel chat sudah mengecil ke tinggi area di atas keyboard (`visualViewport.height`).
2. Tetapi iOS sudah telanjur menggeser **visual viewport** ke bawah (`visualViewport.offsetTop`).
3. Aplikasi tidak menggeser panel mengikuti `offsetTop`.
4. Hasilnya panel tertinggal di atas; hanya ±100 px bagian bawah panel yang terlihat, sisanya area kosong berwarna kanvas.

Pengukuran frame (tinggi rekaman 848 px):

| Kondisi | Posisi |
|---|---:|
| Sebelum keyboard — batas bawah kolom ketik | ±805 px |
| Saat keyboard — batas atas keyboard | ±470 px |
| Saat keyboard — batas bawah kolom ketik | ±115 px |
| Geseran yang tertinggal | ±355 px |

**Akar langsung:** tidak ada kompensasi `visualViewport.offsetTop`; `window.scrollTo(0,0)` tidak mereset geseran visual viewport iOS.

**Faktor pendukung:**
- `body` dan `#root` tetap `min-height: 100dvh` (`index.css:245-271`).
- `onFocus` memanggil `window.scrollTo(0,0)` + `scrollToBottom` (`LiveChatComposer.tsx:972-977`).
- `scrollToBottom` memakai `messagesEndRef.scrollIntoView(...)` (`useLiveChatActiveThread.ts:98-119`).
- Handler `visualViewport.resize` memanggil scroll lagi 200 ms kemudian (`LiveChatMonitor.tsx:611-633`).
- `interactive-widget=resizes-content` tidak dihormati Safari iOS (`index.html:8`).

Referensi perilaku platform: [MDN VisualViewport](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport) — keyboard dapat mengecilkan visual viewport tanpa mengubah layout viewport; di mobile `offsetTop` yang berubah, bukan posisi scroll window.

---

## 2. Desain perbaikan

### Prinsip

Jangan melawan pan iOS. **Ikuti** posisi visual viewport:

- `--vvh` = `visualViewport.height` (sudah ada).
- `--vvt` = `visualViewport.pageTop` (baru; posisi visual viewport terhadap dokumen,
  mencakup `offsetTop` + scroll dokumen — aman untuk kedua mekanisme geser iOS).
- Shell Live Chat yang sudah `position: relative` diberi `top: var(--vvt, 0px)`.

Dengan angka video: `pageTop = 355` (karena `scrollY = 0`), `height = 470` → shell menempati 355..825, tepat menutupi area yang terlihat. Celah hitam hilang; kolom ketik kembali menempel di atas keyboard.

**Kenapa `top`, bukan `transform`:**
- `top` pada elemen `relative` tidak membuat containing block baru untuk elemen `fixed` (modal/drawer/toast tetap aman).
- `transform` membuat containing block baru dan berisiko menggeser modal `fixed`.

**Kenapa bukan sekadar mengecilkan `body/#root`:**
- Itu tidak membatalkan geseran visual viewport yang sudah terjadi; panel tetap bisa tertinggal.
- `top: var(--vvt)` adalah kompensasi langsung terhadap geseran tersebut.

---

## 3. Fase 0 (opsional, non-blocking) — Bukti baseline di perangkat

Tujuan: memastikan nilai aktual sebelum patch.

**Cara A (disarankan):** Safari Web Inspector dari Mac/iPhone → jalankan saat bug terjadi:

```js
const vv = window.visualViewport;
console.table({
  vvHeight: vv?.height,
  vvOffsetTop: vv?.offsetTop,
  vvPageTop: vv?.pageTop,
  windowScrollY: window.scrollY,
  rootScrollHeight: document.getElementById('root')?.scrollHeight,
  shellTop: document.getElementById('root')?.firstElementChild?.getBoundingClientRect().top,
});
```

Ekspektasi sebelum fix: `vvHeight ≈ 470`, `vvOffsetTop ≈ 355`, `vvPageTop ≈ 355` (karena `scrollY = 0`), `shellTop ≈ 0` di layout, tetapi posisi layarnya ≈ `-355` (tergeser ke atas).

**Cara B:** lewati fase ini; validasi video + kode sudah cukup untuk melanjutkan. Patch tetap wajib diuji di perangkat pada Fase 3.

**Acceptance Fase 0:** angka tercatat di laporan (boleh dilampirkan screenshot). `--vvt` memakai `pageTop`, jadi sudah mencakup `scrollY` jika ternyata ada pergeseran dokumen.

---

## 4. Fase 1 — Sinkronisasi visual viewport (perbaikan utama)

**Tujuan:** panel mengikuti posisi visual viewport; tidak ada area kosong.

### 1.1 `packages/admin-dashboard/src/index.css`

**Lokasi:** blok `:root` di sekitar baris 11.

**Sebelum:**

```css
    --vvh: 100dvh;
```

**Sesudah:**

```css
    --vvh: 100dvh;
    --vvt: 0px;
```

### 1.2 `packages/admin-dashboard/src/components/common/Layout.tsx`

**Lokasi:** `useEffect` dengan komentar `// 📱 iPhone / iOS Safari Dynamic Keyboard & Visual Viewport Height Tracker` (± baris 106-124).

**Sebelum:**

```tsx
    const updateVvh = () => {
      const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      document.documentElement.style.setProperty('--vvh', `${vh}px`);
      const isKbOpen = window.visualViewport ? window.visualViewport.height < window.innerHeight - 80 : false;
      document.documentElement.setAttribute('data-keyboard-open', isKbOpen ? 'true' : 'false');
    };
```

**Sesudah:**

```tsx
    const updateVvh = () => {
      const vv = window.visualViewport;
      const vh = vv ? vv.height : window.innerHeight;
      // pageTop: posisi visual viewport relatif terhadap dokumen.
      // Mencakup offsetTop + scroll dokumen, sehingga aman untuk dua mekanisme
      // geser iOS (visual-viewport pan maupun document scroll).
      const vvt = vv ? vv.pageTop : 0;
      document.documentElement.style.setProperty('--vvh', `${vh}px`);
      document.documentElement.style.setProperty('--vvt', `${vvt}px`);
      const isKbOpen = vv ? vv.height < window.innerHeight - 80 : false;
      document.documentElement.setAttribute('data-keyboard-open', isKbOpen ? 'true' : 'false');
    };
```

### 1.3 `Layout.tsx` — terapkan `top` pada shell Live Chat

**Lokasi:** return utama, `style` + `className` root di sekitar baris 484-487.

**Sebelum:**

```tsx
    <div
      style={{ height: isLiveChat ? 'var(--vvh, 100dvh)' : undefined, maxHeight: isLiveChat ? 'var(--vvh, 100dvh)' : undefined }}
      className={`${isLiveChat ? 'h-[100dvh] max-h-[100dvh] overflow-hidden touch-pan-y' : 'min-h-screen'} bg-app text-ink flex flex-col md:flex-row relative overscroll-y-contain`}
    >
```

**Sesudah:**

```tsx
    <div
      data-livechat-shell={isLiveChat ? 'true' : undefined}
      style={{
        height: isLiveChat ? 'var(--vvh, 100dvh)' : undefined,
        maxHeight: isLiveChat ? 'var(--vvh, 100dvh)' : undefined,
        // Kompensasi pan visual viewport iOS (keyboard). Class root sudah `relative`.
        top: isLiveChat ? 'var(--vvt, 0px)' : undefined,
      }}
      className={`${isLiveChat ? 'h-[100dvh] max-h-[100dvh] overflow-hidden touch-pan-y' : 'min-h-screen'} bg-app text-ink flex flex-col md:flex-row relative overscroll-y-contain`}
    >
```

**Catatan penting:** jangan hapus class `relative`; `top` hanya bekerja pada elemen non-static. `data-livechat-shell` hanya penanda uji, tidak mengubah UI.

### 1.4 Build & cek cepat

```powershell
cd packages/admin-dashboard
npm run build
```

**Acceptance Fase 1 (wajib di iPhone fisik):**
- Keyboard terbuka → `#root > [data-livechat-shell]` `getBoundingClientRect().top` ≈ `visualViewport.offsetTop` (toleransi 1 px); posisi layar shell ≈ 0 (menutupi visual viewport).
- `getBoundingClientRect().bottom` ≈ `visualViewport.offsetTop + visualViewport.height` (toleransi 1 px).
- `document.elementFromPoint(innerWidth / 2, 20)` berada di dalam `[data-livechat-shell]` (bukan kanvas `#root`).
- Screenshot: tidak ada area hitam kosong antara kolom ketik dan keyboard; header/pesan terakhir terlihat.
- Keyboard ditutup → posisi kembali normal; tidak ada lompatan permanen.
- Desktop (tanpa keyboard) tidak berubah (`--vvt = 0`).

**Regression gate Fase 1:**
- `npm run build` dashboard exit 0.
- Buka `/admin/live-chat` di desktop; sidebar, header, chat, modal tetap normal.
- Buka/tutup modal dari Live Chat; `fixed` modal tetap menutup layar penuh.

**Rollback Fase 1:** revert 2 file (`Layout.tsx`, `index.css`). Tanpa DB/migrasi.

---

## 5. Fase 2 — Hentikan perebutan scroll

**Tujuan:** fokus/refocus tidak memicu geseran tambahan; scroll hanya terjadi di container pesan.

### 2.1 `packages/admin-dashboard/src/components/livechat/LiveChatComposer.tsx`

**Lokasi:** `contentEditable` `onFocus` (± baris 972-977).

**Sebelum:**

```tsx
          onFocus={() => {
            if (typeof window !== 'undefined') {
              window.scrollTo(0, 0);
              onRequestScrollToBottom?.();
            }
          }}
```

**Sesudah:**

```tsx
          onFocus={() => {
            // Jangan panggil window.scrollTo: tidak mereset visualViewport iOS
            // dan dapat memicu lompatan saat keyboard beranimasi.
            // Cukup minta daftar pesan scroll ke bawah (container-only).
            onRequestScrollToBottom?.();
          }}
```

### 2.2 `packages/admin-dashboard/src/components/livechat/LiveChatMessagePane.tsx`

**Lokasi:** pemanggilan `LiveChatComposer` (± baris 1456).

**Sebelum:**

```tsx
                        onRequestScrollToBottom={() => scrollToBottom(true, false)}
```

**Sesudah:**

```tsx
                        onRequestScrollToBottom={() => scrollToBottom(false, false)}
```

Alasan: saat keyboard beranimasi, smooth scroll di container bisa terlihat seperti lompatan; instant lebih stabil.

### 2.3 `packages/admin-dashboard/src/hooks/useLiveChatActiveThread.ts`

**Lokasi:** `scrollToBottom` (± baris 98-119).

**Sebelum:**

```ts
  const scrollToBottom = useCallback((smooth = false, force = false) => {
    const el = chatContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const isNearBottom = distanceFromBottom < 300;
    if (!isNearBottom && !force) return;
    wasNearBottomRef.current = true;
    const doScroll = () => {
      if (chatContainerRef.current) {
        chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight + 99999;
      }
      if ((isNearBottom || force) && messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'end' });
      }
    };
    doScroll();
    requestAnimationFrame(doScroll);
    if (force) {
      setTimeout(doScroll, 60);
      setTimeout(doScroll, 150);
    }
  }, [chatContainerRef, messagesEndRef]);
```

**Sesudah:**

```ts
  const scrollToBottom = useCallback((_smooth = false, force = false) => {
    const el = chatContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const isNearBottom = distanceFromBottom < 300;
    if (!isNearBottom && !force) return;
    wasNearBottomRef.current = true;
    const doScroll = () => {
      const container = chatContainerRef.current;
      if (!container) return;
      // Container-only: jangan scrollIntoView, karena dapat menggeser
      // window / visual viewport iOS saat keyboard terbuka.
      container.scrollTop = container.scrollHeight;
    };
    doScroll();
    requestAnimationFrame(doScroll);
    if (force) {
      setTimeout(doScroll, 60);
      setTimeout(doScroll, 150);
    }
  }, [chatContainerRef]);
```

**Catatan:** `_smooth` sengaja tidak dipakai agar signature tetap kompatibel dengan pemanggil; awalan `_` menghindari lint unused parameter.

### 2.4 `packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx`

**Lokasi:** handler `visualViewport.resize` (± baris 611-633).

**Sebelum:**

```ts
      throttleTimer = setTimeout(() => {
        throttleTimer = null;
        scrollToBottom(true, false);
      }, 200);
```

**Sesudah:**

```ts
      throttleTimer = setTimeout(() => {
        throttleTimer = null;
        scrollToBottom(false, false);
      }, 200);
```

### 2.5 Build & cek

```powershell
cd packages/admin-dashboard
npm run build
```

**Acceptance Fase 2 (iPhone fisik):**
- Tap kolom ketik 10× berturut-turut → tidak ada lompatan; kolom ketik tetap di atas keyboard.
- `window.scrollY` tetap 0.
- Daftar pesan tetap di posisi paling bawah saat fokus.
- Ketik `/` → panel Balasan Cepat muncul tepat di atas kolom ketik, tidak terpotong.
- Pilih template → teks masuk; kirim → pesan muncul dan daftar scroll ke bawah.
- Tutup/buka keyboard berulang → header dan pesan terakhir tetap wajar.
- Buka chat lain → list/chat transition normal.
- Cari chat di daftar → keyboard pada kolom search juga tidak membuat area kosong.

**Regression gate Fase 2:**
- `npm run build` dashboard exit 0.
- Kirim pesan baru → auto-scroll tetap bekerja.
- Quote/jump-to-message tetap bekerja (memakai `scrollIntoView` terpisah; tidak diubah).
- Pull-to-refresh daftar chat tetap bekerja.

**Rollback Fase 2:** revert 4 file. Tanpa DB/migrasi.

---

## 6. Fase 3 — Verifikasi, dokumentasi, deploy

### 3.1 Uji perangkat (wajib, tidak bisa digantikan build)

Matriks minimum:

| Perangkat | Mode | Skenario |
|---|---|---|
| iPhone (notch/Dynamic Island) | Safari tab | Buka Fio → tap composer → ketik → `/` → pilih template → kirim → tutup keyboard |
| iPhone | PWA standalone (Add to Home Screen) | Sama + buka/tutup 10× + rotate portrait/landscape |
| Android Chrome | Tab/PWA | Regresi `interactive-widget=resizes-content` |
| Desktop Chrome/Edge | — | Sidebar, modal, chat, composer normal |
| iPad | Safari | Layout `lg` + keyboard |

**Acceptance:** screenshot/video before-after; tidak ada celah hitam; kolom ketik menempel keyboard; tidak ada lompatan; tidak ada regresi modal/sidebar.

### 3.2 Automated gates

```powershell
# dashboard
cd packages/admin-dashboard
npm run build

# root
cd ../..
npm run build
npm run typecheck
npm run check:reuse
node scripts/verify-livechat-revision.mjs
npm test
```

Catatan:
- Root `tsc --noEmit` pernah OOM (pre-existing, `docs/KNOWN_ISSUES.md` #249). Jika OOM lagi, buktikan pre-existing dengan revert-and-rerun; jangan klaim regresi.
- Full suite offline (mock DB); kegagalan yang diklaim pre-existing wajib dibuktikan revert-and-rerun.
- Tidak ada dependency baru.

### 3.3 Tambah regression guard statis (opsional tetapi disarankan)

Perluas `scripts/verify-livechat-revision.mjs` dengan 3 check:

```js
check('livechat shell memakai --vvt', layout.includes("top: isLiveChat ? 'var(--vvt, 0px)'"), 'Layout.tsx top shell');
check('Layout menyimpan pageTop ke --vvt', layout.includes("setProperty('--vvt'"), 'Layout.tsx pageTop');
check('composer tidak window.scrollTo', !composer.includes('window.scrollTo(0, 0)'), 'LiveChatComposer.tsx');
```

Ini bukan pengganti uji perangkat; hanya penjaga agar kontrak tidak hilang saat refactor.

### 3.4 Dokumentasi wajib

1. `docs/KNOWN_ISSUES.md`
   - Tambah entri baru (nomor berikutnya, mis. **362**) dengan:
     - gejala, bukti video/measurement, akar `offsetTop` tidak dikompensasi;
     - status **FIXED — PENDING PHYSICAL iOS TEST** setelah patch;
     - tautan ke #249/#316 (uji fisik iOS yang masih terbuka).
2. `CHANGELOG.md`
   - Tambah `#### 2026-11-24 - Fix: Live Chat iOS — Kompensasi Visual Viewport Saat Mengetik` di atas entri terbaru.
   - Isi: akar masalah, file yang diubah, acceptance, status uji perangkat.
3. `docs/changelog/INDEX.md`
   - Jalankan:

   ```powershell
   node scripts/make-changelog-index.mjs --write
   ```

4. `docs/FEATURE_INVENTORY.md`
   - Tambah satu baris di bagian Live Chat: “Sinkronisasi Visual Viewport Mobile” dengan file `Layout.tsx`, `LiveChatComposer.tsx`, `useLiveChatActiveThread.ts`, `LiveChatMonitor.tsx`.
5. `docs/MODULE_INDEX.md` — tidak perlu modul baru; tidak ada modul kanonis baru.

### 3.5 Deploy (frontend-only, 1-step)

- Rebuild `dist` dashboard (hasil `npm run build`).
- Deploy standar (contoh sesuai runbook repo): `docker compose build app && docker compose up -d --no-deps app`.
- **Tidak menyentuh WAHA/DB** → tidak perlu 2-step Meta gate.
- PWA: setelah deploy, tutup/reopen PWA atau tunggu SW update. `CACHE_NAME` di `packages/admin-dashboard/public/sw.js` sudah dinaikkan ke `admin-dashboard-v16` (termasuk follow-up composer compact).
- Verifikasi di server: hash asset berubah; halaman memuat bundle baru.

### 3.6 Setelah deploy

- Ulangi uji iPhone pada build produksi.
- Jika lolos: ubah status KNOWN_ISSUES menjadi **RESOLVED** dan tutup sisa uji #249/#316 untuk keyboard.
- Jika gagal: rollback cepat (revert commit); tidak ada migrasi/DB.

---

## 7. FMEA perbaikan

| Langkah | S | O | D | RPN | Catatan |
|---|---:|---:|---:|---:|---|
| Fase 1 `top: --vvt` | 4 | 3 | 4 | 48 | Risiko fixed modal/status bar; uji |
| Fase 2 container-only scroll | 3 | 3 | 3 | 27 | Auto-scroll bisa kurang; uji kirim pesan |
| Hapus `window.scrollTo` fokus | 2 | 2 | 2 | 8 | Perilaku kecil |
| Bump SW cache | 3 | 5 | 3 | 45 | Tanpa bump, user bisa lihat bundle lama |
| Uji perangkat terlewat | 8 | 6 | 7 | 336 | Mitigasi: gate wajib sebelum deploy |

---

## 8. Urutan eksekusi & gerbang persetujuan

1. **Fase 1** → build → uji iPhone (panel mengikuti offsetTop).
2. **Fase 2** → build → uji iPhone (tidak ada lompatan saat fokus/refocus).
3. **Fase 3** → automated gates → dokumentasi → deploy → uji produksi.

Plan ini **belum dieksekusi**. Diperlukan persetujuan eksplisit user (`Setuju`, `Lanjut`, atau `Eksekusi`) sebelum mengubah file source.
