# Panduan Operasional & Maintenance Fitur WAHA Label (WhatsApp Business Sync)

Dokumen ini berfungsi sebagai panduan teknis dan operasional untuk fitur manajemen **Label WhatsApp (WAHA Label Sync)** di sistem WhatsApp Clinic Bot.

---

## 1. Arsitektur & Mekanisme Kerja

Sistem menggunakan **WAHA HTTP API** (engine `NOWEB` / Baileys) untuk mengelola label WhatsApp Business secara otomatis saat percakapan berpindah status (misalnya saat eskalasi ke CS/Human Handling).

### Alur Kerja Penambahan Label (`addLabel`)
1. **Resolusi JID**: Chat ID dikonversi ke JID primer (`<phone>@c.us` atau `<groupId>@g.us`). Label TIDAK boleh dikirim ke JID `@lid` karena WhatsApp Mobile tidak dapat menampilkan label pada `@lid`.
2. **Locking & Mutex**: Eksekusi diproteksi dengan `withLabelLock` & `runSerialized` untuk mencegah *race condition* jika ada request penambahan/penghapusan label yang berjalan bersamaan.
3. **Pencarian ID Label**:
   - Bot memanggil `GET /api/{session}/labels` untuk mendapatkan daftar label yang terdaftar di sesi WAHA.
   - Pencarian dilakukan berjenjang:
     1. Exact match (`l.name === labelName`)
     2. Label bawaan HP (`l.color !== 1` dengan nama case-insensitive)
     3. Fallback case-insensitive match (`l.name.toLowerCase() === labelName.toLowerCase()`)
   - Jika label belum ada sama sekali di sesi, bot memanggil `POST /api/{session}/labels` untuk membuatnya.
4. **Pemeriksaan State Berjalan**: Bot mengambil daftar label chat saat ini (`GET /api/{session}/labels/chats/{chatId}`). Jika label target sudah terpasang (`alreadyHas`), request `PUT` dilewati untuk menghemat Resource & API Call.
5. **Update State (`PUT`)**: Bot mengirimkan array ID label baru ke `PUT /api/{session}/labels/chats/{chatId}`.
6. **Cooldown Delay (`WAHA_LABEL_COOLDOWN_MS`)**: Setelah request `PUT` berhasil, sistem memberikan jeda (default `2000ms`) sebelum memperbolehkan operasi perpesanan berikutnya (`sendText`, `startTyping`). Ini mencegah Baileys WebSocket terputus (*session disconnect*).

---

## 2. Penyebab Terjadinya Mismatch / Label Tidak Muncul di HP

| Masalah | Penyebab Utama | Solusi / Penanganan |
| :--- | :--- | :--- |
| **Label muncul sukses di log, tapi tidak di HP** | Terdapat **duplicate label** di WAHA (contoh: ID `1` bernama `"hold"` buatan API vs ID `4` bernama `"Hold"` buatan HP). WAHA memilih ID `1` yang tidak dikenal oleh app HP. | Hapus label duplikat di WAHA via API/WhatsApp Web. Pastikan hanya ada 1 label "Hold" utama yang terdaftar. |
| **WAHA Disconnect setelah pasang label** | Melakukan `sendText` atau `startTyping` terlalu cepat (tanpa cooldown) tepat setelah `PUT /labels/chats/{chatId}`. | Pastikan `WAHA_LABEL_COOLDOWN_MS=2000` tetap aktif di `.env`. |
| **Label tidak menempel pada pengguna nomor baru** | Chat ID yang dikirim berupa `@lid` dan resolusi ke nomor HP gagal. | Fungsi `resolvePrimaryJid` otomatis mengubah `@lid` menjadi `<phone>@c.us`. |

---

## 3. Panduan Pemeliharaan & Troubleshooting (Maintenance Checklist)

Jika terjadi kendala label tidak muncul di HP saat operasional:

### Langkah 1: Cek Daftar Label di Session WAHA
Jalankan command PowerShell / Terminal untuk melihat ID label aktif:
```bash
# PowerShell
$headers = @{"X-Api-Key"="my_waha_api_key_secret"}; Invoke-RestMethod -Uri "http://localhost:3001/api/default/labels" -Headers $headers | ConvertTo-Json -Depth 10
```

### Langkah 2: Bersihkan Label Duplikat jika Ada
Jika ditemukan lebih dari satu label dengan nama sama (contoh `"hold"` dan `"Hold"`):
Hapus ID label duplikat buatan API (yang tidak dipakai HP) dengan request `DELETE`:
```bash
# Hapus label ID 1 yang duplikat
$headers = @{"X-Api-Key"="my_waha_api_key_secret"}; Invoke-RestMethod -Uri "http://localhost:3001/api/default/labels/1" -Method Delete -Headers $headers
```

### Langkah 3: Verifikasi Label pada Chat Spesifik
Periksa label apa yang terpasang di nomor pelanggan tertentu:
```bash
$headers = @{"X-Api-Key"="my_waha_api_key_secret"}; Invoke-RestMethod -Uri "http://localhost:3001/api/default/labels/chats/628123456789@c.us" -Headers $headers
```

---

## 4. Konfigurasi Lingkungan (`.env`)

- `ENABLE_WAHA_HOLD_LABEL=true` : Mengaktifkan/mematikan fitur pemberian label "hold" otomatis saat eskalasi.
- `WAHA_LABEL_COOLDOWN_MS=2000` : Waktu tunggu aman (milidetik) setelah operasi `PUT` label sebelum eksekusi lain.

---

## 5. Ringkasan File Terkait (Code Reference)

- [src/integrations/waha/client.ts](file:///c:/Users/Ivan/.gemini/antigravity/scratch/wa-clinic-bot/src/integrations/waha/client.ts) : Implementasi `addLabel`, `removeLabel`, `markUnread`, `resolvePrimaryJid`, `withLabelLock`.
- [src/services/conversation.service.ts](file:///c:/Users/Ivan/.gemini/antigravity/scratch/wa-clinic-bot/src/services/conversation.service.ts) : Pemanggilan non-blocking `wahaClient.addLabel(..., 'hold')` & `wahaClient.markUnread(...)` pada eskalasi `HUMAN_HANDLING`.
- [src/services/waha-monitor.service.ts](file:///c:/Users/Ivan/.gemini/antigravity/scratch/wa-clinic-bot/src/services/waha-monitor.service.ts) : Resilient failure threshold (`WAHA_DISCONNECT_THRESHOLD`) untuk mencegah false alarm queue pause saat label sync.
