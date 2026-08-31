const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

function resolveSshKey() {
  if (process.env.SSH_KEY_PATH && fs.existsSync(process.env.SSH_KEY_PATH)) {
    return process.env.SSH_KEY_PATH;
  }
  const candidates = [
    path.join(os.homedir(), '.ssh', 'id_ed25519_klinik'),
    path.join(os.homedir(), '.ssh', 'id_ed25519'),
    path.join(os.homedir(), '.ssh', 'id_rsa'),
    'C:/Users/User/.ssh/id_ed25519_klinik',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}

function runSsh(command) {
  const sshKey = resolveSshKey();
  const b64 = Buffer.from(command).toString('base64');
  const sshCmd = `ssh -i "${sshKey}" -p 1403 -o StrictHostKeyChecking=no ubuntu@43.157.197.148 "echo ${b64} | base64 -d | bash"`;
  return execSync(sshCmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
}

const checkScript = `
docker exec -i wa-clinic-bot-app-1 node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const c = await prisma.customer.findFirst({
    where: { phone: { contains: '81237904919' } }
  });
  console.log('Customer Data for 6281237904919:');
  console.log('ID:', c.id);
  console.log('Phone:', c.phone);
  console.log('Kelurahan:', c.kelurahan);
  console.log('Kecamatan:', c.kecamatan);
  console.log('Kota:', c.kota);
  console.log('Distance:', c.distance_km, 'km');
  console.log('Ongkir:', c.ongkir);
  console.log('Preferences:', c.preferences);
}

check().catch(console.error).finally(() => prisma.\\$disconnect());
"
`;

console.log(runSsh(checkScript));
