import { prisma } from '../db/client';
import { alertService, AlertType, AlertSeverity } from './alert.service';
import { getStringSimilarity } from '../utils/similarity';
import { AiModelConfigService } from '../config/ai-models.config';
import { callChatCompletionsWithFallback, getFallbackModel } from '../integrations/llm/model-fallback';

export interface DailyReportData {
  reportDateStr: string;
  sales: {
    totalConfirmed: number;
    totalRevenue: number;
    revenueIsEstimated: boolean;
    newCustomersCount: number;
    repeatCustomersCount: number;
  };
  chat: {
    newConversations: number;
    inboundMessages: number;
    outboundMessages: number;
    averageResponseSeconds: number | null;
  };
  adAttribution: {
    totalClicks: number;
    convertedClicks: number;
  };
  opsHealth: {
    highMedicalEscalations: number;
    mediumMedicalEscalations: number;
    pendingMedicalEscalations: number;
    otherEscalations: number;
    pendingMedicalFaq: number;
    pendingGeneralFaq: number;
  };
  insights: {
    summarization: string;
    topLocations: Array<{ name: string; count: number }>;
    outOfCoverageCount: number;
  };
}

export class DailyReportService {
  /**
   * Main method to generate and send daily report.
   */
  public async sendDailyReport(tenantId: string): Promise<void> {
    try {
      const nowUtc = new Date();
      const nowWib = new Date(nowUtc.getTime() + 7 * 60 * 60 * 1000);
      
      // Date formatting for yesterday
      const yesterdayWib = new Date(nowWib.getTime() - 24 * 60 * 60 * 1000);
      
      const year = yesterdayWib.getUTCFullYear();
      const month = String(yesterdayWib.getUTCMonth() + 1).padStart(2, '0');
      const day = String(yesterdayWib.getUTCDate()).padStart(2, '0');
      const reportDateStr = `${year}-${month}-${day}`; // YYYY-MM-DD

      // Check DailyReportLog unique constraint
      const existingLog = await prisma.dailyReportLog.findUnique({
        where: {
          tenant_id_report_date: {
            tenant_id: tenantId,
            report_date: reportDateStr
          }
        }
      });

      if (existingLog && existingLog.status === 'sent') {
        console.log(`[DailyReport] Report already sent for ${tenantId} on ${reportDateStr}`);
        return;
      }

      // Generate Data
      const reportData = await this.generateReport(tenantId, yesterdayWib, reportDateStr);
      
      // Get Tenant Name
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId }
      });
      const tenantName = tenant ? tenant.name : tenantId;

      // Format Markdown
      const markdownMessage = this.formatForTelegram(tenantName, reportData);

      // Send via AlertService (Telegram fallback)
      const result = await alertService.notifyAlert({
        type: AlertType.DAILY_OPS_REPORT,
        severity: AlertSeverity.INFO,
        message: markdownMessage,
        rawMessage: true,
        botToken: tenant?.telegram_bot_token || undefined,
        chatId: tenant?.telegram_chat_id || undefined,
        metadata: reportData
      });

      // Send to WA Group (Kala Rekap) with humanizer typing simulation (no LLM phrasing)
      const dailyGroupJid = process.env.DAILY_REPORT_GROUP_JID || '120363428393473712@g.us';
      if (dailyGroupJid) {
        try {
          const { wahaClient } = await import('../integrations/waha/client');
          await wahaClient.sendSeen(dailyGroupJid).catch(() => {});
          // Simulasi waktu mengetik natural (2 detik)
          await new Promise(r => setTimeout(r, 2000));
          await wahaClient.sendText(dailyGroupJid, markdownMessage);
          console.log(`[DailyReport] Sent report to WA Group ${dailyGroupJid}`);
        } catch (waErr: any) {
          console.warn(`[DailyReport] Failed to send report to WA Group ${dailyGroupJid}:`, waErr.message);
        }
      }

      // Upsert DB Log
      const status = result.sent ? 'sent' : 'failed';
      await prisma.dailyReportLog.upsert({
        where: {
          tenant_id_report_date: {
            tenant_id: tenantId,
            report_date: reportDateStr
          }
        },
        create: {
          tenant_id: tenantId,
          report_date: reportDateStr,
          status,
          metadata: reportData as any
        },
        update: {
          status,
          metadata: reportData as any,
          sent_at: new Date()
        }
      });
      
      console.log(`[DailyReport] Finished sending report for ${tenantId} on ${reportDateStr}. Status: ${status}`);

    } catch (err: any) {
      console.error(`[DailyReport] Failed to process daily report for tenant ${tenantId}:`, err.message);
    }
  }

  /**
   * Data accumulation logic
   */
  public async generateReport(tenantId: string, targetDateWib: Date, reportDateStr: string): Promise<DailyReportData> {
    // Treat targetDateWib as if its UTC properties are actually WIB.
    // We want 00:00:00 WIB to 23:59:59 WIB.
    
    // Construct UTC dates that correspond to the start and end of that WIB day
    const startOfDayWib = new Date(Date.UTC(
      targetDateWib.getUTCFullYear(),
      targetDateWib.getUTCMonth(),
      targetDateWib.getUTCDate(),
      0, 0, 0, 0
    ));
    const endOfDayWib = new Date(Date.UTC(
      targetDateWib.getUTCFullYear(),
      targetDateWib.getUTCMonth(),
      targetDateWib.getUTCDate(),
      23, 59, 59, 999
    ));
    
    // Convert WIB boundary times back to true UTC for DB querying
    // Subtract 7 hours from WIB time to get UTC time
    const startOfDay = new Date(startOfDayWib.getTime() - 7 * 60 * 60 * 1000);
    const endOfDay = new Date(endOfDayWib.getTime() - 7 * 60 * 60 * 1000);

    const dateRange = { gte: startOfDay, lte: endOfDay };
    const tenantFilter = { tenant_id: tenantId };

    // --- 1. Sales & Konversi ---
    const reservations = await prisma.reservation.findMany({
      where: {
        ...tenantFilter,
        created_at: dateRange,
        status: 'confirmed'
      },
      include: { customer: true }
    });

    const newCustomersCount = reservations.filter(r => 
      r.customer && r.customer.created_at >= startOfDay && r.customer.created_at <= endOfDay
    ).length;
    const repeatCustomersCount = reservations.filter(r => r.is_repeat_order).length;

    // Pricing Match
    let totalRevenue = 0;
    let revenueIsEstimated = false;

    // Cache clinic services
    const clinicServices = await prisma.clinicService.findMany({
      where: { ...tenantFilter, is_active: true }
    });

    for (const res of reservations) {
      if (!res.treatment_detail) continue;
      
      let matchedPrice = 0;
      let isFuzzy = false;
      const detailStr = res.treatment_detail.toLowerCase().replace(/\s+/g, '').trim();

      // Exact match
      const exactMatch = clinicServices.find(cs => 
        cs.service_id.toLowerCase().replace(/\s+/g, '').trim() === detailStr ||
        cs.name.toLowerCase().replace(/\s+/g, '').trim() === detailStr
      );

      if (exactMatch) {
        matchedPrice = exactMatch.promo_price || exactMatch.original_price;
      } else {
        // Fuzzy match
        let bestMatch = null;
        let bestScore = 0;

        for (const cs of clinicServices) {
          const scoreId = getStringSimilarity(res.treatment_detail, cs.service_id);
          const scoreName = getStringSimilarity(res.treatment_detail, cs.name);
          const maxScore = Math.max(scoreId, scoreName);
          if (maxScore > bestScore && maxScore >= 0.8) {
            bestScore = maxScore;
            bestMatch = cs;
          }
        }

        if (bestMatch) {
          matchedPrice = bestMatch.promo_price || bestMatch.original_price;
          isFuzzy = true;
        }
      }

      if (matchedPrice > 0) {
        totalRevenue += matchedPrice;
        if (isFuzzy) revenueIsEstimated = true;
      }
    }

    // --- 2. Chat & Engagement ---
    const newConversations = await prisma.conversation.count({
      where: { ...tenantFilter, created_at: dateRange }
    });
    const inboundMessages = await prisma.message.count({
      where: { ...tenantFilter, created_at: dateRange, direction: 'INBOUND' }
    });
    const outboundMessages = await prisma.message.count({
      where: { ...tenantFilter, created_at: dateRange, direction: 'OUTBOUND' }
    });

    // --- 3. Atribusi Iklan ---
    const totalClicks = await prisma.adClick.count({
      where: { ...tenantFilter, createdAt: dateRange }
    });
    const clickRecords = await prisma.adClick.findMany({
      where: { ...tenantFilter, createdAt: dateRange },
      select: { customerId: true }
    });
    const convertedClicks = clickRecords.filter(click => 
      click.customerId && reservations.some(r => r.customer_id === click.customerId)
    ).length;

    // --- 4. Kesehatan Ops Bot ---
    const highMedical = await prisma.conversation.count({
      where: { ...tenantFilter, created_at: dateRange, escalation_reason: 'MEDICAL_EMERGENCY_HIGH' }
    });
    // Assuming medical_concern maps to MEDIUM if not HIGH
    const mediumMedical = await prisma.conversation.count({
      where: { ...tenantFilter, created_at: dateRange, escalation_reason: 'medical_concern' }
    });
    const pendingMedical = await prisma.conversation.count({
      where: { 
        ...tenantFilter, 
        is_human_handling: true, 
        escalation_reason: { in: ['MEDICAL_EMERGENCY_HIGH', 'medical_concern'] } 
      }
    });
    const otherEscalations = await prisma.conversation.count({
      where: {
        ...tenantFilter,
        created_at: dateRange,
        is_human_handling: true,
        escalation_reason: { 
          notIn: ['MEDICAL_EMERGENCY_HIGH', 'medical_concern', 'AI_ELIGIBILITY_ESCALATION_REASON']
        }
      }
    });

    const pendingMedicalFaq = await prisma.medicalFaqStaging.count({
      where: { ...tenantFilter, status: 'PENDING' }
    });
    const pendingGeneralFaq = await prisma.generalFaqStaging.count({
      where: { ...tenantFilter, status: 'PENDING' }
    });

    // --- 5. Insights ---
    const summarization = await this.generateInsights(tenantId, dateRange);
    
    // Get locations of new customers yesterday
    const newCusts = await prisma.customer.findMany({
      where: { ...tenantFilter, created_at: dateRange },
      select: { kecamatan: true, kota: true }
    });
    const locationCounts: Record<string, number> = {};
    newCusts.forEach(c => {
      const loc = c.kecamatan || c.kota || 'Unknown';
      locationCounts[loc] = (locationCounts[loc] || 0) + 1;
    });
    const topLocations = Object.entries(locationCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
      
    const outOfCoverageCount = await prisma.customer.count({
      where: { ...tenantFilter, created_at: dateRange, is_out_of_coverage: true }
    });

    return {
      reportDateStr,
      sales: {
        totalConfirmed: reservations.length,
        totalRevenue,
        revenueIsEstimated,
        newCustomersCount,
        repeatCustomersCount
      },
      chat: {
        newConversations,
        inboundMessages,
        outboundMessages,
        averageResponseSeconds: null // Need granular message tracking to calc correctly, omitting for simplicity
      },
      adAttribution: {
        totalClicks,
        convertedClicks
      },
      opsHealth: {
        highMedicalEscalations: highMedical,
        mediumMedicalEscalations: mediumMedical,
        pendingMedicalEscalations: pendingMedical,
        otherEscalations,
        pendingMedicalFaq,
        pendingGeneralFaq
      },
      insights: {
        summarization,
        topLocations,
        outOfCoverageCount
      }
    };
  }

  /**
   * Generates summary of yesterday's inbound messages using LLM.
   */
  public async generateInsights(tenantId: string, dateRange: { gte: Date, lte: Date }): Promise<string> {
    try {
      const messages = await prisma.message.findMany({
        where: {
          tenant_id: tenantId,
          created_at: dateRange,
          direction: 'INBOUND'
        },
        select: { content: true },
        take: 50, // sample size
        orderBy: { created_at: 'desc' }
      });

      if (messages.length === 0) return "Tidak ada percakapan masuk hari ini.";

      const sampleText = messages.map(m => `- ${m.content}`).join('\n');
      const prompt = `Ringkas tema/pola pertanyaan customer berikut dalam 2-3 kalimat bahasa Indonesia:\n\n${sampleText}`;
      
      const apiKey = process.env.LLM_API_KEY || '';
      const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
      const modelConfig = AiModelConfigService.getModelConfig('SUMMARIZATION');

      const startedAt = Date.now();
      let callResult: Awaited<ReturnType<typeof callChatCompletionsWithFallback>>;
      try {
        callResult = await callChatCompletionsWithFallback({
          baseUrl,
          apiKey,
          model: modelConfig.modelName,
          fallbackModel: getFallbackModel(),
          timeoutMs: 15000,
          payload: {
            temperature: modelConfig.temperature,
            max_tokens: 150,
            messages: [{ role: 'user', content: prompt }]
          }
        });
      } catch (err: any) {
        try {
          const { auditLlmCall } = await import('../utils/llm-audit-buffer');
          auditLlmCall({
            tenant_id: tenantId,
            customer_phone: 'report-audit',
            task_type: 'SUMMARIZATION',
            model_name: modelConfig.modelName,
            baseUrl,
            startedAt,
            error: err,
          });
        } catch {
          // Fire-and-forget
        }
        throw err;
      }

      const data = callResult.data;

      try {
        const { auditLlmCall } = await import('../utils/llm-audit-buffer');
        auditLlmCall({
          tenant_id: tenantId,
          customer_phone: 'report-audit',
          task_type: 'SUMMARIZATION',
          model_name: callResult.model,
          baseUrl: callResult.baseUrl,
          startedAt,
          usage: data?.usage,
        });
      } catch (logErr) {
        // Fire-and-forget
      }

      const summary = data.choices[0]?.message?.content?.trim();
      return summary || "Ringkasan kosong.";
    } catch (err: any) {
      console.error(`[DailyReport] generateInsights LLM error:`, err.message);
      return "Ringkasan otomatis tidak tersedia saat ini karena gangguan layanan AI.";
    }
  }

  /**
   * Format data into Markdown
   */
  public formatForTelegram(tenantName: string, data: DailyReportData): string {
    const s = data.sales;
    const c = data.chat;
    const ad = data.adAttribution;
    const ops = data.opsHealth;
    const ins = data.insights;

    const formatCurrency = (val: number) => 
      new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val);

    const revenueStr = s.totalRevenue > 0 
      ? `${formatCurrency(s.totalRevenue)} ${s.revenueIsEstimated ? '*(estimasi)*' : ''}`
      : 'N/A';

    return `📊 *Laporan Harian Operasional — ${tenantName}*
*Tanggal*: ${data.reportDateStr}

💰 *Sales & Konversi*
- Reservasi Confirmed: *${s.totalConfirmed}*
- Total Omzet: *${revenueStr}*
- Customer Baru: *${s.newCustomersCount}*
- Repeat Order: *${s.repeatCustomersCount}*

💬 *Chat & Engagement*
- Percakapan Baru: *${c.newConversations}*
- Pesan Masuk: *${c.inboundMessages}*
- Pesan Keluar: *${c.outboundMessages}*

🎯 *Atribusi Iklan*
- Klik Masuk: *${ad.totalClicks}*
- Konversi ke Reservasi: *${ad.convertedClicks}*

🚨 *Kesehatan Operasional*
- Eskalasi Medis (High): *${ops.highMedicalEscalations}*
- Eskalasi Medis (Medium): *${ops.mediumMedicalEscalations}*
- Medis Masih Pending: *${ops.pendingMedicalEscalations}*
- Eskalasi Non-Medis: *${ops.otherEscalations}*
- Antrian Staging (Medis/Umum): *${ops.pendingMedicalFaq}* / *${ops.pendingGeneralFaq}*

🧠 *Insight AI*
- Ringkasan: _${ins.summarization}_
- Top Lokasi: ${ins.topLocations.map(l => `${l.name} (${l.count})`).join(', ') || 'N/A'}
- Out of Coverage: *${ins.outOfCoverageCount}*

🔍 [Buka Control Panel](${process.env.ADMIN_DASHBOARD_URL || 'http://localhost:3000/admin'}) untuk detail lengkap.`;
  }
}

export const dailyReportService = new DailyReportService();
