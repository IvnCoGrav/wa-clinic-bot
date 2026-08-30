const { execSync } = require('child_process');

const testCode = `
const axios = require('axios');

async function testModel(modelName) {
  console.log('\\n=== TESTING ' + modelName + ' ON SUMOPOD API ===');
  const start = Date.now();
  try {
    const res = await axios.post('https://ai.sumopod.com/v1/chat/completions', {
      model: modelName,
      messages: [
        { role: 'system', content: 'Anda adalah Bidan Yusi dari Kala Moms & Baby Spa.' },
        { role: 'user', content: 'Berapa durasi pijat bayi per anak ya Bunda?' }
      ],
      max_tokens: 150,
      temperature: 0.5
    }, {
      headers: {
        'Authorization': 'Bearer sk-xPRgkZmQakNaOq44qqzPLw',
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    const elapsed = Date.now() - start;
    console.log('STATUS: ' + res.status + ' OK in ' + elapsed + 'ms');
    console.log('REPLY: ' + res.data.choices[0].message.content.trim());
  } catch (err) {
    const elapsed = Date.now() - start;
    console.log('FAILED after ' + elapsed + 'ms: ' + err.message);
  }
}

async function run() {
  await testModel('MiniMax-M2.7-highspeed');
  await testModel('deepseek-v4-flash');
}
run();
`;

const b64 = Buffer.from(testCode).toString('base64');
const remoteCmd = `echo ${b64} | base64 -d | docker compose -f /opt/wa-clinic-bot/docker-compose.yml exec -T app node`;
const sshCmd = `ssh -i C:/Users/Ivan/.ssh/id_ed25519_klinik -p 1403 -o StrictHostKeyChecking=no ubuntu@43.157.197.148 "${remoteCmd}"`;

try {
  console.log(execSync(sshCmd, { encoding: 'utf8' }));
} catch (e) {
  console.error('SSH error:', e.message);
}
