# 🚀 Panduan Update Live Server (Deployment Runbook)

Dokumen rujukan cara update aplikasi **WA Clinic Bot** ke server live tanpa membuat
WhatsApp (WAHA) terputus.

---

## 🔑 Akses Server

| Item        | Nilai                                   |
| ----------- | --------------------------------------- |
| **IP / Host** | `43.157.197.148`                        |
| **SSH User**  | `ubuntu`                                |
| **SSH Port**  | `1403` (bukan 22; 22 dibatasi firewall) |
| **Password**  | `mountain-48@-dragon`                   |
| **App Path**  | `/opt/wa-clinic-bot`                    |
| **Docker Compose** | `/opt/wa-clinic-bot/docker-compose.yml` |
| **Session WAHA** | `default` (volume `waha_sessions`)   |

> ⚠️ **PERINGATAN KEAMANAN**
>
> Password di atas tercantum agar Anda bisa langsung mengakses server. **SEGERA**
> setelah bisa, ganti dengan SSH key pair (jauh lebih aman):
> 1. Jalankan `ssh-keygen` di PC Anda.
> 2. Upload key: `ssh-copy-id ubuntu@43.157.197.148`
>    (atau `cat ~/.ssh/id_ed25519.pub | ssh -p 1403 ubuntu@43.157.197.148 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"`).
> 3. Matikan login password di `/etc/ssh/sshd_config` → `PasswordAuthentication no`.
> 4. Jangan pernah commit file ini ke repository publik / bagikan ke siapa pun.

---

## ✅ Prinsip Utama (Supaya WAHA TIDAK Terputus)

- **HANYA rebuild & restart container `app`**, bukan `docker compose down/up`.
- WAHA (`wa-clinic-bot-waha-1`) menyimpan sesi di **named volume `waha_sessions`**.
  Selama container WAHA tidak di-recreate, koneksi WhatsApp tetap hidup.
- Migrasi DB **WAJIB dijalankan SEBELUM** container `app` baru naik, supaya kode
  baru tidak menabrak skema lama.

---

## 🧰 Cara Akses / Eksekusi Perintah di Server

### Opsi A — SSH langsung (PC Windows / Linux)
```bash
ssh -p 1403 ubuntu@43.157.197.148
# lalu masuk ke folder app
cd /opt/wa-clinic-bot
```

### Opsi B — SSH sekali jalan (remote command)
```bash
ssh -p 1403 ubuntu@43.157.197.148 "cd /opt/wa-clinic-bot && docker compose ps"
```

### Opsi C — Otomatisasi dari PC (misal via Node.js ssh2 / plink)
Sesuai pola yang dipakai tim saat deploy otomatis: jalankan perintah berikut
**satu per satu** agar mudah dimonitor.

---

## 🛠️ Prosedur Update (Step-by-Step)

> Ganti `BRANCH=master` jika ingin branch lain.

### 1. Cek status saat ini
```bash
ssh -p 1403 ubuntu@43.157.197.148 "docker ps; cd /opt/wa-clinic-bot && git status && git log -1 --oneline"
```
Pastikan `waha` berstatus `Up` (bukan `Restarting`).

### 2. Tarik kode terbaru dari GitHub
```bash
ssh -p 1403 ubuntu@43.157.197.148 "cd /opt/wa-clinic-bot && git pull origin master"
```
Verifikasi commit terbaru (misal `2c1be62`).

### 3. Jalankan migrasi database (PENTING: sebelum app naik)
Di dalam container `app` yang **lama** (masih jalan) jalankan:
```bash
ssh -p 1403 ubuntu@43.157.197.148 "cd /opt/wa-clinic-bot && docker compose exec -T app npx prisma migrate deploy"
```
> Jika muncul `P3009` / `relation ... already exists`:
> **JANGAN drop tabel.** Tandai migration yang sebenarnya sudah pernah diterapkan:
> ```bash
> cd /opt/wa-clinic-bot
> docker compose exec -T app npx prisma migrate resolve --applied NAMA_MIGRATION
> # ulangi `prisma migrate deploy`
> ```
> Sebagai alternatif sinkronisasi cepat (aman karena semua migration sudah pernah
> diterapkan manual): `docker compose exec -T app npx prisma db push`
> → hasil: `Your database is now in sync with your Prisma schema.`

### 4. Rebuild HANYA container app
```bash
ssh -p 1403 ubuntu@43.157.197.148 "cd /opt/wa-clinic-bot && docker compose build app && docker compose up -d --no-deps app"
```
- `--no-deps` → tidak menyentuh postgres/waha/caddy.
- WAHA tetap `Up` & sesi tetap aktif.

### 5. Verifikasi
```bash
ssh -p 1403 ubuntu@43.157.197.148 "docker ps"
ssh -p 1403 ubuntu@43.157.197.148 "docker logs --tail 30 wa-clinic-bot-app-1"
```
Checklist sukses:
- [ ] `wa-clinic-bot-waha-1` → `Up X hours` (angka jam **tidak** kembali ke 0).
- [ ] `wa-clinic-bot-app-1` → `Up`, log muncul `🚀 WhatsApp Clinic Bot Engine listening on http://0.0.0.0:3000`.
- [ ] `wa-clinic-bot-postgres-1` → `Up (healthy)`.
- [ ] Tidak ada error `column ... does not exist` / `prisma:error` di log app.
- [ ] Website/admin dashboard bisa diakses.

> ℹ️ Jika muncul error `The column X does not exist`, cukup jalankan lagi
> `npx prisma db push` lalu `docker compose restart app` (perintah nomor 3 & 4).

---

## ⚠️ Rollback (Jika Ada Masalah)

```bash
cd /opt/wa-clinic-bot
git checkout <COMMIT_SEBELUMNYA>   # misal 4942564
docker compose build app
docker compose up -d --no-deps app
```
> Sesi WAHA tetap aman; DB tidak ikut di-rollback (jangan `db push` ke arah lama).

---

## 🗺️ Peta Perintah Cepat

| Tujuan | Perintah |
| ------ | -------- |
| Lihat container | `ssh -p 1403 ubuntu@43.157.197.148 "docker ps"` |
| Lihat log app | `ssh -p 1403 ubuntu@43.157.197.148 "docker logs --tail 50 wa-clinic-bot-app-1"` |
| Lihat log waha | `ssh -p 1403 ubuntu@43.157.197.148 "docker logs --tail 50 wa-clinic-bot-waha-1"` |
| Rebuild app saja | `cd /opt/wa-clinic-bot && docker compose build app && docker compose up -d --no-deps app` |
| Migrasi DB | `cd /opt/wa-clinic-bot && docker compose exec -T app npx prisma migrate deploy` |
| Sync skema cepat | `cd /opt/wa-clinic-bot && docker compose exec -T app npx prisma db push` |
| Restart app | `cd /opt/wa-clinic-bot && docker compose restart app` |
| Cek WAHA sesi | `docker compose exec -T app curl -s http://waha:3000/api/default/checkAndGetQR` |

---

## 🔒 Aturan (Wajib Dipatuhi)

1. **Jangan pernah `docker compose down`** di server live tanpa alasan darurat —
   itu akan memutus sesi WAHA (meski volume tersimpan, reconnect butuh waktu).
2. **Jangan gunakan `:latest` untuk image WAHA** — selalu version-pinned
   (`devlikeapro/waha:noweb-2026.7.2`). Validasi upgrade WAHA di staging dulu.
3. **Jangan pernah commit `.env`** (berisi kredensial live) — file ini
   di-gitignore.
4. **Test di localhost dulu** (`npm test`, `npx tsc --noEmit`) sebelum deploy.
5. **Konfirmasi 2x** dengan pemilik sebelum deploy ke server live.
6. **Ganti password di bagian atas dengan SSH key** sesegera mungkin.
