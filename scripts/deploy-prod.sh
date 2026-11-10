#!/usr/bin/env bash
# =============================================================================
# deploy-prod.sh — Go-live runbook WAHA Clinic Bot (production VM)
#
# Jalankan DI SERVER di direktori repo (/opt/wa-clinic-bot), setelah git pull.
#   bash scripts/deploy-prod.sh
#
# Melakukan (dengan cek-cek otomatis):
#   1. Validasi .env (ADMIN_API_KEY, WAHA_WEBHOOK_SECRET, WAHA_API_KEY, WAHA_BASE_URL)
#   2. Build image app + worker (worker WAJIB ikut: cron hanya jalan di worker)
#   3. Prisma migrate deploy lewat container sekali pakai (app lama tetap melayani)
#   4. Recreate app + worker berbarengan
#   5. Verifikasi no-drift skema
#   6. Health check /health + /ready + status container worker
# Aman dijalankan ulang (idempoten).
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."
echo "==> Direktori: $(pwd)"

# -----------------------------------------------------------------------------
# 1. Validasi .env
# -----------------------------------------------------------------------------
echo
echo "==> [1/6] Validasi .env ..."

require_env() {
  local key="$1"
  if ! grep -qE "^${key}=" .env 2>/dev/null; then
    echo "ERROR: .env tidak punya ${key}. Isi dulu sebelum deploy." >&2
    exit 1
  fi
  local val
  val=$(grep -E "^${key}=" .env | head -1 | cut -d'=' -f2- | tr -d '"')
  if [[ -z "${val}" ]]; then
    echo "ERROR: .env punya ${key} tapi kosong. Isi dengan nilai yang benar." >&2
    exit 1
  fi
}

require_env "ADMIN_API_KEY"
require_env "WAHA_WEBHOOK_SECRET"

WAHA_API_KEY_VAL=$(grep -E "^WAHA_API_KEY=" .env | head -1 | cut -d'=' -f2- | tr -d '"')
if [[ -z "${WAHA_API_KEY_VAL}" ]]; then
  echo "ERROR: WAHA_API_KEY di .env kosong. Isi dgn API key WAHA (harus sama dgn yang dipakai service waha di docker-compose.yml, dari var .env yang sama)." >&2
  exit 1
fi

if grep -qE "^WAHA_BASE_URL=(http://)?localhost|^WAHA_BASE_URL=127\." .env; then
  echo "ERROR: WAHA_BASE_URL di .env menunjuk localhost. Dari dalam container app harus 'http://waha:3000'." >&2
  echo "  Fix: set WAHA_BASE_URL=http://waha:3000 di .env server (jangan localhost:3001)." >&2
  exit 1
fi

echo "  OK: ADMIN_API_KEY ✓ WAHA_WEBHOOK_SECRET ✓ WAHA_API_KEY ✓ WAHA_BASE_URL ✓"

# Pastikan Docker network eksternal hermes-net (docker-compose.yml) sudah ada
if ! docker network inspect hermes-net >/dev/null 2>&1; then
  echo "  Membuat Docker network eksternal hermes-net ..."
  docker network create hermes-net || true
fi

# -----------------------------------------------------------------------------
# 2. Build image app + worker
# -----------------------------------------------------------------------------
echo
echo "==> [2/6] Build image app + worker ..."
# PENTING: docker-compose.yml menyetel SEPARATE_WORKER=true, sehingga seluruh cron
# dan sweep hanya berjalan di container `worker`. Kalau `worker` tidak ikut
# di-build, ia tetap memakai image commit lama dan cron baru (mis. Ad Watchdog)
# tidak akan pernah jalan walau flag env-nya sudah dinyalakan.
docker compose build app worker

# -----------------------------------------------------------------------------
# 3. Prisma migrate deploy (container sekali pakai; app lama tetap melayani)
# -----------------------------------------------------------------------------
echo
echo "==> [3/6] npx prisma migrate deploy (one-shot container) ..."
MIGRATE_LOG=$(mktemp)
if ! docker compose run --rm app npx prisma migrate deploy 2>&1 | tee "$MIGRATE_LOG"; then
  if grep -q 'relation "children" already exists' "$MIGRATE_LOG"; then
    echo "  Dikenali sebagai known pitfall. Jalankan resolve lalu deploy ulang ..."
    docker compose run --rm app npx prisma migrate resolve --applied 20260802000000_add_children
    docker compose run --rm app npx prisma migrate deploy
  else
    echo "ERROR: migrate deploy gagal (bukan pola children)." >&2
    rm -f "$MIGRATE_LOG"
    exit 1
  fi
fi
rm -f "$MIGRATE_LOG"
echo "  Migrate deploy: OK"

# -----------------------------------------------------------------------------
# 4. Recreate app + worker
# -----------------------------------------------------------------------------
echo
echo "==> [4/6] docker compose up -d --no-deps app worker ..."
docker compose up -d --no-deps app worker

echo "==> Menunggu container app running ..."
for i in $(seq 1 30); do
  if docker compose ps app --format '{{.State}}' 2>/dev/null | grep -q running; then
    break
  fi
  sleep 2
done

if ! docker compose ps app --format '{{.State}}' 2>/dev/null | grep -q running; then
  echo "ERROR: container app tidak running. Cek log:" >&2
  docker compose logs --tail 40 app >&2
  exit 1
fi
echo "  Container app: RUNNING"

# Cek boot tidak crash (ADMIN_API_KEY / WAHA_WEBHOOK_SECRET throw)
sleep 3
if docker compose logs app --tail 200 2>&1 | grep -qE "Critical Configuration Missing|Critical Security Configuration Missing"; then
  echo "ERROR: app crash saat boot (env masih ada yang kurang). Cek .env & log:" >&2
  docker compose logs --tail 40 app >&2
  exit 1
fi
echo "  Boot log: bersih dari throw env kritikal"

if ! docker compose ps worker --format '{{.State}}' 2>/dev/null | grep -q running; then
  echo "ERROR: container worker tidak running — cron/sweep tidak akan jalan. Cek log:" >&2
  docker compose logs --tail 40 worker >&2
  exit 1
fi
echo "  Container worker: RUNNING"

# -----------------------------------------------------------------------------
# 5. Verifikasi no drift
# -----------------------------------------------------------------------------
echo "==> [5/6] Cek drift skema (harus '-- This is an empty migration.') ..."
DRIFT=$(docker compose exec -T app sh -c 'npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script' 2>&1 || true)
if ! echo "$DRIFT" | grep -q "This is an empty migration"; then
  echo "WARNING: ada drift antara DB dan schema. Periksa manual:" >&2
  echo "$DRIFT" | head -40 >&2
else
  echo "  No drift ✓"
fi

# -----------------------------------------------------------------------------
# 6. Health check
# -----------------------------------------------------------------------------
echo
echo "==> [6/6] Health check ..."
echo "  GET /health:"
docker compose exec -T app node -e "fetch('http://localhost:3000/health').then(r=>r.text()).then(console.log)" || { echo "  GAGAL hubungi /health"; exit 1; }
echo
echo "  GET /ready:"
docker compose exec -T app node -e "fetch('http://localhost:3000/ready').then(r=>r.text()).then(console.log)" || { echo "  GAGAL hubungi /ready"; exit 1; }
echo
echo "  Log worker (10 baris terakhir, pastikan tidak crash-loop):"
docker compose logs --tail 10 worker 2>&1 || true
echo
echo
echo "Selesai. Kalau /ready menunjukkan waha bukan WORKING, scan QR via admin dashboard."
echo "Lalu kirim 1 pesan WhatsApp asli untuk smoke test."
