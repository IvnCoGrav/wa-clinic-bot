const { execSync } = require('child_process');

const testCode = `
const { processSlotEngine } = require('./dist/slot-engine/slot-engine');

async function testFullSlotEngine() {
  console.log('=== TESTING FULL SLOT ENGINE PIPELINE WITH MINIMAX ===');

  const mockCtx = {
    customer: {
      id: 'cust_live_test_minimax',
      phone: '6288235780925',
      name: 'Bunda Melati',
      tenant_id: 'default-tenant',
      kelurahan: 'Pradah Kalikendal',
      kecamatan: 'Dukuh Pakis',
      kota: 'Kota Surabaya',
      lat: -7.281,
      lng: 112.684,
      pricelist_sent: true,
      preferences: {
        childAgeMonths: 2,
        childAgeCategory: 'BABY',
        distanceKm: 16.99,
        ongkirPromoFee: 20000,
      },
    },
    conversation: {
      id: 'conv_live_test_minimax',
      current_state: 'AWAITING_INTEREST',
      is_human_handling: false,
    },
    incomingMessage: {
      text: { body: 'Anak saya 2 bulan grok-grok terus sering kembung sama gumoh' }
    },
    tenantId: 'default-tenant',
  };

  const start = Date.now();
  const res = await processSlotEngine(mockCtx);
  const elapsed = Date.now() - start;

  console.log('Processed in ' + elapsed + 'ms');
  console.log('Should Send Reply:', res.shouldSendReply);
  console.log('Next State:', res.nextState);
  console.log('Bot Reply:');
  console.log('"' + res.replyText + '"');
}

testFullSlotEngine().catch(console.error);
`;

const b64 = Buffer.from(testCode).toString('base64');
const remoteCmd = `echo ${b64} | base64 -d | docker compose -f /opt/wa-clinic-bot/docker-compose.yml exec -T app node`;
const sshCmd = `ssh -i C:/Users/Ivan/.ssh/id_ed25519_klinik -p 1403 -o StrictHostKeyChecking=no ubuntu@43.157.197.148 "${remoteCmd}"`;

try {
  console.log(execSync(sshCmd, { encoding: 'utf8' }));
} catch (e) {
  console.error('SSH error:', e.message);
}
