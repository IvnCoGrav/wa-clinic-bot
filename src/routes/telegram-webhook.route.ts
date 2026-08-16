import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client';
import { telegramService } from '../services/telegram.service';
import dotenv from 'dotenv';
dotenv.config();

export async function telegramWebhookRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/webhook/telegram
   * Simple health check endpoint for Telegram webhook verification
   */
  fastify.get('/api/webhook/telegram', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({
      status: 'ok',
      service: 'telegram-webhook',
      bot: process.env.TELEGRAM_BOT_USERNAME || 'configured',
    });
  });

  /**
   * POST /api/webhook/telegram (and alias /api/telegram/webhook)
   * Handles inbound updates from Telegram Bot API
   */
  const handleWebhook = async (request: FastifyRequest, reply: FastifyReply) => {
    // 1. Optional Secret Token validation
    const secretTokenHeader = request.headers['x-telegram-bot-api-secret-token'];
    const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (expectedSecret && secretTokenHeader !== expectedSecret) {
      return reply.status(403).send({ error: 'Unauthorized: Invalid Telegram secret token' });
    }

    const body = request.body as any;
    const message = body?.message || body?.edited_message;

    if (!message || !message.text) {
      return reply.status(200).send({ ok: true, ignored: 'no text message' });
    }

    const text = message.text.trim();
    const chatId = String(message.chat?.id);
    const chatTitle = message.chat?.title || message.chat?.first_name || 'Chat';
    const isGroup = message.chat?.type === 'group' || message.chat?.type === 'supergroup';
    const messageThreadId = message.message_thread_id ? String(message.message_thread_id) : undefined;
    const senderName = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ') || 'Admin';

    // -----------------------------------------------------------------------------------------
    // 1. Command: /start [PAIRING_TOKEN] (Deep Link Binding)
    // -----------------------------------------------------------------------------------------
    const startMatch = text.match(/^\/start(?:@\w+)?(?:\s+(\S+))?$/i);
    if (startMatch) {
      const pairingToken = startMatch[1]?.trim();

      if (!pairingToken) {
        // Plain /start without token
        await telegramService.sendMessage({
          chatId,
          messageThreadId,
          text: `👋 *Halo, ${senderName}!*

Saya adalah *Bot Notifikasi & Laporan Operasional Klinik*.

Untuk menghubungkan bot ini dengan klinik Anda di sistem SaaS:
1. Buka *Admin Dashboard* klinik Anda.
2. Masuk ke menu *Pengaturan > Laporan Operasional Harian*.
3. Klik tombol *Hubungkan ke Chat Pribadi* atau *Hubungkan ke Grup*.

_Jika Anda butuh bantuan lebih lanjut, hubungi tim support sistem._`,
        });
        return reply.status(200).send({ ok: true });
      }

      // Check if pairing token belongs to a Staff/Therapist
      const staff = await prisma.staff.findUnique({
        where: { telegram_pairing_token: pairingToken },
      });

      if (staff) {
        await prisma.staff.update({
          where: { id: staff.id },
          data: { telegram_chat_id: chatId },
        });

        await telegramService.sendMessage({
          chatId,
          messageThreadId,
          text: `🎉 *Koneksi Berhasil, ${staff.name}!*

Akun Telegram pribadi Anda telah berhasil dihubungkan dengan sistem penugasan klinik.

📲 *Notifikasi Tugas Lapangan:*
Setiap kali ada jadwal kunjungan atau reservasi pasien baru yang ditugaskan kepada Anda, detail lengkap (nama pasien, anak, alamat, patokan rumah, navigasi Google Maps motor, dan rincian biaya) akan otomatis dikirimkan ke obrolan ini. ✨

_Semoga berkah dan lancar dalam memberikan pelayanan terbaik!_`,
        });

        return reply.status(200).send({ ok: true, staffId: staff.id, boundChat: chatId });
      }

      // Look up tenant by pairing token
      const tenant = await prisma.tenant.findUnique({
        where: { telegram_pairing_token: pairingToken },
      });

      if (!tenant) {
        await telegramService.sendMessage({
          chatId,
          messageThreadId,
          text: `⚠️ *Token Pairing Tidak Dikenali*

Token \`${pairingToken}\` tidak valid atau sudah diganti. Silakan periksa kembali tautan di Admin Dashboard / Portal Staf klinik Anda.`,
        });
        return reply.status(200).send({ ok: true });
      }

      // Update tenant chat ID and optionally topic if paired inside a topic
      const combinedChatId = messageThreadId ? `${chatId}:${messageThreadId}` : chatId;
      const updateData: any = {
        telegram_chat_id: combinedChatId,
      };
      if (messageThreadId) {
        updateData.telegram_topic_daily_report = messageThreadId;
      }

      await prisma.tenant.update({
        where: { id: tenant.id },
        data: updateData,
      });

      const tenantName = tenant.name || 'Klinik Anda';
      const destinationType = isGroup ? `Grup *${chatTitle}*` : 'Chat Pribadi ini';

      await telegramService.sendMessage({
        chatId,
        messageThreadId,
        text: `🎉 *Koneksi Berhasil!*

Bot Telegram ini telah sukses dihubungkan dengan *${tenantName}* (${destinationType}).

📊 *Pengiriman Laporan & Alert:*
• Laporan harian & eskalasi penting akan dikirimkan otomatis ke sini.
${
  isGroup
    ? `
💡 *Fitur Topik / Forum Telegram:*
Jika grup ini memiliki sub-topik terpisah, Anda dapat memindahkan jenis laporan ke topik tertentu:
• Ketik \`/set_daily_report\` di sub-topik khusus Laporan Harian.
• Ketik \`/set_error_alerts\` di sub-topik khusus Error & Gangguan Server.
• Ketik \`/set_medical_alerts\` di sub-topik khusus Eskalasi Medis Bidan.
• Ketik \`/status_telegram\` untuk melihat status pengaturan saat ini.`
    : ''
}

_Pengaturan juga dapat Anda pantau langsung dari Admin Dashboard._`,
      });

      return reply.status(200).send({ ok: true, tenantId: tenant.id, boundChat: combinedChatId });
    }

    // -----------------------------------------------------------------------------------------
    // Helper: Find Tenant associated with this Chat ID
    // -----------------------------------------------------------------------------------------
    const findTenantForChat = async () => {
      // Check exact match or base chatId before ':'
      const tenants = await prisma.tenant.findMany({
        where: {
          telegram_chat_id: { not: null },
        },
      });

      return tenants.find((t) => {
        if (!t.telegram_chat_id) return false;
        const [baseId] = t.telegram_chat_id.split(':');
        return baseId === chatId || t.telegram_chat_id === chatId;
      });
    };

    // -----------------------------------------------------------------------------------------
    // 2. Command: /set_daily_report (or /report_here / /reportDailyHere)
    // -----------------------------------------------------------------------------------------
    if (
      /^\/(?:set_daily_report|set_report|report_here|reportdailyhere)(?:@\w+)?$/i.test(text)
    ) {
      const tenant = await findTenantForChat();
      if (!tenant) {
        await telegramService.sendMessage({
          chatId,
          messageThreadId,
          text: `⚠️ *Grup Belum Terhubung ke Klinik*

Silakan hubungkan grup ini terlebih dahulu melalui tombol *Hubungkan ke Telegram* di Admin Dashboard klinik Anda.`,
        });
        return reply.status(200).send({ ok: true });
      }

      const newCombinedChatId = messageThreadId ? `${chatId}:${messageThreadId}` : chatId;
      await prisma.tenant.update({
        where: { id: tenant.id },
        data: {
          telegram_topic_daily_report: messageThreadId || null,
          telegram_chat_id: newCombinedChatId,
        },
      });

      const topicDesc = messageThreadId ? `Sub-Topik #${messageThreadId}` : 'Chat Utama Grup';
      await telegramService.sendMessage({
        chatId,
        messageThreadId,
        text: `✅ *Topik Laporan Harian Ditetapkan!*

*${tenant.name || 'Klinik'}* sekarang akan menerima *Laporan Operasional Harian* di *${topicDesc}*.`,
      });
      return reply.status(200).send({ ok: true });
    }

    // -----------------------------------------------------------------------------------------
    // 3. Command: /set_error_alerts (or /error_here / /set_errors)
    // -----------------------------------------------------------------------------------------
    if (
      /^\/(?:set_error_alerts|set_errors|error_here|errordailyhere)(?:@\w+)?$/i.test(text)
    ) {
      const tenant = await findTenantForChat();
      if (!tenant) {
        await telegramService.sendMessage({
          chatId,
          messageThreadId,
          text: `⚠️ *Grup Belum Terhubung ke Klinik*

Silakan hubungkan grup ini terlebih dahulu melalui Admin Dashboard klinik Anda.`,
        });
        return reply.status(200).send({ ok: true });
      }

      await prisma.tenant.update({
        where: { id: tenant.id },
        data: {
          telegram_topic_system_errors: messageThreadId || null,
        },
      });

      const topicDesc = messageThreadId ? `Sub-Topik #${messageThreadId}` : 'Chat Utama Grup';
      await telegramService.sendMessage({
        chatId,
        messageThreadId,
        text: `🚨 *Topik Error Sistem Ditetapkan!*

Notifikasi kegagalan server, gangguan WAHA, dan error sistem untuk *${tenant.name || 'Klinik'}* akan dikirimkan ke *${topicDesc}*.`,
      });
      return reply.status(200).send({ ok: true });
    }

    // -----------------------------------------------------------------------------------------
    // 4. Command: /set_medical_alerts (or /medical_here / /set_medical)
    // -----------------------------------------------------------------------------------------
    if (
      /^\/(?:set_medical_alerts|set_medical|medical_here)(?:@\w+)?$/i.test(text)
    ) {
      const tenant = await findTenantForChat();
      if (!tenant) {
        await telegramService.sendMessage({
          chatId,
          messageThreadId,
          text: `⚠️ *Grup Belum Terhubung ke Klinik*

Silakan hubungkan grup ini terlebih dahulu melalui Admin Dashboard klinik Anda.`,
        });
        return reply.status(200).send({ ok: true });
      }

      await prisma.tenant.update({
        where: { id: tenant.id },
        data: {
          telegram_topic_medical_alerts: messageThreadId || null,
        },
      });

      const topicDesc = messageThreadId ? `Sub-Topik #${messageThreadId}` : 'Chat Utama Grup';
      await telegramService.sendMessage({
        chatId,
        messageThreadId,
        text: `🩺 *Topik Eskalasi Medis Ditetapkan!*

Deteksi gawat darurat & eskalasi medis ke bidan untuk *${tenant.name || 'Klinik'}* akan dikirimkan ke *${topicDesc}*.`,
      });
      return reply.status(200).send({ ok: true });
    }

    // -----------------------------------------------------------------------------------------
    // 5. Command: /status_telegram (or /status)
    // -----------------------------------------------------------------------------------------
    if (/^\/(?:status_telegram|status)(?:@\w+)?$/i.test(text)) {
      const tenant = await findTenantForChat();
      if (!tenant) {
        await telegramService.sendMessage({
          chatId,
          messageThreadId,
          text: `ℹ️ *Status Telegram:*

Grup/Chat ini belum terhubung ke akun klinik mana pun.
Silakan klik tautan pairing dari Admin Dashboard klinik Anda.`,
        });
        return reply.status(200).send({ ok: true });
      }

      await telegramService.sendMessage({
        chatId,
        messageThreadId,
        text: `📋 *Status Integrasi Telegram — ${tenant.name || 'Klinik'}*

• *Chat ID Target:* \`${tenant.telegram_chat_id || '-'}\`
• *Topik Laporan Harian:* \`${tenant.telegram_topic_daily_report ? `Topik #${tenant.telegram_topic_daily_report}` : 'Chat Utama / Default'}\`
• *Topik Error Server:* \`${tenant.telegram_topic_system_errors ? `Topik #${tenant.telegram_topic_system_errors}` : 'Sama dengan Chat Utama'}\`
• *Topik Eskalasi Medis:* \`${tenant.telegram_topic_medical_alerts ? `Topik #${tenant.telegram_topic_medical_alerts}` : 'Sama dengan Chat Utama'}\`

_Ketik \`/help\` untuk melihat perintah konfigurasi topik._`,
      });
      return reply.status(200).send({ ok: true });
    }

    // -----------------------------------------------------------------------------------------
    // 6. Command: /status_server (or /server / /server_status / /health)
    // -----------------------------------------------------------------------------------------
    if (/^\/(?:status_server|server_status|server|health|ping)(?:@\w+)?$/i.test(text)) {
      const startTime = Date.now();
      const os = await import('os');

      // 1. Database Check & Latency
      let dbStatus = '🟢 CONNECTED';
      let dbLatency = 0;
      try {
        const dbStart = Date.now();
        await prisma.$queryRaw`SELECT 1`;
        dbLatency = Date.now() - dbStart;
        dbStatus = `🟢 Terhubung (${dbLatency}ms)`;
      } catch (err: any) {
        dbStatus = `🔴 Terputus (${err.message})`;
      }

      // 2. WhatsApp Gateway (WAHA/WABA) Check
      let waStatus = '🟢 Online';
      try {
        const { wahaClient } = await import('../integrations/waha/client');
        const sessionState = await wahaClient.getSessionStatus().catch(() => 'UNKNOWN');
        if (sessionState === 'WORKING') {
          waStatus = '🟢 WORKING (Terhubung)';
        } else if (sessionState === 'SCAN_QR_CODE') {
          waStatus = '🟡 Menunggu Scan QR';
        } else if (sessionState === 'STARTING') {
          waStatus = '🟡 Memulai Sesi...';
        } else if (sessionState === 'STOPPED') {
          waStatus = '🔴 STOPPED (Sesi Berhenti)';
        } else {
          waStatus = `⚪ ${sessionState}`;
        }
      } catch {
        waStatus = '⚪ Mock / Offline';
      }

      // 3. System Resources
      const uptimeSec = process.uptime();
      const d = Math.floor(uptimeSec / (3600 * 24));
      const h = Math.floor((uptimeSec % (3600 * 24)) / 3600);
      const m = Math.floor((uptimeSec % 3600) / 60);
      const s = Math.floor(uptimeSec % 60);
      const uptimeStr = `${d > 0 ? `${d}h ` : ''}${h > 0 ? `${h}j ` : ''}${m}m ${s}d`;

      const mem = process.memoryUsage();
      const rssMb = (mem.rss / 1024 / 1024).toFixed(1);
      const heapMb = (mem.heapUsed / 1024 / 1024).toFixed(1);

      const totalRamGb = (os.totalmem() / 1024 / 1024 / 1024).toFixed(1);
      const freeRamGb = (os.freemem() / 1024 / 1024 / 1024).toFixed(1);
      const usedRamGb = (parseFloat(totalRamGb) - parseFloat(freeRamGb)).toFixed(1);
      const ramPercent = Math.round((parseFloat(usedRamGb) / parseFloat(totalRamGb)) * 100);

      const nowWib = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

      await telegramService.sendMessage({
        chatId,
        messageThreadId,
        text: `🖥️ *Status Server & Infrastruktur Chatbot*
📅 *Waktu:* ${nowWib} WIB

⏱️ *Server Uptime:* \`${uptimeStr}\`
💾 *RAM Node.js:* \`${rssMb} MB\` _(Heap: ${heapMb} MB)_
⚙️ *Beban RAM Server:* \`${usedRamGb} GB / ${totalRamGb} GB (${ramPercent}%)\`

🔌 *Koneksi Layanan:*
• *Database Postgres:* ${dbStatus}
• *WhatsApp Gateway:* ${waStatus}
• *SaaS Multi-Tenant:* 🟢 Siap
• *Proses Respon:* \`${Date.now() - startTime}ms\`

_Semua sistem beroperasi normal._`,
      });
      return reply.status(200).send({ ok: true });
    }

    // -----------------------------------------------------------------------------------------
    // 7. Command: /help
    // -----------------------------------------------------------------------------------------
    if (/^\/(?:help)(?:@\w+)?$/i.test(text)) {
      await telegramService.sendMessage({
        chatId,
        messageThreadId,
        text: `🤖 *Daftar Perintah Bot Telegram:*

• \`/status_server\` — Cek kondisi kesehatan server, RAM, DB & WhatsApp
• \`/set_daily_report\` — Daftarkan topik aktif untuk Laporan Harian
• \`/set_error_alerts\` — Daftarkan topik aktif untuk Notifikasi Error Server
• \`/set_medical_alerts\` — Daftarkan topik aktif untuk Eskalasi Medis Bidan
• \`/status_telegram\` — Cek status klinik & topik yang sedang aktif
• \`/help\` — Menampilkan panduan bantuan ini`,
      });
      return reply.status(200).send({ ok: true });
    }

    return reply.status(200).send({ ok: true, ignored: 'command not matched' });
  };

  fastify.post('/api/webhook/telegram', handleWebhook);
  fastify.post('/api/telegram/webhook', handleWebhook);
}
