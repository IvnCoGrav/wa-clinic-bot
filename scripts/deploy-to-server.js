const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

function resolveSshKey() {
  if (process.env.SSH_KEY_PATH && fs.existsSync(process.env.SSH_KEY_PATH)) {
    return process.env.SSH_KEY_PATH;
  }
  const candidates = [
    path.join(os.homedir(), '.ssh', 'id_ed25519_klinik'),
    path.join(os.homedir(), '.ssh', 'id_ed25519'),
    path.join(os.homedir(), '.ssh', 'id_rsa'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}

function runSsh(command) {
  const sshKey = resolveSshKey();
  const sshPort = process.env.SSH_PORT || '1403';
  const sshUser = process.env.SSH_USER || 'ubuntu';
  const sshHost = process.env.SSH_HOST || '43.173.11.79';
  const b64 = Buffer.from(command).toString('base64');
  const sshCmd = `ssh -i "${sshKey}" -p ${sshPort} -o StrictHostKeyChecking=no ${sshUser}@${sshHost} "echo ${b64} | base64 -d | bash"`;
  return execSync(sshCmd, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
}

async function deploy() {
  console.log(`Using SSH Key: ${resolveSshKey()}`);

  console.log('=== 1. Git Pull Latest Code & Rebuild App Container ===');
  const deployCmd = `
set -e
cd /opt/wa-clinic-bot
echo "--> Ensure AI_MODEL_RECEIPT_VISION in .env..."
if ! grep -q "AI_MODEL_RECEIPT_VISION" /opt/wa-clinic-bot/.env; then
  echo 'AI_MODEL_RECEIPT_VISION="glm-5.3-flash"' >> /opt/wa-clinic-bot/.env
  echo "Added AI_MODEL_RECEIPT_VISION to remote .env"
fi

echo "--> Discard any uncommitted whitespace/CRLF drifts on working tree..."
git checkout -- .

echo "--> Git Pull Latest Code..."
git pull origin master

echo "--> Build Docker Images (app & worker)..."
docker compose build app worker
if docker compose ps --services --filter "status=running" | grep -q "^worker$"; then
  echo "--> Recreate Worker Container Safely..."
  docker compose up -d --no-deps worker
fi

echo "--> Recreate App Container Safely (WAHA untouched)..."
docker compose up -d --no-deps app

echo "--> Run Database Migrations..."
docker compose exec -T app npx prisma migrate deploy

echo "--> Run Purchase Values Backfill & DB Sanitization..."
docker compose exec -T app npx tsx src/scripts/sanitize-purchase-values.ts || true

echo "--> Check Docker Compose Status..."
docker compose ps
`;
  console.log(runSsh(deployCmd));

  console.log('=== 2. Check App Startup Logs ===');
  const logsCmd = `docker compose -f /opt/wa-clinic-bot/docker-compose.yml logs app --tail 40`;
  console.log(runSsh(logsCmd));

  console.log('\n✅ DEPLOYMENT TO LIVE SERVER FINISHED SUCCESSFULLY!');
}

deploy().catch(console.error);
