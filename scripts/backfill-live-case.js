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

const backfillScript = `
docker exec -i wa-clinic-bot-app-1 node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function backfill() {
  const c = await prisma.customer.findFirst({
    where: { phone: { contains: '81237904919' } }
  });
  if (!c) {
    console.log('Customer not found');
    return;
  }

  const updated = await prisma.customer.update({
    where: { id: c.id },
    data: {
      kelurahan: 'Urangagung',
      kecamatan: 'Sidoarjo (Kota)',
      kota: 'Kabupaten Sidoarjo',
      lat: -7.4335537,
      lng: 112.66605,
      distance_km: 18,
      ongkir: 20000,
      is_out_of_coverage: false,
      preferences: {
        ...(c.preferences || {}),
        distanceKm: 18,
        ongkirPromoFee: 20000,
        ongkirFee: 25000,
        selectedTreatmentName: 'Pijat Oksitosin',
        isOutOfCoverage: false
      }
    }
  });

  console.log('Successfully updated customer:', updated.phone);
  console.log('Location:', updated.kelurahan, updated.kecamatan, updated.kota);
  console.log('Distance & Ongkir:', updated.distance_km, 'km, Rp', updated.ongkir);
  console.log('Preferences:', updated.preferences);
}

backfill().catch(console.error).finally(() => prisma.\\$disconnect());
"
`;

console.log(runSsh(backfillScript));
