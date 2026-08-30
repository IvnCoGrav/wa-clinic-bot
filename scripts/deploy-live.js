const { execSync } = require('child_process');

function runSsh(cmd) {
  const b64 = Buffer.from(cmd).toString('base64');
  const sshCmd = `ssh -i C:/Users/Ivan/.ssh/id_ed25519_klinik -p 1403 -o StrictHostKeyChecking=no ubuntu@43.157.197.148 "echo ${b64} | base64 -d | bash"`;
  return execSync(sshCmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
}

console.log('=== 1. PULLING LATEST CODE ON SERVER ===');
console.log(runSsh('cd /opt/wa-clinic-bot && git pull origin master'));

console.log('=== 2. UPDATING .ENV CONFIG ON SERVER ===');
const updateEnvCmd = `
cd /opt/wa-clinic-bot
sed -i 's/^OPENAI_MODEL=.*/OPENAI_MODEL="gpt-4o-mini"/' .env
sed -i 's/^AI_MODEL_CHAT=.*/AI_MODEL_CHAT="gpt-4o-mini"/' .env
sed -i 's/^AI_PROVIDER_CHAT=.*/AI_PROVIDER_CHAT="OpenAI"/' .env
grep -q "^AI_MODEL_CHAT_DEEP=" .env && sed -i 's/^AI_MODEL_CHAT_DEEP=.*/AI_MODEL_CHAT_DEEP="mimo-v2.5"/' .env || echo 'AI_MODEL_CHAT_DEEP="mimo-v2.5"' >> .env
grep -q "^AI_PROVIDER_CHAT_DEEP=" .env && sed -i 's/^AI_PROVIDER_CHAT_DEEP=.*/AI_PROVIDER_CHAT_DEEP="Mimo"/' .env || echo 'AI_PROVIDER_CHAT_DEEP="Mimo"' >> .env
sed -i 's/^AI_MODEL_NLU=.*/AI_MODEL_NLU="MiniMax-M2.7-highspeed"/' .env
sed -i 's/^AI_PROVIDER_NLU=.*/AI_PROVIDER_NLU="MiniMax"/' .env
sed -i 's/^AI_MODEL_SUMMARIZATION=.*/AI_MODEL_SUMMARIZATION="MiniMax-M2.7-highspeed"/' .env
sed -i 's/^AI_PROVIDER_SUMMARIZATION=.*/AI_PROVIDER_SUMMARIZATION="MiniMax"/' .env
sed -i 's/^AI_MODEL_PII=.*/AI_MODEL_PII="MiniMax-M2.7-highspeed"/' .env
sed -i 's/^AI_PROVIDER_PII=.*/AI_PROVIDER_PII="MiniMax"/' .env
sed -i 's/^AI_MODEL_FALLBACK_CHAIN=.*/AI_MODEL_FALLBACK_CHAIN="MiniMax-M2.7-highspeed,mimo-v2.5,qwen3.7-flash-2026-07-15,deepseek-v4-flash"/' .env
sed -i 's/^AI_MODEL_FALLBACK=.*/AI_MODEL_FALLBACK="deepseek-chat"/' .env
sed -i 's/^LLM_FALLBACK_BASE_URL=.*/LLM_FALLBACK_BASE_URL="https:\\/\\/api.deepseek.com"/' .env
grep -E 'AI_MODEL|OPENAI_MODEL|AI_PROVIDER' .env
`;
console.log(runSsh(updateEnvCmd));

console.log('=== 3. UPDATING POSTGRES TENANT AI CONFIG ON SERVER ===');
const sqlCmd = `
UPDATE tenant_ai_config SET model_name = 'MiniMax-M2.7-highspeed', provider = 'MiniMax', updated_at = NOW() WHERE task = 'INTENT_CLASSIFICATION';
UPDATE tenant_ai_config SET model_name = 'gpt-4o-mini', provider = 'OpenAI', updated_at = NOW() WHERE task = 'CHAT_REPLY';
UPDATE tenant_ai_config SET model_name = 'mimo-v2.5', provider = 'Mimo', updated_at = NOW() WHERE task = 'CHAT_REPLY_DEEP';
UPDATE tenant_ai_config SET model_name = 'MiniMax-M2.7-highspeed', provider = 'MiniMax', updated_at = NOW() WHERE task IN ('SUMMARIZATION', 'PII_SCRUBBING');

SELECT task, model_name, provider FROM tenant_ai_config ORDER BY task;
`;
const sqlB64 = Buffer.from(sqlCmd).toString('base64');
console.log(runSsh(`echo ${sqlB64} | base64 -d | docker compose -f /opt/wa-clinic-bot/docker-compose.yml exec -T postgres psql -U postgres -d wa_clinic_db`));

console.log('=== 4. REBUILDING AND RESTARTING APP CONTAINER (WAHA UNTOUCHED) ===');
console.log(runSsh('cd /opt/wa-clinic-bot && docker compose build app && docker compose up -d --no-deps app'));
