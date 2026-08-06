# Runbook Deploy — Perf Fix Admin Dashboard

Men-deploy perubahan optimasi performa admin dashboard ke server. Runbook ini fokus pada
deploy yang **TIDAK merestart WAHA** (bot & WAHA adalah service terpisah; `app` di
`docker-compose.yml` hanya `depends_on: postgres`).

> ⚠️ **Server update gate**: Jangan pernah deploy langsung ke server production tanpa
> instruksi eksplisit dari user yang menyebutkan server, dan WAJIB konfirmasi 2x sebelum eksekusi.
> Semua pengujian dilakukan di localhost dulu. Lihat `.agents/rules/server-update-gate.md`.

---

## 1. Isi Perubahan (untuk deploy ini)

| Perubahan | File |
|-----------|------|
| Cache headers static assets + `no-cache` index.html | `src/routes/admin.route.ts` |
| Endpoint baru `GET /api/admin/reservations/count` | `src/routes/admin.route.ts` |
| Pagination `/api/admin/reservations` & `/api/admin/knowledge/chunks` | `src/routes/admin.route.ts` |
| Limit messages customer (default 200) | `src/routes/admin.route.ts` |
| Batch fetch chunks (fix N+1) | `src/routes/admin.route.ts` |
| Fix N+1 Live Chat | `src/services/live-chat.service.ts` |
| Overview & Layout polling lebih jarang + count endpoint | `packages/admin-dashboard/src/pages/tenant/Overview.tsx`, `Layout.tsx` |
| Pagination accumulate di Reservations | `packages/admin-dashboard/src/pages/tenant/Reservations.tsx` |
| Komponen `Pagination` reusable + refactor 2 halaman | `components/common/Pagination.tsx`, `CustomerDatabase.tsx`, `FollowUpQueue.tsx` |
| Composite indexes (DB) | `prisma/schema.prisma` + `prisma/migrations/20260815000000_add_perf_composite_indexes/` |

---

## 2. Pre-flight di Localhost

```bash
# 1. Backend typecheck
npm run build

# 2. Frontend build (HARUS rebuild, dist/ di-serve langsung oleh bot)
cd packages/admin-dashboard && npm run build && cd ../..

# 3. Test relevan (semua harus hijau)
npx vitest run tests/integration/live_chat_monitor.test.ts \
  tests/integration/live-chat-reply.test.ts \
  tests/integration/live-chat-sse.test.ts \
  tests/integration/landing-admin.test.ts
```

> Catatan: `tests/integration/queue-stale-state.test.ts` gagal **pre-existing** (terverifikasi di
> master bersih) — bukan regresi dari perubahan ini. Abaikan.

---

## 3. Migration DB (Composite Indexes)

Index migration tidak menyentuh WAHA dan tidak butuh downtime (tabel masih kecil; untuk tabel
besar di masa depan gunakan `CREATE INDEX CONCURRENTLY` manual via psql).

```bash
# Di folder repo, dengan DATABASE_URL mengarah ke server (atau via docker compose exec)
npx prisma migrate deploy
```

Verifikasi tidak ada drift:

```bash
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
# Output harus: -- This is an empty migration.
```

> Jika error `relation "children" already exists` (known pitfall), sekali saja:
> `npx prisma migrate resolve --applied 20260802000000_add_children` lalu `npx prisma migrate deploy` ulang.

---

## 4. Deploy Bot (Tidak Menyentuh WAHA)

```bash
# Pastikan di server, di folder yang memegang docker-compose.yml
docker compose up -d --build app
```

- Hanya container `app` yang di-recreate.
- `waha`, `postgres`, `caddy` **tidak di-restart** selama config-nya tidak berubah.
- **JANGAN** pakai `docker compose down` lalu `up -d`, atau `docker compose restart`
  — itu akan restart semua service termasuk WAHA.

---

## 5. Post-Deploy Verification

```bash
# 1. Status container
docker compose ps

# 2. Log bot bebas error saat boot
docker compose logs app --tail=100

# 3. Health check admin
curl -s https://<domain>/api/admin/health | head -1

# 4. Cek cache header asset (harus immutable)
curl -sI https://<domain>/admin/assets/index-*.js | grep -i cache-control

# 5. Cek index.html (harus no-cache)
curl -sI https://<domain>/admin/ | grep -i cache-control

# 6. Smoke test reservations + count
curl -s "https://<domain>/api/admin/reservations?page=1&pageSize=20" | head -c 300
curl -s "https://<domain>/api/admin/reservations/count"

# 7. Pastikan WAHA masih WORKING (session tidak berubah)
docker compose logs waha --tail=30 | grep -i "session"
```

Manual UI: buka admin → Overview (statistik cepat), Reservations (pagination + load more),
Live Chat Monitor (cepat), Customer DB (search + history chat).

---

## 6. Rollback

```bash
# Rollback kode: kembali ke commit/tag sebelumnya lalu redeploy app
docker compose up -d --build app
```

> Index DB baru TIDAK perlu di-drop pada rollback — index tidak merusak apa pun dan tetap
> dipakai query lama. Hanya perlu di-drop bila yakin ingin bersih:
> `DROP INDEX IF EXISTS customers_tenant_id_created_at_idx, conversations_tenant_human_lastmsg_idx, messages_conversation_tenant_created_idx, reservations_tenant_id_created_at_idx;`

---

## 7. Troubleshooting

| Gejala | Kemungkinan | Solusi |
|--------|-------------|--------|
| Admin tampak lama / JS lama | Cache browser index.html | Hard refresh (Ctrl+Shift+R). Pastikan header `no-cache` untuk `/admin/` |
| Asset 404 setelah deploy | dist/ belum rebuild | `cd packages/admin-dashboard && npm run build` lalu redeploy |
| Endpoint count tidak ada | Versi kode lama | Pastikan image `app` sudah rebuild (`--build`) |
| WAHA disconected | Bukan dari deploy ini | Cek `docker compose logs waha`; sesi aman di volume `waha_sessions` |
| Migrate gagal `children` | Known pitfall | Lihat §3 resolve-applied |
