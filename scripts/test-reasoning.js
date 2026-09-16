const { execSync } = require('child_process');

const testCode = `
const axios = require('axios');

async function testDeepSeek() {
  console.log('\\n====================================================');
  console.log('TESTING MODEL: deepseek-v4-flash');
  console.log('====================================================');

  const start = Date.now();
  try {
    const res = await axios.post('https://ai.sumopod.com/v1/chat/completions', {
      model: 'deepseek-v4-flash',
      messages: [
        {
          role: 'system',
          content: 'Anda adalah Bidan Yusi dari Kala Moms and Baby Spa. Berikan analisis klinis dan rekomendasi.'
        },
        {
          role: 'user',
          content: 'Anak saya usia 2 bulan nafasnya grok-grok terus sering kembung dan gumoh. Sebaiknya treatment apa?'
        }
      ],
      max_tokens: 300,
      temperature: 0.5
    }, {
      headers: {
        'Authorization': 'Bearer ' + (process.env.LLM_API_KEY || ''),
        'Content-Type': 'application/json'
      },
      timeout: 20000
    });

    const elapsed = Date.now() - start;
    const choice = res.data.choices?.[0];
    const msg = choice?.message || {};

    console.log('Status: ' + res.status + ' OK in ' + elapsed + 'ms');
    console.log('Message Fields in Response:', Object.keys(msg));
    console.log('Has reasoning_content?:', !!msg.reasoning_content);
    if (msg.reasoning_content) {
      console.log('--- REASONING CONTENT ---');
      console.log(msg.reasoning_content.slice(0, 300));
    }
  } catch (err) {
    console.log('FAILED:', err.message);
  }
}

testDeepSeek();
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
