import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client';
import { telegramService } from '../services/telegram.service';
import { parsePositiveInt } from '../utils/env-numeric';
import { safeCompare } from '../utils/auth';
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
    // 1. Timing-safe Secret Token validation (SEC-05 Fix)
    const secretTokenHeader = (request.headers['x-telegram-bot-api-secret-token'] || '') as string;
    const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (expectedSecret) {
      if (!secretTokenHeader || !safeCompare(secretTokenHeader, expectedSecret)) {
        console.warn(`[TELEGRAM WEBHOOK] Blocked unauthorized request with invalid secret token from ${request.ip}`);
        return reply.status(403).send({ error: 'Unauthorized: Invalid Telegram secret token' });
      }
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
    // -----------------------------------------------------------------------------------------
    // 6. Command: /server (or /status_server / /server_status / /health / /ping)
    // -----------------------------------------------------------------------------------------
    if (/^\/(?:server|status_server|server_status|health|ping)(?:@\w+)?$/i.test(text)) {
      const startTime = Date.now();
      const os = await import('os');
      const fs = await import('fs');

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

      // 3. CPU Metrics & Load Average
      const cpus = os.cpus() || [];
      const cpuCount = cpus.length || 1;
      const cpuModel = cpus[0]?.model ? cpus[0].model.replace(/\s+/g, ' ').trim() : 'Virtual CPU';
      const loadAvg = os.loadavg();
      const loadAvgStr = `${loadAvg[0].toFixed(2)}, ${loadAvg[1].toFixed(2)}, ${loadAvg[2].toFixed(2)}`;

      // Approximate CPU usage percentage from CPU tick times
      let cpuPercent = 0;
      try {
        let totalIdle = 0;
        let totalTick = 0;
        for (const cpu of cpus) {
          for (const type in cpu.times) {
            totalTick += (cpu.times as any)[type];
          }
          totalIdle += cpu.times.idle;
        }
        if (totalTick > 0) {
          cpuPercent = Math.max(0, Math.min(100, Math.round(((totalTick - totalIdle) / totalTick) * 100)));
        }
      } catch (_) {}

      // 4. Memory Metrics (Total OS RAM + Node.js Process)
      const totalRamBytes = os.totalmem();
      const freeRamBytes = os.freemem();
      const usedRamBytes = totalRamBytes - freeRamBytes;
      const totalRamGb = (totalRamBytes / (1024 ** 3)).toFixed(1);
      const usedRamGb = (usedRamBytes / (1024 ** 3)).toFixed(1);
      const freeRamMb = Math.round(freeRamBytes / (1024 ** 2));
      const ramPercent = Math.round((usedRamBytes / totalRamBytes) * 100);

      const mem = process.memoryUsage();
      const rssMb = (mem.rss / (1024 ** 2)).toFixed(1);
      const heapMb = (mem.heapUsed / (1024 ** 2)).toFixed(1);

      // 5. Hard Disk Storage Metrics
      let diskInfoStr = 'Memeriksa storage...';
      try {
        const stat = await fs.promises.statfs('/');
        const totalDiskBytes = stat.blocks * stat.bsize;
        const freeDiskBytes = stat.bavail * stat.bsize;
        const usedDiskBytes = totalDiskBytes - freeDiskBytes;

        const totalDiskGb = (totalDiskBytes / (1024 ** 3)).toFixed(1);
        const usedDiskGb = (usedDiskBytes / (1024 ** 3)).toFixed(1);
        const freeDiskGb = (freeDiskBytes / (1024 ** 3)).toFixed(1);
        const diskPercent = Math.round((usedDiskBytes / totalDiskBytes) * 100);

        diskInfoStr = `\`${usedDiskGb} GB / ${totalDiskGb} GB (${diskPercent}%)\`\n• *Sisa Ruang Bebas:* \`${freeDiskGb} GB\``;
      } catch (diskErr: any) {
        diskInfoStr = `\`Info disk tidak tersedia: ${diskErr.message}\``;
      }

      // 6. Uptime Metrics (Host OS vs Bot Engine Process)
      const formatUptime = (seconds: number) => {
        const d = Math.floor(seconds / (3600 * 24));
        const h = Math.floor((seconds % (3600 * 24)) / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        return `${d > 0 ? `${d}h ` : ''}${h > 0 ? `${h}j ` : ''}${m}m ${s}d`;
      };

      const hostUptimeStr = formatUptime(os.uptime());
      const botUptimeStr = formatUptime(process.uptime());
      const nowWib = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

      await telegramService.sendMessage({
        chatId,
        messageThreadId,
        text: `🖥️ *STATUS KESEHATAN SERVER & INFRASTRUKTUR*
📅 *Waktu:* ${nowWib} WIB

⚙️ *Beban CPU & Sistem:*
• *Penggunaan CPU:* \`${cpuPercent}%\` _(${cpuCount} vCPU Core)_
• *Load Average (1m, 5m, 15m):* \`${loadAvgStr}\`
• *Host OS Uptime:* \`${hostUptimeStr}\`
• *Bot Engine Uptime:* \`${botUptimeStr}\`

💾 *Memori Server (RAM):*
• *Beban Total Server:* \`${usedRamGb} GB / ${totalRamGb} GB (${ramPercent}%)\`
• *RAM Sisa Bebas:* \`${freeRamMb} MB\`
• *Alokasi Bot Node.js:* \`${rssMb} MB\` _(Heap: ${heapMb} MB)_

💽 *Penyimpanan Hard Disk:*
• *Kapasitas Terpakai:* ${diskInfoStr}

🔌 *Status Koneksi & Layanan:*
• *Database Postgres:* ${dbStatus}
• *WhatsApp Gateway:* ${waStatus}
• *SaaS Multi-Tenant:* 🟢 Siap
• *Waktu Respons:* \`${Date.now() - startTime}ms\`

_Semua infrastruktur server beroperasi optimal._`,
      });
      return reply.status(200).send({ ok: true });
    }

    // -----------------------------------------------------------------------------------------
    // 6b. Command: /clean (atau /clean_server / /server_clean)
    // Task pembersihan server: bot menulis request file di storage/, cron host
    // (clean-trigger.sh) menjalankan server-clean.sh, lalu bot polling hasilnya.
    // HANYA dari chat yang sudah ter-pair dengan tenant (aman — bukan sembarang chat).
    // -----------------------------------------------------------------------------------------
    if (/^\/(?:clean|clean_server|server_clean)(?:@\w+)?$/i.test(text)) {
      const cleanEnabled = (process.env.TELEGRAM_CLEAN_ENABLED || 'true').toLowerCase();
      if (cleanEnabled === 'false') {
        await telegramService.sendMessage({
          chatId,
          messageThreadId,
          text: `🔒 *Perintah Pembersihan Server Dinonaktifkan*

Admin menonaktifkan perintah ini (env \`TELEGRAM_CLEAN_ENABLED=false\`).`,
        });
        return reply.status(200).send({ ok: true });
      }

      const tenant = await findTenantForChat();
      if (!tenant) {
        await telegramService.sendMessage({
          chatId,
          messageThreadId,
          text: `⚠️ *Akses Ditolak*

Perintah \`/clean\` hanya bisa dijalankan dari chat yang sudah terhubung ke klinik melalui Admin Dashboard.`,
        });
        return reply.status(200).send({ ok: true });
      }

      const path = await import('path');
      const fs = await import('fs');
      const cleanStorageDir = process.env.CLEAN_STORAGE_DIR || path.join(process.cwd(), 'storage');
      const requestFile = path.join(cleanStorageDir, '.clean-request');
      const resultFile = path.join(cleanStorageDir, '.clean-result');

      // Anti antrean ganda: masih ada request yang belum diproses cron
      if (fs.existsSync(requestFile)) {
        await telegramService.sendMessage({
          chatId,
          messageThreadId,
          text: `⏳ *Pembersihan Server Masih Diproses*

Permintaan sebelumnya belum selesai (cron memproses ≤ 1 menit). Coba lagi sebentar lagi.`,
        });
        return reply.status(200).send({ ok: true });
      }

      try {
        fs.mkdirSync(cleanStorageDir, { recursive: true });
        fs.writeFileSync(requestFile, JSON.stringify({ chatId, messageThreadId, requestedAt: new Date().toISOString(), requestedBy: senderName }), 'utf-8');
      } catch (err: any) {
        console.error('[TELEGRAM /CLEAN] Gagal menulis request file:', err.message);
        await telegramService.sendMessage({
          chatId,
          messageThreadId,
          text: `⚠️ *Gagal Menjadwalkan Pembersihan Server*

${err.message}`,
        });
        return reply.status(200).send({ ok: true });
      }

      const startTime = Date.now();
      await telegramService.sendMessage({
        chatId,
        messageThreadId,
        text: `🧹 *Pembersihan Server Dijadwalkan!*
🏥 *${tenant.name || 'Klinik'}*

Permintaan diterima — cron host akan memproses dalam ≤ 1 menit (build cache Docker, image dangling, log, dan temp).

Hasil akan dikirim otomatis ke chat ini setelah selesai.`,
      });

      // Polling hasil (background, tidak memblokir webhook response)
      const pollMs = parsePositiveInt(process.env.CLEAN_POLL_MS, 5000);
      const pollTimeoutMs = parsePositiveInt(process.env.CLEAN_POLL_TIMEOUT_MS, 120000);
      const pollInterval = setInterval(async () => {
        try {
          if (!fs.existsSync(resultFile)) return;
          const resultText = fs.readFileSync(resultFile, 'utf-8').slice(0, 3500);
          fs.unlinkSync(resultFile);
          clearInterval(pollInterval);
          const elapsedSec = Math.round((Date.now() - startTime) / 1000);
          await telegramService.sendMessage({
            chatId,
            messageThreadId,
            text: `✅ *Pembersihan Server Selesai*
⏱️ *Durasi:* ${elapsedSec} detik

\`\`\`
${resultText}
\`\`\``,
          });
        } catch (pollErr: any) {
          clearInterval(pollInterval);
          console.error('[TELEGRAM /CLEAN] Polling result error:', pollErr.message);
        }
      }, pollMs);

      setTimeout(() => {
        clearInterval(pollInterval);
        console.warn('[TELEGRAM /CLEAN] Polling result timeout — cron mungkin tidak aktif.');
      }, pollTimeoutMs);

      return reply.status(200).send({ ok: true, cleanScheduled: true });
    }

    // -----------------------------------------------------------------------------------------
    // 7. Command: /help
    // -----------------------------------------------------------------------------------------
    if (/^\/(?:help)(?:@\w+)?$/i.test(text)) {
      await telegramService.sendMessage({
        chatId,
        messageThreadId,
        text: `🤖 *Daftar Perintah Bot Telegram:*

• \`/server\` (atau \`/status_server\`) — Cek beban total CPU, RAM, Harddisk & status koneksi
• \`/clean\` (atau \`/clean_server\`) — Pembersihan server (build cache Docker, log, temp) — hanya dari chat terhubung
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
