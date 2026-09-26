#!/usr/bin/env bash
#
# install-server-watchdog.sh — Installer satu-kali watchdog di SERVER PRODUKSI.
# Dijalankan DI SERVER (bukan lokal):  bash scripts/install-server-watchdog.sh
#
# Tugasnya:
#   1. Resolusi kredensial Telegram (prioritas: .env server → baris tenant di DB).
#      Token DB yang terenkripsi di-decrypt via container app (dist yang sudah
#      jalan, tanpa install apa pun). Nilai plaintext yang cocok pola token
#      dipakai langsung (dual-read ala decryptSecretCompat).
#   2. Tulis /opt/wa-clinic-bot/.watchdog.env (chmod 600, di-ignore git).
#   3. Pasang cron */2 menit (idempoten) + kirim pesan uji "watchdog aktif".
#
# Aman untuk WAHA & Meta: tidak menyentuh container waha, tidak memicu event
# Meta. Satu-satunya efek samping: 1 pesan uji ke grup Telegram + 1 baris cron.
#
set -uo pipefail

APP_DIR="/opt/wa-clinic-bot"
ENV_FILE="$APP_DIR/.env"
OUT_FILE="$APP_DIR/.watchdog.env"
cd "$APP_DIR"

strip_quotes() { # hapus kutip pembungkus nilai .env
  local v="$1"
  v="${v%\"}"; v="${v#\"}"; v="${v%\'}"; v="${v#\'}"
  printf '%s' "$v"
}

get_env_val() { # $1=NAMA_VAR → nilai dari .env (kosong bila tak ada)
  local line
  line="$(grep -m1 "^$1=" "$ENV_FILE" 2>/dev/null || true)"
  strip_quotes "${line#*=}"
}

echo "=== 1. Resolusi kredensial Telegram ==="
BOT_TOKEN="$(get_env_val TELEGRAM_BOT_TOKEN)"
CHAT_ID="$(get_env_val TELEGRAM_CHAT_ID)"
TOPIC="$(get_env_val TELEGRAM_TOPIC_SYSTEM_ERRORS)"

if [[ -z "$BOT_TOKEN" || -z "$CHAT_ID" ]]; then
  echo "Lengkap dari .env tidak cukup → baca baris tenant di DB (panjang saja, bukan isi)."
  DB_ROW="$(docker compose -f "$APP_DIR/docker-compose.yml" exec -T postgres \
    psql -U postgres -d wa_clinic_db -t -A -F'|' \
    -c "SELECT telegram_bot_token, telegram_chat_id FROM tenants WHERE slug='default' OR id='default-tenant' LIMIT 1;" 2>/dev/null | tr -d '\r' || true)"
  DB_TOKEN="${DB_ROW%%|*}"
  DB_CHAT="${DB_ROW##*|}"
  if [[ -z "$BOT_TOKEN" ]]; then
    if [[ "$DB_TOKEN" =~ ^[0-9]+:[A-Za-z0-9_-]+$ ]]; then
      echo "Token DB plaintext (pola token valid) → dipakai langsung."
      BOT_TOKEN="$DB_TOKEN"
    elif [[ -n "$DB_TOKEN" ]]; then
      echo "Token DB terenkripsi → decrypt via container app."
      if docker compose -f "$APP_DIR/docker-compose.yml" exec -T app test -f dist/utils/encryption.js; then
        BOT_TOKEN="$(docker compose -f "$APP_DIR/docker-compose.yml" exec -T app node -e \
          "const {decryptSecretCompat}=require('./dist/utils/encryption.js');process.stdout.write(decryptSecretCompat(process.argv[1]));" \
          "$DB_TOKEN" 2>/dev/null || true)"
      else
        echo "WARN: dist/utils/encryption.js tak ada di container — token DB tidak bisa di-decrypt."
      fi
    fi
  fi
  [[ -z "$CHAT_ID" ]] && CHAT_ID="$DB_CHAT"
fi

if [[ -z "$BOT_TOKEN" || -z "$CHAT_ID" ]]; then
  echo "FATAL: kredensial Telegram tidak lengkap (token/chat). Isi TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID di .env lalu ulangi."
  exit 1
fi
echo "Kredensial OK (token ${#BOT_TOKEN} char, chat ${#CHAT_ID} char — nilai tidak ditampilkan)."

echo "=== 2. Tulis $OUT_FILE (chmod 600) ==="
{
  echo "# Dibuat oleh install-server-watchdog.sh — JANGAN commit (di-ignore via .env*)."
  echo "WATCHDOG_BOT_TOKEN=$BOT_TOKEN"
  echo "WATCHDOG_CHAT_ID=$CHAT_ID"
  echo "WATCHDOG_TOPIC=$TOPIC"
} > "$OUT_FILE"
chmod 600 "$OUT_FILE"

echo "=== 3. Pasang cron */2 menit (idempoten) ==="
CRON_LINE="*/2 * * * * $APP_DIR/scripts/server-watchdog.sh >> /var/tmp/wa-clinic-bot-watchdog/cron.log 2>&1"
( crontab -l 2>/dev/null | grep -v "server-watchdog.sh" ; echo "$CRON_LINE" ) | crontab -
crontab -l | grep "server-watchdog.sh"

echo "=== 4. Uji kirim pesan Telegram ==="
chmod +x "$APP_DIR/scripts/server-watchdog.sh"
# Pesan uji langsung (terpisah dari logika watchdog agar pasti terkirim sekali):
TEXT="✅ Watchdog server AKTIF — notifikasi DOWN/RECOVERY akan masuk ke sini."
ARGS=( -sS --max-time 20 -o /dev/null -w '%{http_code}'
  --data-urlencode "chat_id=$CHAT_ID" --data-urlencode "text=$TEXT" )
[[ -n "$TOPIC" ]] && ARGS+=( --data-urlencode "message_thread_id=$TOPIC" )
CODE="$(curl "${ARGS[@]}" "https://api.telegram.org/bot$BOT_TOKEN/sendMessage" 2>/dev/null || echo 000)"
if [[ "$CODE" == "200" ]]; then
  echo "Pesan uji TERKIRIM (http 200). Selesai."
else
  echo "WARN: pesan uji gagal (http=$CODE). Cek token/chat id, lalu jalankan ulang skrip ini."
  exit 1
fi
