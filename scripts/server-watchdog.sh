#!/usr/bin/env bash
#
# server-watchdog.sh — Pengawas eksternal anti-buta untuk wa-clinic-bot.
#
# LATAR (insiden #135, 26 Sep 2026): monitoring di dalam aplikasi (AlertService,
# waha-monitor, cron) ikut mati saat container `app` di-recreate → 502 `/cta`
# selama ±3 menit tanpa ada yang memberi tahu. Watchdog ini berjalan di HOST
# (cron), BUKAN di dalam container, sehingga tetap bisa berteriak saat app down.
#
# Cara kerja:
#   1. Cek container `app` (running + healthcheck /health).
#   2. Cek jalur publik Caddy: GET https://app.kalababyspa.online/health (tanpa
#      tulis DB — tidak mengotori AdClick / tidak perlu label QA test).
#   3. Mesin status anti-flap: DOWN dinyatakan setelah CONSECUTIVE_FAIL_THRESHOLD
#      gagal beruntun (default 2x; cron 2 menit = alert ≤4 menit). DOWN dikirim
#      SEKALI, pengingat berkala opsional, RECOVERY sekali + durasi downtime.
#
# Konfigurasi: file .watchdog.env (dibuat oleh install-server-watchdog.sh,
# chmod 600, di-ignore git via pola .env*). Semua variabel bisa di-override
# via environment (dipakai untuk simulasi pengujian).
#
#   WATCHDOG_CONFIG          path file kredensial (default: <APP_DIR>/.watchdog.env)
#   WATCHDOG_APP_DIR         root repo di server (default: /opt/wa-clinic-bot)
#   WATCHDOG_STATE_DIR       direktori state (default: /var/tmp/wa-clinic-bot-watchdog)
#   WATCHDOG_SITE_URL        situs publik (default: https://app.kalababyspa.online)
#   WATCHDOG_FAIL_THRESHOLD  gagal beruntun sebelum alert (default: 2)
#   WATCHDOG_REMINDER_MIN    pengingat ulang saat masih DOWN, 0 = mati (default: 60)
#   WATCHDOG_API_URL         override endpoint Telegram API (pengujian)
#
# Dependensi host: bash, curl, docker, flock — semua sudah ada di server.
# TANPA dependency npm baru (mandat zero new runtime dependencies).
#
set -uo pipefail
umask 077

APP_DIR="${WATCHDOG_APP_DIR:-/opt/wa-clinic-bot}"
CONFIG_FILE="${WATCHDOG_CONFIG:-$APP_DIR/.watchdog.env}"
STATE_DIR="${WATCHDOG_STATE_DIR:-/var/tmp/wa-clinic-bot-watchdog}"
SITE_URL="${WATCHDOG_SITE_URL:-https://app.kalababyspa.online}"
FAIL_THRESHOLD="${WATCHDOG_FAIL_THRESHOLD:-2}"
REMINDER_MIN="${WATCHDOG_REMINDER_MIN:-60}"
API_URL="${WATCHDOG_API_URL:-https://api.telegram.org}"

STATE_FILE="$STATE_DIR/state"
LOG_FILE="$STATE_DIR/watchdog.log"

log() {
  mkdir -p "$STATE_DIR"
  echo "[$(date -u +%FT%TZ)] $1" >> "$LOG_FILE"
}

# --- Parser KEY=VALUE aman (tanpa `source`/xargs) ---
# `source` mengeksekusi substitusi perintah di dalam file dan mengekspor seluruh
# variabel; file konfigurasi/state hanya boleh menyumbang key yang diizinkan.
parse_kv_file() { # $1=file, sisa=key yang diizinkan
  local file="$1"; shift
  local allowed=" $* "
  local line key value
  [[ -f "$file" ]] || return 1
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line//[[:space:]]/}" ]] && continue
    key="${line%%=*}"
    key="${key//[[:space:]]/}"
    value="${line#*=}"
    [[ "$key" =~ ^[A-Z0-9_]+$ ]] || continue
    [[ "$allowed" == *" $key "* ]] || continue
    value="${value%\"}"; value="${value#\"}"
    value="${value%\'}"; value="${value#\'}"
    printf -v "$key" '%s' "$value"
  done < "$file"
  return 0
}

# --- Muat kredensial (JANGAN pernah echo nilainya ke log) ---
if [[ ! -f "$CONFIG_FILE" ]]; then
  log "ERROR: file konfigurasi tidak ada: $CONFIG_FILE (jalankan install-server-watchdog.sh)"
  exit 2
fi
parse_kv_file "$CONFIG_FILE" WATCHDOG_BOT_TOKEN WATCHDOG_CHAT_ID WATCHDOG_TOPIC WATCHDOG_HOST_LABEL || true

if [[ -z "${WATCHDOG_BOT_TOKEN:-}" || -z "${WATCHDOG_CHAT_ID:-}" ]]; then
  log "ERROR: WATCHDOG_BOT_TOKEN / WATCHDOG_CHAT_ID kosong di $CONFIG_FILE"
  exit 2
fi

# --- Kunci anti-tumpuk (cron 2 menit, run harus < 60 detik) ---
mkdir -p "$STATE_DIR"
exec 200>"$STATE_DIR/lock"
if ! flock -n 200; then
  exit 0
fi

# --- Baca status sebelumnya ---
PREV_STATE="OK"
PREV_CONSEC=0
DOWN_SINCE=0
LAST_ALERT=0
if [[ -f "$STATE_FILE" ]]; then
  parse_kv_file "$STATE_FILE" STATE CONSEC DOWN_SINCE LAST_ALERT || true
  PREV_STATE="${STATE:-OK}"
  PREV_CONSEC="${CONSEC:-0}"
  DOWN_SINCE="${DOWN_SINCE:-0}"
  LAST_ALERT="${LAST_ALERT:-0}"
fi

save_state() { # $1=STATE $2=CONSEC $3=DOWN_SINCE $4=LAST_ALERT
  printf 'STATE=%s\nCONSEC=%s\nDOWN_SINCE=%s\nLAST_ALERT=%s\n' "$1" "$2" "$3" "$4" > "$STATE_FILE"
}

send_telegram() { # $1=judul $2=isi-baris-tambahan
  local title="$1" extra="$2" now_wib
  now_wib="$(TZ=Asia/Jakarta date '+%d %b %Y %H:%M WIB')"
  local text
  text="$title
Waktu: $now_wib
Host: ${WATCHDOG_HOST_LABEL:-wa-clinic-bot}
$extra
Cek manual: $SITE_URL/health"

  # M17-13-WATCHDOG: token TIDAK boleh muncul di argv (terlihat via `ps`).
  # URL ber-token ditulis ke file config curl mode 600; teks dikirim via file
  # agar aman terhadap newline/karakter khusus.
  local cfg textfile code
  cfg="$(mktemp "$STATE_DIR/curl-cfg.XXXXXX")"
  textfile="$(mktemp "$STATE_DIR/tg-text.XXXXXX")"
  chmod 600 "$cfg" "$textfile" 2>/dev/null || true
  printf '%s' "$text" > "$textfile"
  {
    printf 'url = "%s/bot%s/sendMessage"\n' "$API_URL" "$WATCHDOG_BOT_TOKEN"
    printf 'silent\nshow-error\noutput = "/dev/null"\nmax-time = 20\n'
  } > "$cfg"

  local args=( -K "$cfg" -w '%{http_code}'
    --data-urlencode "chat_id=$WATCHDOG_CHAT_ID"
    --data-urlencode "text@$textfile" )
  if [[ -n "${WATCHDOG_TOPIC:-}" ]]; then
    args+=( --data-urlencode "message_thread_id=$WATCHDOG_TOPIC" )
  fi
  code="$(curl "${args[@]}" 2>/dev/null || echo 000)"
  rm -f "$cfg" "$textfile"
  if [[ "$code" == "200" ]]; then
    return 0
  fi
  log "ERROR: kirim Telegram gagal (http=$code)"
  return 1
}

# --- Pemeriksaan berlapis (fondasional: bedakan app-mati vs caddy-mati) ---
NOW="$(date +%s)"
FAILURES=""

# Lapis 1: container app hidup?
CID="$(docker compose -f "$APP_DIR/docker-compose.yml" ps -q app 2>/dev/null || true)"
if [[ -z "$CID" ]]; then
  FAILURES="${FAILURES}container app tidak ada (recreate/crash); "
else
  RUNNING="$(docker inspect -f '{{.State.Running}}' "$CID" 2>/dev/null || echo false)"
  if [[ "$RUNNING" != "true" ]]; then
    FAILURES="${FAILURES}container app tidak running; "
  else
    HEALTH="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CID" 2>/dev/null || echo unknown)"
    if [[ "$HEALTH" != "healthy" && "$HEALTH" != "none" && "$HEALTH" != "starting" ]]; then
      FAILURES="${FAILURES}healthcheck app = $HEALTH; "
    fi
  fi
fi

# Lapis 2: jalur publik Caddy → app (liveness, tanpa tulis DB).
HTTP_CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$SITE_URL/health" 2>/dev/null || echo 000)"
if [[ "$HTTP_CODE" != "200" ]]; then
  FAILURES="${FAILURES}GET /health publik = $HTTP_CODE; "
fi

# --- Mesin status ---
if [[ -z "$FAILURES" ]]; then
  CONSEC=0
  if [[ "$PREV_STATE" == "DOWN" ]]; then
    DUR_MIN=$(( (NOW - DOWN_SINCE + 30) / 60 ))
    [[ "$DUR_MIN" -lt 1 ]] && DUR_MIN=1
    if send_telegram "✅ *SERVER PULIH*" "Downtime: ±$DUR_MIN menit."; then
      log "RECOVERY setelah ±$DUR_MIN menit"
    fi
    save_state "OK" 0 0 "$NOW"
  else
    save_state "OK" 0 0 "$LAST_ALERT"
  fi
  exit 0
fi

CONSEC=$((PREV_CONSEC + 1))
if [[ "$PREV_STATE" != "DOWN" && "$CONSEC" -ge "$FAIL_THRESHOLD" ]]; then
  if send_telegram "🚨 *SERVER DOWN*" "Temuan: $FAILURES"; then
    log "DOWN: $FAILURES"
  fi
  [[ "$DOWN_SINCE" -eq 0 || "$PREV_STATE" == "OK" ]] && DOWN_SINCE="$NOW"
  save_state "DOWN" "$CONSEC" "$DOWN_SINCE" "$NOW"
elif [[ "$PREV_STATE" == "DOWN" ]]; then
  [[ "$DOWN_SINCE" -eq 0 ]] && DOWN_SINCE="$NOW"
  if [[ "$REMINDER_MIN" -gt 0 && $((NOW - LAST_ALERT)) -ge $((REMINDER_MIN * 60)) ]]; then
    DUR_MIN=$(( (NOW - DOWN_SINCE + 30) / 60 ))
    [[ "$DUR_MIN" -lt 1 ]] && DUR_MIN=1
    if send_telegram "🚨 *SERVER MASIH DOWN* (±$DUR_MIN mnt)" "Temuan: $FAILURES"; then
      log "REMINDER masih DOWN (±$DUR_MIN mnt): $FAILURES"
      LAST_ALERT="$NOW"
    fi
  fi
  save_state "DOWN" "$CONSEC" "$DOWN_SINCE" "$LAST_ALERT"
else
  # Gagal 1x (< threshold): catat, jangan berisik (saring blip sesaat).
  save_state "OK" "$CONSEC" 0 "$LAST_ALERT"
fi
