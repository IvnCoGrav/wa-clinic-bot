#!/usr/bin/env bash
# =============================================================================
# deploy.sh — Entrypoint deploy produksi WAHA Clinic Bot
#
# DEL-02: Mendelegasikan ke runbook kanonis deploy-prod.sh yang mencakup
# validasi .env, migrasi database Prisma, build & restart container app + worker,
# verifikasi skema, dan health check otomatis.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROD_SCRIPT="${SCRIPT_DIR}/deploy-prod.sh"

if [[ ! -f "${PROD_SCRIPT}" ]]; then
  echo "ERROR: deploy-prod.sh tidak ditemukan di ${SCRIPT_DIR}" >&2
  exit 1
fi

echo "==> [deploy.sh] Menjalankan runbook produksi deploy-prod.sh ..."
exec bash "${PROD_SCRIPT}" "$@"
