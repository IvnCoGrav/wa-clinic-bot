const { execSync } = require('child_process');

const testCode = `
const { EntityExtractor } = require('./dist/slot-engine/entity-extractor');

async function testMiniMaxExtractor() {
  console.log('=== TESTING ENTITY EXTRACTOR WITH MINIMAX-M2.7-HIGHSPEED ===');
  
  const testInputs = [
    'Anak saya usia 2 bulan, nafasnya grok-grok terus sering kembung sama gumoh',
    'Di daerah kebraon surabaya gang 5 nomor 12',
    'Boleh bund mau ambil paket pijat pulih ceria untuk hari sabtu jam 10 pagi'
  ];

  for (const input of testInputs) {
    console.log('\\n--- Input: "' + input + '" ---');
    const start = Date.now();
    try {
      const res = await EntityExtractor.extract(input, {
        customerPhone: '6288235780925',
        tenantId: 'default-tenant',
        modelOverride: 'MiniMax-M2.7-highspeed'
      });
      const elapsed = Date.now() - start;
      console.log('Extracted in ' + elapsed + 'ms:');
      console.log(JSON.stringify(res, null, 2));
    } catch (err) {
      console.log('Extraction Error:', err.message);
    }
  }
}

testMiniMaxExtractor();
`;

const b64 = Buffer.from(testCode).toString('base64');
const remoteCmd = `echo ${b64} | base64 -d | docker compose -f /opt/wa-clinic-bot/docker-compose.yml exec -T app node`;
const sshCmd = `ssh -i C:/Users/Ivan/.ssh/id_ed25519_klinik -p 1403 -o StrictHostKeyChecking=no ubuntu@43.157.197.148 "${remoteCmd}"`;

try {
  console.log(execSync(sshCmd, { encoding: 'utf8' }));
} catch (e) {
  console.error('SSH error:', e.message);
}
