import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import fs from 'fs/promises';
import path from 'path';

function formatWib(date: Date): string {
  try {
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date);
  } catch (_) {
    return date.toISOString();
  }
}

async function main() {
  console.log('📦 [EXPORT TRANSKRIP] Mengambil seluruh riwayat percakapan dari database...\n');

  // Ambil semua customer dan percakapan (non-sandbox / data riil)
  const customers = await prisma.customer.findMany({
    where: {
      tenant_id: DEFAULT_TENANT_ID,
      is_sandbox_test: false,
    },
    include: {
      conversations: {
        include: {
          messages: {
            orderBy: { created_at: 'asc' },
          },
        },
      },
      reservations: {
        orderBy: { created_at: 'desc' },
        take: 3,
      },
      children: true,
      labels: {
        include: { label: true },
      },
    },
    orderBy: { updated_at: 'desc' },
  });

  console.log(`📋 Ditemukan ${customers.length} kontak WhatsApp pelanggan asli.`);

  let totalConversations = 0;
  let totalMessages = 0;
  let totalInbound = 0;
  let totalOutbound = 0;

  const lines: string[] = [];
  lines.push('# Transkrip Riwayat Lengkap Percakapan WhatsApp (Kala Moms & Baby Spa)');
  lines.push('');
  lines.push(`- **Tanggal Ekspor**: ${formatWib(new Date())} WIB`);
  lines.push(`- **Total Kontak Pelanggan**: ${customers.length} kontak`);
  lines.push('');
  lines.push('> Dokumen ini memuat seluruh riwayat percakapan chat WhatsApp yang telah disinkronkan ke dalam database, diurutkan per customer dengan metadata lengkap (nama, nomor, lokasi, status eskalasi, reservasi, data anak, dan seluruh bubble pesan masuk & keluar).');
  lines.push('');
  lines.push('---');
  lines.push('');

  let index = 0;
  for (const customer of customers) {
    index++;
    const convs = customer.conversations;
    const allMessages = convs.flatMap((c) => c.messages).sort((a, b) => a.created_at.getTime() - b.created_at.getTime());

    totalConversations += convs.length;
    totalMessages += allMessages.length;

    const labelNames = customer.labels.map((l) => l.label.name).join(', ') || '-';
    const childNames = customer.children.map((ch) => `${ch.name} (${ch.raw_age_text || 'usia tidak tercatat'})`).join(', ') || '-';
    const reservationSummary = customer.reservations.map((r) => `${r.treatment_detail || r.treatment_category} [Status: ${r.status}]`).join('; ') || '-';

    lines.push(`## #${index}. ${customer.name || '(Nama belum tercatat)'} — \`${customer.phone}\``);
    lines.push('');
    lines.push(`- **Nama Kontak**: ${customer.name || '-'}`);
    lines.push(`- **Nomor WhatsApp**: \`${customer.phone}\``);
    lines.push(`- **Kelurahan / Kecamatan**: ${customer.kelurahan || '-'} / ${customer.kecamatan || '-'}`);
    lines.push(`- **Alamat / Kota**: ${customer.kota || '-'}`);
    lines.push(`- **Estimasi Jarak & Ongkir**: ${customer.distance_km ? `${customer.distance_km.toFixed(1)} km` : '-'} | ${customer.ongkir ? `Rp ${customer.ongkir.toLocaleString('id-ID')}` : '-'}`);
    lines.push(`- **Data Anak**: ${childNames}`);
    lines.push(`- **Riwayat Reservasi**: ${reservationSummary}`);
    lines.push(`- **Label**: \`${labelNames}\``);
    lines.push(`- **Total Pesan**: ${allMessages.length} bubble`);
    lines.push('');

    if (allMessages.length === 0) {
      lines.push('*_Tidak ada pesan tersimpan untuk kontak ini._*');
      lines.push('');
    } else {
      lines.push('### 💬 Riwayat Percakapan:');
      lines.push('');

      for (const msg of allMessages) {
        const timeStr = formatWib(msg.created_at);
        const isOutbound = msg.direction === 'OUTBOUND';
        if (isOutbound) totalOutbound++;
        else totalInbound++;

        let senderTag = '👤 [CUSTOMER]';
        if (isOutbound) {
          if (msg.sender_type === 'ADMIN' || msg.sender_name?.includes('Admin') || msg.sender_name?.includes('Staff')) {
            senderTag = `👩‍⚕️ [ADMIN/STAFF: ${msg.sender_name || 'Admin'}]`;
          } else {
            senderTag = '🤖 [BOT AI]';
          }
        }

        // Format bubble chat
        lines.push(`> **${senderTag}** \`[${timeStr}]\``);
        const cleanContent = msg.content.trim().replace(/\n/g, '\n> ');
        lines.push(`> ${cleanContent}`);
        lines.push('>');
      }
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  }

  // Tambahkan ringkasan di paling atas
  lines.splice(4, 0, `- **Total Percakapan**: ${totalConversations}`);
  lines.splice(5, 0, `- **Total Pesan Chat**: ${totalMessages.toLocaleString('id-ID')} bubble (${totalInbound.toLocaleString('id-ID')} masuk / ${totalOutbound.toLocaleString('id-ID')} keluar)`);

  const outputDir = path.join(process.cwd(), 'exports');
  await fs.mkdir(outputDir, { recursive: true });

  const exportFilePath = path.join(outputDir, 'TRANSKRIP_LENGKAP_SEMUA_CHAT.md');
  await fs.writeFile(exportFilePath, lines.join('\n'), 'utf8');

  console.log('\n======================================================');
  console.log('🎉 [EXPORT SELESAI 100%]');
  console.log(`📁 File Berhasil Disimpan ke: ${exportFilePath}`);
  console.log(`📊 Statistik:`);
  console.log(`   - Total Kontak Pelanggan : ${customers.length}`);
  console.log(`   - Total Pesan Chat       : ${totalMessages.toLocaleString('id-ID')} pesan`);
  console.log(`   - Pesan Masuk (Customer) : ${totalInbound.toLocaleString('id-ID')} pesan`);
  console.log(`   - Pesan Keluar (Admin/Bot): ${totalOutbound.toLocaleString('id-ID')} pesan`);
  console.log('======================================================\n');
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
