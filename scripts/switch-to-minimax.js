const { execSync } = require('child_process');

function runSsh(cmd) {
  const b64 = Buffer.from(cmd).toString('base64');
  const sshCmd = `ssh -i C:/Users/Ivan/.ssh/id_ed25519_klinik -p 1403 -o StrictHostKeyChecking=no ubuntu@43.157.197.148 "echo ${b64} | base64 -d | bash"`;
  return execSync(sshCmd, { encoding: 'utf8' });
}

const sql = `
UPDATE tenant_ai_config 
SET model_name = 'MiniMax-M2.7-highspeed', provider = 'MiniMax', updated_at = NOW() 
WHERE task IN ('CHAT_REPLY', 'INTENT_CLASSIFICATION', 'SUMMARIZATION', 'PII_SCRUBBING', 'AI_VERIFIER');

SELECT task, model_name, provider FROM tenant_ai_config;
`;

const sqlB64 = Buffer.from(sql).toString('base64');
const remoteDbCmd = `echo ${sqlB64} | base64 -d | docker compose -f /opt/wa-clinic-bot/docker-compose.yml exec -T postgres psql -U postgres -d wa_clinic_db`;

console.log('=== UPDATING LIVE DB TENANT AI CONFIG TO MINIMAX ===');
console.log(runSsh(remoteDbCmd));

const updateEnvCmd = `
cd /opt/wa-clinic-bot
sed -i 's/^OPENAI_MODEL=.*/OPENAI_MODEL="MiniMax-M2.7-highspeed"/' .env
sed -i 's/^AI_MODEL_CHAT=.*/AI_MODEL_CHAT="MiniMax-M2.7-highspeed"/' .env
sed -i 's/^AI_MODEL_NLU=.*/AI_MODEL_NLU="MiniMax-M2.7-highspeed"/' .env
sed -i 's/^AI_PROVIDER_CHAT=.*/AI_PROVIDER_CHAT="MiniMax"/' .env
sed -i 's/^AI_PROVIDER_NLU=.*/AI_PROVIDER_NLU="MiniMax"/' .env
sed -i 's/^AI_MODEL_FALLBACK_CHAIN=.*/AI_MODEL_FALLBACK_CHAIN="deepseek-v4-flash,qwen3.7-flash-2026-07-15"/' .env
sed -i 's/^AI_MODEL_FALLBACK=.*/AI_MODEL_FALLBACK="deepseek-chat"/' .env
sed -i 's/^LLM_FALLBACK_BASE_URL=.*/LLM_FALLBACK_BASE_URL="https:\\/\\/api.deepseek.com"/' .env
grep -E 'AI_MODEL|OPENAI_MODEL|AI_PROVIDER' .env
`;

console.log('=== UPDATING LIVE .ENV TO MINIMAX + MULTI-MODEL FALLBACK ===');
console.log(runSsh(updateEnvCmd));
