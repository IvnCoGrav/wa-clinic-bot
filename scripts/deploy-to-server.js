const { execSync } = require('child_process');

function runSsh(command) {
  const b64 = Buffer.from(command).toString('base64');
  const sshCmd = `ssh -i C:/Users/Ivan/.ssh/id_ed25519_klinik -p 1403 -o StrictHostKeyChecking=no ubuntu@43.157.197.148 "echo ${b64} | base64 -d | bash"`;
  return execSync(sshCmd, { encoding: 'utf8' });
}

async function deploy() {
  console.log('=== 1. Update Live Database tenant_ai_config ===');
  const sql = `
UPDATE tenant_ai_config 
SET model_name = 'gpt-4o-mini', provider = 'OpenAI', updated_at = NOW() 
WHERE task IN ('CHAT_REPLY', 'INTENT_CLASSIFICATION', 'SUMMARIZATION', 'PII_SCRUBBING', 'AI_VERIFIER');

SELECT task, model_name, provider FROM tenant_ai_config;
`;
  const sqlB64 = Buffer.from(sql).toString('base64');
  const dbCmd = `echo ${sqlB64} | base64 -d | docker compose -f /opt/wa-clinic-bot/docker-compose.yml exec -T postgres psql -U postgres -d wa_clinic_db`;
  console.log(runSsh(dbCmd));

  console.log('=== 2. Update Live /opt/wa-clinic-bot/.env ===');
  const updateEnvCmd = `
cd /opt/wa-clinic-bot
sed -i 's/^OPENAI_MODEL=.*/OPENAI_MODEL="gpt-4o-mini"/' .env
sed -i 's/^AI_MODEL_CHAT=.*/AI_MODEL_CHAT="gpt-4o-mini"/' .env
sed -i 's/^AI_MODEL_NLU=.*/AI_MODEL_NLU="gpt-4o-mini"/' .env
sed -i 's/^AI_PROVIDER_CHAT=.*/AI_PROVIDER_CHAT="OpenAI"/' .env || echo 'AI_PROVIDER_CHAT="OpenAI"' >> .env
sed -i 's/^AI_PROVIDER_NLU=.*/AI_PROVIDER_NLU="OpenAI"/' .env || echo 'AI_PROVIDER_NLU="OpenAI"' >> .env
sed -i 's/^AI_MODEL_FALLBACK=.*/AI_MODEL_FALLBACK="gpt-4o-mini"/' .env
sed -i 's/^AI_MODEL_FALLBACK_CHAIN=.*/AI_MODEL_FALLBACK_CHAIN="gpt-4o-mini"/' .env
sed -i 's/^SLOT_FILLING_ENGINE_ENABLED=.*/SLOT_FILLING_ENGINE_ENABLED=true/' .env
grep -E 'AI_MODEL|OPENAI_MODEL|AI_PROVIDER|SLOT_FILLING' .env
`;
  console.log(runSsh(updateEnvCmd));

  console.log('=== 3. Git Pull & Safe Rebuild App Container ===');
  const deployCmd = `
set -e
cd /opt/wa-clinic-bot
echo "--> Git Pull Latest Code..."
git pull origin master

echo "--> Build App Docker Image..."
docker compose build app

echo "--> Recreate App Container Safely (WAHA untouched)..."
docker compose up -d --no-deps app

echo "--> Check Docker Compose Status..."
docker compose ps
`;
  console.log(runSsh(deployCmd));

  console.log('=== 4. Check App Startup Logs ===');
  const logsCmd = `docker compose -f /opt/wa-clinic-bot/docker-compose.yml logs app --tail 40`;
  console.log(runSsh(logsCmd));

  console.log('\n✅ DEPLOYMENT TO LIVE SERVER FINISHED SUCCESSFULLY!');
}

deploy().catch(console.error);
