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

const queryCode = `
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const phone = '6281237904919';
  const cust = await prisma.customer.findFirst({
    where: { phone: { contains: '81237904919' } },
    include: {
      children: true,
      reservations: {
        orderBy: { created_at: 'desc' }
      },
      conversations: {
        include: {
          messages: {
            orderBy: { created_at: 'asc' }
          }
        }
      }
    }
  });

  if (!cust) {
    console.log('Customer not found with phone:', phone);
    return;
  }

  console.log('=== CUSTOMER INFO ===');
  console.log('ID:', cust.id);
  console.log('Name:', cust.name);
  console.log('Phone:', cust.phone);
  console.log('Address:', cust.address);
  console.log('Location:', {
    kelurahan: cust.kelurahan,
    kecamatan: cust.kecamatan,
    kota: cust.kota,
    lat: cust.latitude,
    lng: cust.longitude,
    pending_kelurahan: cust.pending_kelurahan,
    pending_kecamatan: cust.pending_kecamatan,
    pending_kota: cust.pending_kota,
    pending_lat: cust.pending_lat,
    pending_lng: cust.pending_lng,
  });
  console.log('Children:', JSON.stringify(cust.children, null, 2));
  console.log('Reservations Count:', cust.reservations.length);
  console.log('Reservations:', JSON.stringify(cust.reservations, null, 2));

  console.log('=== CONVERSATIONS ===');
  for (const conv of cust.conversations) {
    console.log('Conversation ID:', conv.id);
    console.log('State:', conv.current_state, '| Prev State:', conv.previous_state);
    console.log('Is Human Handling:', conv.is_human_handling, '| Reason:', conv.escalation_reason);
    console.log('Last Discussed Treatment:', conv.last_discussed_treatment);
    console.log('Messages Count:', conv.messages.length);
    console.log('--- MESSAGES ---');
    for (const msg of conv.messages) {
      console.log(\`[\${msg.created_at.toISOString()}] \${msg.direction} (\${msg.sender_name || msg.sender_type || ''}): \${msg.content}\`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
`;

const serverCommand = `
echo "=== SEARCH SERVER LOGS FOR CONVERSATION fa1836e3 ==="
docker compose -f /opt/wa-clinic-bot/docker-compose.yml logs app --tail 20000 | grep -E "fa1836e3|81237904919|Urangagung" || true
`;

console.log(runSsh(serverCommand));
