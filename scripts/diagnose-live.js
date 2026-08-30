const { execSync } = require('child_process');

function runRemoteBash(bashScript) {
  const b64 = Buffer.from(bashScript).toString('base64');
  const sshCmd = `ssh -i C:/Users/Ivan/.ssh/id_ed25519_klinik -p 1403 -o StrictHostKeyChecking=no ubuntu@43.157.197.148 "echo ${b64} | base64 -d | bash"`;
  return execSync(sshCmd, { encoding: 'utf8' });
}

const checkScript = `
cd /opt/wa-clinic-bot
echo "=== ENV IN FILE ==="
grep -E 'OPENAI_BASE_URL|LLM_API_KEY|OPENAI_MODEL|AI_MODEL|LLM_FALLBACK' .env | sed 's/KEY=.*/KEY=REDACTED/'

echo "=== TEST API CALL FROM INSIDE APP CONTAINER ==="
docker compose exec -T app node -e "
const dotenv = require('dotenv');
dotenv.config();
const { callChatCompletionsWithFallback } = require('./dist/integrations/llm/model-fallback');
const { getLlmEndpointConfig } = require('./dist/integrations/llm/llm-gateway');

async function testCall() {
  const ep = getLlmEndpointConfig();
  console.log('Endpoint config:', {
    baseUrl: ep.baseUrl,
    model: ep.model,
    hasApiKey: !!ep.apiKey,
    keyPrefix: ep.apiKey ? ep.apiKey.slice(0, 7) + '...' : 'none',
  });

  try {
    const res = await callChatCompletionsWithFallback({
      baseUrl: ep.baseUrl,
      apiKey: ep.apiKey,
      model: ep.model,
      fallbackModel: ep.fallbackModel,
      payload: {
        messages: [{ role: 'user', content: 'Halo, ini tes singkat' }],
        max_tokens: 20
      }
    });
    console.log('Test call SUCCESS! Model used:', res.model, 'Reply:', res.data.choices[0].message.content);
  } catch (err) {
    console.error('Test call FAILED:', err.message);
    if (err.response) {
      console.error('Status:', err.response.status, 'Data:', err.response.data);
    }
  }
}
testCall();
"
`;

console.log(runRemoteBash(checkScript));
