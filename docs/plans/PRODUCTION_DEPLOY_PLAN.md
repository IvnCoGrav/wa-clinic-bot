# Rencana Deploy Produksi (Lokal → Live Server)

- **Status:** RENCANA — belum ada deploy/migrasi produksi. Kode & migrasi hanya di lokal/dev.
- **Server:** `43.157.197.148:1403` (SSH), Docker Compose `/opt/wa-clinic-bot`.
- **Aturan:** deploy berisiko menyentuh WAHA/Meta → **2-step verification**. Deploy standar → 1-step.

## 1. Prasyarat sebelum deploy
1. Semua perubahan di-commit (branch terpisah, bukan langsung master) + review diff.
2. `npm run build` exit 0 (diverifikasi).
3. `npm test` hijau (kecuali flaky #101 yang lulus isolasi).
4. **Regenerate Prisma client bersih** (matikan dev server lokal agar DLL tidak terkunci): `npx prisma generate` (DILARANG `--no-engine`).
5. Backup DB produksi + rehearsal restore.

## 2. Migrasi yang akan diterapkan ke produksi
Daftar migrasi baru (lokal sudah diuji):
1. `20260920000000_tenant_identity_boundary` — `phone @unique` → `@@unique([tenant_id, phone])`.
2. `20260920000001_reservation_request_id_and_followup_unique`.
3. `20260920000002_reservation_needs_staff_verification`.
4. `20260920000003_conversation_session_data`.
5. `20260920000004_durable_turn_inbox_outbox`.
6. `20260920000005_inbound_turn_payload`.

**Urutan aman:** backup → `migrate deploy` (bypass shadow-DB) → drift check `--from-url` empty → **deploy kode** baru (harus bersamaan; `findUnique({phone})` berubah jadi compound).

## 3. Langkah deploy
1. **Backup:** `docker compose exec -T postgres pg_dump -U postgres wa_clinic_db > backup_<ts>.sql` di server; verifikasi ukuran + rehearsal restore ke DB sementara.
2. **Preflight produksi (read-only):** ulangi MT-0.2/MT-0.3 di DB produksi (0 phone multi-tenant, 0 duplikat follow-up).
3. **Deploy kode** (git pull / rsync) + `npm ci` + `npm run build`.
4. **Migrasi:** `npx prisma migrate deploy`.
5. **Restart** container app.
6. **Smoke test:** webhook WAHA satu pesan uji; cek hidup; cek `/health`.
7. **Monitor** 15–30 menit: log `V3_AGENT_RUNNER_ERROR`, `IGNORED_UNKNOWN_TENANT`, queue, delivery.

## 4. Rollback
- Kode: kembali ke image/commit sebelumnya.
- DB: **JANGAN** kembalikan `phone @unique` setelah multi-tenant (index komposit aditif).
- `session_data`/`inbound_turns`/`outbound_attempts` aditif → aman ditinggalkan.
- Bila migrasi gagal di tengah: `migrate resolve --rolled-back <name>` (seperti insiden BOM lokal).

## 5. Risiko
| Risiko | Mitigasi |
|---|---|
| Kode produksi lama + schema baru mismatch | Deploy kode & migrasi bersamaan |
| Lock tabel `customers` saat migrasi | Maintenance window singkat |
| WhatsApp/Meta terganggu | 2-step verification; hindari tes live saat deploy |
| Redis `noeviction` (issue #8) | Periksa sebelum deploy |

## 6. Belum diputuskan
- Window deploy (jam sepi?).
- Apakah deploy sekaligus semua migrasi atau bertahap.
- CG-09 (PII) — terkait logging produksi.
