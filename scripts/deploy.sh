set -e
cd /opt/wa-clinic-bot

echo "=== 1. Pull Latest Code from Master ==="
git pull origin master

echo "=== 2. Build App Image ==="
docker compose build app

echo "=== 3. Safe Restart App Container (WAHA untouched) ==="
docker compose up -d --no-deps app

echo "=== 4. Check Container Status ==="
docker compose ps