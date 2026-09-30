# Implementation Plan — Auto-Trigger Telemetry & Dispatch Saat Bidan Klik Navigasi

> **Status:** PROPOSED (Menunggu eksekusi oleh pengguna)  
> **Tanggal:** 2026-09-30  
> **Author:** Antigravity AI & Ivan Noor  
> **Terkait:** `docs/plans/DISPATCH_MAP_PULSE_ROUTE_PLAN.md`, `KNOWN_ISSUES.md` #162 (Realtime Location Tracking Terapis)

---

## §0. Konteks Masalah & Fakta Terverifikasi

### 0.1. Permasalahan Nyata di Lapangan
1. **Kebiasaan Alami Bidan**: Saat hendak menuju ke lokasi pasien, Bidan hampir selalu menekan tombol **"Navigasi"** (Google Maps) di HP mereka untuk melihat rute jalan, tetapi sering lupa menekan tombol **"Kirim Info OTW"** yang terpisah.
2. **Kelemahan Kode Saat Ini**:
   - Di [`packages/admin-dashboard/src/pages/staff/StaffToday.tsx:2952-2963`](file:///c:/Users/User/Documents/chatbot%20AG/packages/admin-dashboard/src/pages/staff/StaffToday.tsx#L2952-L2963), tombol **"Navigasi"** hanyalah tautan murni `<a href={...} target="_blank">` tanpa handler aksi `onClick`.
   - Menekan tombol Navigasi membuka Google Maps di tab/aplikasi baru. Ketika layar berpindah ke Google Maps, browser web `StaffToday` masuk ke *background* dan dibekukan (*freeze / suspended*) oleh OS Android/iOS sebelum sempat memancarkan sinyal GPS.
   - Kolom `reservation.otw_sent_at` tetap `NULL` dan objek `trip` di server tetap `NULL`.
3. **Dampak pada Layar CS (Live Chat Monitor)**:
   - Di [`packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx:5721`](file:///c:/Users/User/Documents/chatbot%20AG/packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx#L5721), widget radar pemantauan memiliki syarat gerbang:
     ```tsx
     {dispatchTrip && (dispatchTrip.otwSentAt || dispatchTrip.trip) && !dispatchTrip.arrivedAt && (
     ```
   - Karena Bidan menekan tombol Navigasi (bukan OTW), `otwSentAt` dan `trip` keduanya `null`. Seluruh sidebar kanan **hilang tanpa jejak**, meninggalkan ruang kosong di layar monitor CS dan membuat CS mengira fitur pelacakan rusak atau hilang.

### 0.2. Fakta Terverifikasi Kode (`file:line`)
| Komponen | Lokasi File & Baris | Perilaku Saat Ini |
|---|---|---|
| Tombol Navigasi Kartu Tugas | `StaffToday.tsx:2952-2964` | `<a href=... target="_blank">` murni tanpa telemetry |
| Ikon Navigasi Chat Header | `StaffToday.tsx:3134-3144` | `<a href=... target="_blank">` murni tanpa telemetry |
| Tombol Navigasi Modal Detail | `StaffToday.tsx:4693-4703` | `<a href=... target="_blank">` murni tanpa telemetry |
| Pemancar Telemetry | `useTripTelemetry.ts:139-199` | Fungsi `startTelemetry(reservationId)` siap pakai |
| Gerbang Sidebar CS | `LiveChatMonitor.tsx:5721` | Disembunyikan total jika `!otwSentAt && !trip` |
| Fallback Standby CS | `LiveChatDispatchWidget.tsx:77-80` | Belum memiliki mode `standby` jika jadwal hari ini ada tapi belum OTW |

---

## §1. Solusi Fondasional & Arsitektur

1. **Natural Affordance Wiring**:
   Mengubah tombol "Navigasi" menjadi pemicu ganda:
   - **Kunci GPS Seketika (Zero Delay Transition)**: Sebelum URL Google Maps dibuka, lakukan tangkapan GPS instan dan kirim *first ping* ke `/api/staff/telemetry`.
   - **Nyalakan Pemancar Telemetry**: Aktifkan `startTelemetry(task.reservationId)` dan *Screen Wake Lock*.
   - **Auto-Sync Status OTW**: Jika pesan OTW WhatsApp belum pernah dikirim untuk jadwal tersebut, kirimkan notifikasi OTW di latar belakang dan perbarui state `otwSentAt`.
   - **Buka Peta Google Maps**: Buka Google Maps (`window.open(url, '_blank')`) secara mulus.
2. **UX Hardening di CS Live Chat (State Standby yang Jujur)**:
   - Jika customer memiliki jadwal aktif hari ini (`activeConfirmedReservation`), sidebar kanan **TIDAK BOLEH HILANG**.
   - Tampilkan kartu standby di widget:
     - Status: *"Bidan [Nama] Belum Memulai Perjalanan"*
     - Info jadwal: *"Jadwal: [Jam WIB] — Menunggu Bidan klik OTW / Navigasi"*
     - Tombol cepat: *"Hubungi Bidan"* (via telepon langsung).

---

## §2. Rincian Staged Phases & Micro-Tasks

### 🔹 Fase 0: Baseline Check & Regression Gate
- [ ] **0.1** Pastikan build TypeScript dashboard bersih:
  ```bash
  cd packages/admin-dashboard
  npm run build
  cd ../..
  ```
- [ ] **0.2** Pastikan test dispatch eksisting lulus:
  ```bash
  npx vitest run tests/unit/dispatch-map-projection.test.ts
  ```

---

### 🔹 Fase 1: Implementasi Handler Navigasi di `StaffToday.tsx`
**File Target:** `packages/admin-dashboard/src/pages/staff/StaffToday.tsx`  
**Blast Radius:** Portal Staf Terapis (`/admin/staff/today`)

#### Micro-Task 1.1: Pembuatan Fungsi `handleStartNavigation`
Tambahkan handler terpusat di `StaffToday.tsx` (di sekitar baris 1543 setelah `handleSendOtw`):
```tsx
// Handler terpadu: Buka Navigasi Google Maps + Otomatis Nyalakan Telemetry & OTW
const handleStartNavigation = async (task: StaffTask, navUrl: string, e?: React.MouseEvent) => {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }

  // 1. Langsung nyalakan telemetry pelacakan di latar belakang (best-effort)
  try {
    startTelemetry(task.reservationId).catch(() => {});
  } catch {}

  // 2. Jika pesan OTW belum pernah dikirim, kirimkan pesan OTW otomatis di latar belakang
  if (!task.otwSentAt && isOnline) {
    const patientName = task.customerName || 'Bunda';
    const staffSignature = staff?.name || 'Bidan Terapis';
    
    // Background fire-and-forget OTW message
    (async () => {
      try {
        const res = await apiRequest(`/api/staff/reservations/${task.reservationId}/otw`, {
          method: 'POST',
          body: JSON.stringify({ customText: '' }), // Menggunakan template resmi sistem
        });
        if (res.success) {
          const nowIso = new Date().toISOString();
          const updateOtw = (t: StaffTask): StaffTask =>
            t.reservationId === task.reservationId ? { ...t, otwSentAt: nowIso } : t;
          setTasks((prev) => prev.map(updateOtw));
          setUpcomingTasks((prev) => prev.map(updateOtw));
          if (selectedTask?.reservationId === task.reservationId) {
            setSelectedTask((prev) => (prev ? updateOtw(prev) : null));
          }
        }
      } catch (err) {
        console.warn('[NAV-OTW] Background OTW send failed:', err);
      }
    })();
  }

  // 3. Buka URL Navigasi Google Maps di tab/aplikasi baru
  if (navUrl && navUrl !== '#') {
    window.open(navUrl, '_blank', 'noopener,noreferrer');
  }
};
```

#### Micro-Task 1.2: Sambungkan Handler ke Tombol Navigasi Kartu Tugas
Ubah baris 2952–2964 pada `StaffToday.tsx`:
```tsx
{task.navigationUrl || task.mapsUrl ? (
  <button
    type="button"
    onClick={(e) => handleStartNavigation(task, task.navigationUrl || task.mapsUrl || '#', e)}
    className="flex items-center justify-center space-x-1 min-h-[44px] py-2.5 px-2 sm:px-3 text-[11px] sm:text-xs font-bold text-white bg-[#008069] hover:bg-[#00a884] rounded-xl transition-all active:scale-95 shadow-xs cursor-pointer"
    title="Buka Peta Navigasi Google Maps & Mulai Perjalanan"
  >
    <Navigation size={15} />
    <span>Navigasi</span>
  </button>
) : (
  <div className="text-[10px] text-[#667781] flex items-center justify-center min-h-[44px] py-2.5 rounded-xl bg-[#f0f2f5] border border-[#e9edef]">
    Tanpa Peta
  </div>
)}
```

#### Micro-Task 1.3: Sambungkan Handler ke Ikon Navigasi di Chat Header
Ubah baris 3134–3144 pada `StaffToday.tsx`:
```tsx
{(selectedTask.navigationUrl || selectedTask.mapsUrl) && (
  <button
    type="button"
    onClick={(e) => handleStartNavigation(selectedTask, selectedTask.navigationUrl || selectedTask.mapsUrl || '#', e)}
    className="h-9 w-9 flex items-center justify-center rounded-lg bg-[#008069] hover:bg-[#00a884] text-white shadow-xs transition-all active:scale-95 cursor-pointer"
    title="Buka Peta Navigasi Google Maps & Mulai Perjalanan"
  >
    <Navigation size={16} />
  </button>
)}
```

#### Micro-Task 1.4: Sambungkan Handler ke Modal Detail Tugas
Ubah baris 4693–4703 pada `StaffToday.tsx`:
```tsx
{(detailModalTask.navigationUrl || detailModalTask.mapsUrl) && (
  <button
    type="button"
    onClick={(e) => handleStartNavigation(detailModalTask, detailModalTask.navigationUrl || detailModalTask.mapsUrl || '#', e)}
    className="flex-1 py-3 px-4 bg-[#008069] hover:bg-[#00a884] text-white rounded-2xl text-xs font-bold transition flex items-center justify-center space-x-1.5 shadow-xs cursor-pointer"
  >
    <Navigation size={14} />
    <span>Buka Peta Navigasi</span>
  </button>
)}
```

---

### 🔹 Fase 2: UX Hardening pada Sidebar CS (`LiveChatMonitor.tsx`)
**File Target:** `packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx`  
**Blast Radius:** Monitor Live Chat CS (`/admin/live-chat`)

#### Micro-Task 2.1: Longgarkan Kondisi Render Sidebar Kanan
Ubah baris 5721 pada `LiveChatMonitor.tsx`:
*Dari:*
```tsx
{dispatchTrip && (dispatchTrip.otwSentAt || dispatchTrip.trip) && !dispatchTrip.arrivedAt && (
```
*Menjadi:*
```tsx
{dispatchTrip && !dispatchTrip.arrivedAt && (
```
*Rasional:* Jika reservasi aktif hari ini ada, sidebar kanan tetap dimunculkan. Jika Bidan belum memulai perjalanan (`!otwSentAt && !trip`), komponen `LiveChatDispatchWidget` akan menampilkan kartu informasi persiapan / standby, bukan hilang lenyap meninggalkan ruang kosong.

#### Micro-Task 2.2: Tambahkan Tampilan Standby di `LiveChatDispatchWidget.tsx`
**File Target:** `packages/admin-dashboard/src/components/livechat/LiveChatDispatchWidget.tsx`  
Di dalam komponen, jika `!data?.otwSentAt && !trip`:
Tampilkan kartu status:
- Judul: 🛵 **Persiapan Menuju Lokasi Pasien**
- Subjudul: *"Bidan {staffName} belum memulai navigasi / mengirim pesan OTW."*
- Informasi jadwal reservasi.
- Tombol: **Hubungi Bidan** (telepon cepat jika sudah mendekati jam jadwal).

---

### 🔹 Fase 3: Automated Regression & Build Gate
- [ ] **3.1** Build antarmuka dashboard:
  ```bash
  cd packages/admin-dashboard
  npm run build
  cd ../..
  ```
- [ ] **3.2** Jalankan seluruh unit test suite terkait perjalanan & reservasi:
  ```bash
  npx vitest run tests/unit/dispatch-map-projection.test.ts tests/integration/staff-trip-dispatch.test.ts
  ```

---

## §3. Acceptance Criteria
1. Saat Bidan menekan tombol **"Navigasi"** di `StaffToday` (baik di kartu daftar, header chat, maupun modal detail), browser otomatis memanggil `startTelemetry()` dan mengunci sinyal GPS.
2. Jika pesan WhatsApp OTW belum pernah terkirim, sistem otomatis mengirimkan pesan notifikasi OTW resmi ke customer tanpa menghentikan pembukaan Google Maps.
3. Di layar CS Live Chat Monitor, radar pelacakan atau kartu status Bidan tetap tampil di sisi kanan layar (tidak hilang misterius menjadi area kosong).
4. Layar Google Maps tetap terbuka di tab/aplikasi baru dengan mulus untuk memandu perjalanan Bidan.
