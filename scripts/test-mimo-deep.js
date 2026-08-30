const { execSync } = require('child_process');

const testCode = `
const axios = require('axios');

async function testMimo() {
  console.log('====================================================');
  console.log('TESTING MODEL: mimo-v2.5 (REASONING & RESPONSE TEST)');
  console.log('====================================================');

  const start = Date.now();
  try {
    const res = await axios.post('https://ai.sumopod.com/v1/chat/completions', {
      model: 'mimo-v2.5',
      messages: [
        {
          role: 'system',
          content: 'Anda adalah Bidan Yusi dari Kala Moms and Baby Spa. Jelaskan secara klinis dan hangat rekomendasi untuk bayi.'
        },
        {
          role: 'user',
          content: 'Anak saya usia 2 bulan nafasnya grok-grok terus sering kembung dan gumoh. Sebaiknya treatment apa?'
        }
      ],
      max_tokens: 400,
      temperature: 0.5
    }, {
      headers: {
        'Authorization': 'Bearer sk-xPRgkZmQakNaOq44qqzPLw',
        'Content-Type': 'application/json'
      },
      timeout: 25000
    });

    const elapsed = Date.now() - start;
    const choice = res.data.choices?.[0];
    const msg = choice?.message || {};

    console.log('Status: ' + res.status + ' ' + res.statusText + ' (' + elapsed + 'ms)');
    console.log('Message Fields:', Object.keys(msg));
    console.log('Has reasoning_content?:', !!msg.reasoning_content);
    if (msg.reasoning_content) {
      console.log('\\n[REASONING_CONTENT (CHAIN OF THOUGHT)]:\\n' + msg.reasoning_content);
    }
    console.log('\\n[CONTENT FINAL]:\\n' + msg.content);
    console.log('\\nUSAGE:', JSON.stringify(res.data.usage));
  } catch (err) {
    const elapsed = Date.now() - start;
    console.log('FAILED in ' + elapsed + 'ms: ' + err.message);
    if (err.response) {
      console.log('STATUS:', err.response.status, 'DATA:', JSON.stringify(err.response.data));
    }
  }
}

testMimo();
`;

const b64 = Buffer.from(testCode).toString('base64');
const remoteCmd = `echo ${b64} | base64 -d | docker compose -f /opt/wa-clinic-bot/docker-compose.yml exec -T app node`;
const sshCmd = `ssh -i C:/Users/Ivan/.ssh/id_ed25519_klinik -p 1403 -o StrictHostKeyChecking=no ubuntu@43.157.197.148 "${remoteCmd}"`;

try {
  console.log(execSync(sshCmd, { encoding: 'utf8' }));
} catch (e) {
  console.error('SSH error:', e.message);
}
