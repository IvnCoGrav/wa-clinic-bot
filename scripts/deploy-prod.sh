#!/usr/bin/env bash
# =============================================================================
# deploy-prod.sh — Go-live runbook WAHA Clinic Bot (production VM)
#
# Jalankan DI SERVER di direktori repo (/opt/wa-clinic-bot), setelah git pull.
#   bash scripts/deploy-prod.sh
#
# Melakukan (dengan cek-cek otomatis):
#   1. Validasi .env (ADMIN_API_KEY, WAHA_WEBHOOK_SECRET, WAHA_API_KEY, WAHA_BASE_URL)
#   2. Build & start container app
#   3. Prisma migrate deploy (+ fallback resolve migration "children" bila perlu)
#   4. Verifikasi no-drift skema
#   5. Health check /health + /ready
# Aman dijalankan ulang (idempoten).
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."
echo "==> Direktori: $(pwd)"

# -----------------------------------------------------------------------------
# 1. Validasi .env
# -----------------------------------------------------------------------------
echo
echo "==> [1/5] Validasi .env ..."

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

# -----------------------------------------------------------------------------
# 2. Build & start app
# -----------------------------------------------------------------------------
echo
echo "==> [2/5] docker compose up -d --build app ..."
docker compose up -d --build app

echo "==> Menunggu container app up ..."
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

# -----------------------------------------------------------------------------
# 3. Prisma migrate deploy
# -----------------------------------------------------------------------------
echo
echo "==> [3/5] npx prisma migrate deploy ..."
if ! docker compose exec app npx prisma migrate deploy; then
  echo "  Migration gagal — cek pola 'relation \"children\" already exists' ..."
  if docker compose exec app npx prisma migrate deploy 2>&1 | grep -q 'relation "children" already exists'; then
    echo "  Dikenali sebagai known pitfall. Jalankan resolve lalu deploy ulang ..."
    docker compose exec app npx prisma migrate resolve --applied 20260802000000_add_children
    docker compose exec app npx prisma migrate deploy
  else
    echo "ERROR: migrate deploy gagal (bukan pola children)." >&2
    exit 1
  fi
fi
echo "  Migrate deploy: OK"

# -----------------------------------------------------------------------------
# 4. Verifikasi no drift
# -----------------------------------------------------------------------------
echo
DATABASE_URL_VAL="${DATABASE_URL:-$(grep -E "^DATABASE_URL=" .env 2>/dev/null | head -1 | cut -d'=' -f2- | tr -d '"')}"
DRIFT=$(docker compose exec -T app npx prisma migrate diff --from-url "$DATABASE_URL_VAL" --to-schema-datamodel prisma/schema.prisma --script 2>&1 || true)
if ! echo "$DRIFT" | grep -q "This is an empty migration"; then
  echo "WARNING: ada drift antara DB dan schema. Periksa manual:" >&2
  echo "$DRIFT" | head -40 >&2
else
  echo "  No drift ✓"
fi

# -----------------------------------------------------------------------------
# 5. Health check
# -----------------------------------------------------------------------------
echo
echo "==> [5/5] Health check ..."
echo "  GET /health:"
curl -sS http://localhost:3000/health || { echo "  GAGAL hubungi /health"; exit 1; }
echo
echo "  GET /ready:"
curl -sS http://localhost:3000/ready || { echo "  GAGAL hubungi /ready"; exit 1; }
echo
echo
echo "Selesai. Kalau /ready menunjukkan waha bukan WORKING, scan QR via admin dashboard."
echo "Lalu kirim 1 pesan WhatsApp asli untuk smoke test."
