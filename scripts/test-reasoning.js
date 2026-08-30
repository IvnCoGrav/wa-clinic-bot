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
        'Authorization': 'Bearer sk-xPRgkZmQakNaOq44qqzPLw',
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
const sshCmd = `ssh -i C:/Users/Ivan/.ssh/id_ed25519_klinik -p 1403 -o StrictHostKeyChecking=no ubuntu@43.157.197.148 "${remoteCmd}"`;

try {
  console.log(execSync(sshCmd, { encoding: 'utf8' }));
} catch (e) {
  console.error('SSH error:', e.message);
}
