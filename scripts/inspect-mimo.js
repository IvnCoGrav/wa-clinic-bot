const { execSync } = require('child_process');

const testCode = `
const axios = require('axios');

async function inspectModels() {
  const baseUrls = [
    'https://ai.sumopod.com/v1',
    'https://api.sumopod.com/v1',
    'https://api.sumopod.com'
  ];

  const apiKey = process.env.LLM_API_KEY || '';
  if (!apiKey) {
    console.error('ERROR: LLM_API_KEY environment variable is not defined.');
    process.exit(1);
  }

  for (const url of baseUrls) {
    try {
      const res = await axios.get(url + '/models', {
        headers: { 'Authorization': 'Bearer ' + apiKey },
        timeout: 5000
      });
      console.log('=== MODELS FROM ' + url + ' ===');
      console.log(res.data.data ? res.data.data.map(m => m.id) : res.data);
    } catch (err) {
      console.log('ERR from ' + url + ': ' + err.message + (err.response ? ' (' + err.response.status + ')' : ''));
    }
  }

  const modelVariations = [
    'mimo-v2.5',
    'mimo-v2',
    'mimo-2.5',
    'mimo-v2-flash',
    'mimo-v2.5-flash',
    'mimo-v2.5-pro',
    'mimo-flash',
    'mimo'
  ];

  console.log('\\n=== TESTING MIMO MODEL VARIATIONS ===');
  for (const m of modelVariations) {
    try {
      const res = await axios.post('https://ai.sumopod.com/v1/chat/completions', {
        model: m,
        messages: [{ role: 'user', content: 'hi' }]
      }, {
        headers: {
          'Authorization': 'Bearer ' + apiKey,
          'Content-Type': 'application/json'
        },
        timeout: 5000
      });
      console.log('MODEL [' + m + ']: SUCCESS (200 OK)');
    } catch (err) {
      const status = err.response ? err.response.status : 'ERR';
      const msg = err.response && err.response.data && err.response.data.error ? err.response.data.error.message : err.message;
      console.log('MODEL [' + m + ']: ' + status + ' -> ' + msg);
    }
  }
}

inspectModels();
`;

const b64 = Buffer.from(testCode).toString('base64');
const remoteCmd = `echo ${b64} | base64 -d | docker compose -f /opt/wa-clinic-bot/docker-compose.yml exec -T app node`;
const sshKey = process.env.SSH_KEY_PATH || 'C:/Users/Ivan/.ssh/id_ed25519_klinik';
const deployHost = process.env.DEPLOY_HOST || '43.157.197.148';
const deployPort = process.env.DEPLOY_PORT || '1403';
const sshCmd = `ssh -i "${sshKey}" -p ${deployPort} -o StrictHostKeyChecking=no ubuntu@${deployHost} "${remoteCmd}"`;

try {
  console.log(execSync(sshCmd, { encoding: 'utf8' }));
} catch (e) {
  console.error('SSH error:', e.message);
}
