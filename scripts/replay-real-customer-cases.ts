/**
 * scripts/replay-real-customer-cases.ts
 *
 * Historical Replay & Exploratory Anomaly Discovery Harness
 * Menarik 30 percakapan customer asli dari PostgreSQL (>= 5 inbound messages)
 * dan memutar ulang percakapan ke dalam unified pipeline secara in-memory.
 *
 * Misi: Mendeteksi segala bentuk cacat, anomali, silent drop, amnesia,
 * repetisi, dan kegagalan NLU di dunia nyata tanpa konfirmasi bias.
 */
import dotenv from 'dotenv';
dotenv.config();
process.env.META_CAPI_ENABLED = 'false';
import fs from 'fs';
import path from 'path';
import { prisma } from '../src/db/client';
import { SlateStore } from '../src/slot-engine/slate-store';
import { EntityExtractor } from '../src/slot-engine/entity-extractor';
import { DecisionMatrix } from '../src/slot-engine/decision-matrix';
import { GroundingComposer } from '../src/slot-engine/grounding-composer';
import { ReplyGenerator } from '../src/slot-engine/reply-generator';
import { DEFAULT_TENANT_ID } from '../src/config/tenant';
import { treatmentCatalogService } from '../src/services/treatment-catalog.service';
import { customerService } from '../src/services/customer.service';
import { conversationService } from '../src/services/conversation.service';
import { CustomerSlate } from '../src/slot-engine/types';

interface AnomalyRecord {
  category: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  turnIndex: number;
  customerText: string;
  botReply?: string;
  action?: string;
  reason: string;
  details?: any;
}

interface CaseReplayResult {
  caseIndex: number;
  phoneMasked: string;
  conversationId: string;
  totalInboundTurns: number;
  anomalies: AnomalyRecord[];
  turns: Array<{
    turnNumber: number;
    customerText: string;
    botReply: string;
    action: string;
    decisionReason: string;
    slateSnapshot: {
      locationConfirmed: boolean;
      kelurahan: string | null;
      childAgeMonths: number | null;
      selectedTreatment: string | null;
      symptoms: string[];
    };
  }>;
}

async function fetchRealConversations(limit: number = 30) {
  // Ambil sampel berimbang dari 3 strata volume pesan
  const strata1 = await prisma.$queryRaw<Array<{ id: string; phone: string; msg_count: number }>>`
    SELECT c.id, cust.phone, COUNT(m.id)::int as msg_count
    FROM conversations c
    JOIN customers cust ON c.customer_id = cust.id
    JOIN messages m ON m.conversation_id = c.id
    WHERE m.direction = 'INBOUND' 
      AND cust.is_sandbox_test = false
      AND LENGTH(m.content) > 1
    GROUP BY c.id, cust.phone
    HAVING COUNT(m.id) >= 5 AND COUNT(m.id) <= 10
    ORDER BY RANDOM()
    LIMIT 14
  `;

  const strata2 = await prisma.$queryRaw<Array<{ id: string; phone: string; msg_count: number }>>`
    SELECT c.id, cust.phone, COUNT(m.id)::int as msg_count
    FROM conversations c
    JOIN customers cust ON c.customer_id = cust.id
    JOIN messages m ON m.conversation_id = c.id
    WHERE m.direction = 'INBOUND' 
      AND cust.is_sandbox_test = false
      AND LENGTH(m.content) > 1
    GROUP BY c.id, cust.phone
    HAVING COUNT(m.id) >= 11 AND COUNT(m.id) <= 20
    ORDER BY RANDOM()
    LIMIT 10
  `;

  const strata3 = await prisma.$queryRaw<Array<{ id: string; phone: string; msg_count: number }>>`
    SELECT c.id, cust.phone, COUNT(m.id)::int as msg_count
    FROM conversations c
    JOIN customers cust ON c.customer_id = cust.id
    JOIN messages m ON m.conversation_id = c.id
    WHERE m.direction = 'INBOUND' 
      AND cust.is_sandbox_test = false
      AND LENGTH(m.content) > 1
    GROUP BY c.id, cust.phone
    HAVING COUNT(m.id) > 20
    ORDER BY RANDOM()
    LIMIT 6
  `;

  const combined = [...strata1, ...strata2, ...strata3];
  return combined.slice(0, limit);
}

function detectAnomaliesInTurn(
  turnNumber: number,
  customerText: string,
  botReply: string,
  action: string,
  decisionReason: string,
  slate: CustomerSlate,
  previousTurns: Array<{ customerText: string; botReply: string; action: string }>,
  ongkirSentCount: number
): AnomalyRecord[] {
  const anomalies: AnomalyRecord[] = [];
  const lowerCust = customerText.toLowerCase();
  const lowerBot = botReply.toLowerCase();

  // 1. Silent Handoff / Silent Drop Anomaly
  if (action.startsWith('ESCALATE_HUMAN_') || !botReply || botReply.includes('[SILENT_HANDOFF]')) {
    const isMedicalEmergency = /\b(kejang|pendarahan|biru|tidak sadar|koma|darurat)\b/i.test(lowerCust);
    const isExplicitComplaint = /\b(kecewa|kapok|marah|parah|komplain|rugi|buruk|jelek|tuntut)\b/i.test(lowerCust);
    const isUnlistedService = action === 'ESCALATE_HUMAN_UNLISTED_SERVICE';

    // Cek apakah layanan yang ditanyakan sebenarnya ada di katalog resmi
    const catalogServices = treatmentCatalogService.getAllServices();
    const matchesCatalog = catalogServices.some((s) => {
      const nameL = s.name.toLowerCase();
      return lowerCust.includes(nameL) ||
        (nameL.includes('oksitosin') && lowerCust.includes('oksitosin')) ||
        (nameL.includes('laktasi') && lowerCust.includes('laktasi')) ||
        (nameL.includes('cukur') && lowerCust.includes('cukur'));
    });

    if (isUnlistedService && matchesCatalog) {
      anomalies.push({
        category: 'FALSE_UNLISTED_SERVICE_ESCALATION',
        severity: 'HIGH',
        turnIndex: turnNumber,
        customerText,
        botReply,
        action,
        reason: 'Bot eskalasi diam menganggap unlisted service, padahal layanan ini RESMI ADA di katalog klinik!',
      });
    } else if (!isMedicalEmergency && !isExplicitComplaint && !isUnlistedService) {
      anomalies.push({
        category: 'UNEXPECTED_SILENT_HANDOFF',
        severity: 'HIGH',
        turnIndex: turnNumber,
        customerText,
        botReply,
        action,
        reason: `Bot tiba-tiba diam dan mengoper ke CS tanpa alasan medis/komplain jelas (${action}: ${decisionReason})`,
      });
    }
  }

  // 2. Double / Repeated Ongkir Template Anomaly
  const isOngkirReply = lowerBot.includes('ongkir') && (lowerBot.includes('jarak') || lowerBot.includes('gratis ongkir') || lowerBot.includes('tambahan ongkir'));
  if (isOngkirReply && ongkirSentCount > 1) {
    const isExplicitLocationChange = /\b(ganti|pindah|salah|ubah|bukan\s+di)\b/i.test(lowerCust);
    if (!isExplicitLocationChange) {
      anomalies.push({
        category: 'REPEATED_ONGKIR_PARAGRAPH',
        severity: 'MEDIUM',
        turnIndex: turnNumber,
        customerText,
        botReply,
        action,
        reason: 'Bot mengirimkan paragraf kalkulasi ongkir ulang padahal lokasi sudah terkonfirmasi di turn sebelumnya dan pelanggan tidak minta ganti alamat!',
      });
    }
  }

  // 3. Location Amnesia (Menanyakan alamat padahal sudah terkonfirmasi)
  if (slate.isLocationConfirmed && (lowerBot.includes('rumahnya dimana') || lowerBot.includes('di kelurahan mana') || lowerBot.includes('alamatnya dimana'))) {
    anomalies.push({
      category: 'LOCATION_AMNESIA',
      severity: 'HIGH',
      turnIndex: turnNumber,
      customerText,
      botReply,
      action,
      reason: `Bot menanyakan kembali alamat rumah pelanggan, padahal lokasi sudah terkonfirmasi (${slate.kelurahan})!`,
    });
  }

  // 4. Age Amnesia (Menanyakan usia padahal sudah diketahui)
  if (slate.childAgeMonths !== null && (lowerBot.includes('usia si kecil berapa') || lowerBot.includes('usianya berapa') || lowerBot.includes('umur berapa'))) {
    anomalies.push({
      category: 'AGE_AMNESIA',
      severity: 'MEDIUM',
      turnIndex: turnNumber,
      customerText,
      botReply,
      action,
      reason: `Bot menanyakan usia si kecil, padahal usia sudah dicatat (${slate.childAgeMonths} bulan)!`,
    });
  }

  // 5. Bot Looping / Exact Phrase Repetition
  if (previousTurns.length > 0) {
    const lastBot = previousTurns[previousTurns.length - 1].botReply.toLowerCase();
    if (botReply.length > 30 && lastBot.length > 30 && (botReply === previousTurns[previousTurns.length - 1].botReply || lowerBot.slice(0, 50) === lastBot.slice(0, 50))) {
      anomalies.push({
        category: 'BOT_REPETITION_LOOP',
        severity: 'HIGH',
        turnIndex: turnNumber,
        customerText,
        botReply,
        action,
        reason: 'Bot mengulang persis balasan giliran sebelumnya (Looping terdeteksi)!',
      });
    }
  }

  // 6. Premature Treatment Assumption
  if (!slate.selectedTreatmentName && previousTurns.length <= 2) {
    if (lowerBot.includes('untuk *pijat bayi ceria*') && !lowerCust.includes('ceria') && !lowerCust.includes('pijat bayi')) {
      anomalies.push({
        category: 'PREMATURE_TREATMENT_ASSUMPTION',
        severity: 'HIGH',
        turnIndex: turnNumber,
        customerText,
        botReply,
        action,
        reason: 'Bot secara sepihak menebak layanan Pijat Bayi Ceria padahal pelanggan baru menyapa umum!',
      });
    }
  }

  // 7. Text Truncation / Mutilation Extreme (< 10 chars)
  if (botReply && botReply.trim().length > 0 && botReply.trim().length < 15 && !botReply.includes('[SILENT')) {
    anomalies.push({
      category: 'TRUNCATED_MUTILATED_REPLY',
      severity: 'MEDIUM',
      turnIndex: turnNumber,
      customerText,
      botReply,
      action,
      reason: `Balasan bot terlalu pendek atau terpotong ekstrem (${botReply.trim().length} karakter): "${botReply}"`,
    });
  }

  return anomalies;
}

async function runReplaySuite() {
  console.log('\n' + '='.repeat(80));
  console.log('   🚀 HISTORICAL REPLAY HARNESS: 30 REAL CUSTOMER CHATS');
  console.log('   Eksplorasi Diagnostik Terbuka Menemukan Defect Nyata');
  console.log('='.repeat(80) + '\n');

  console.log('[1/4] Mengambil 30 sampel percakapan customer asli dari PostgreSQL...');
  const sampleConvs = await fetchRealConversations(30);
  console.log(`[✓] Berhasil memuat ${sampleConvs.length} percakapan customer riil.\n`);

  const results: CaseReplayResult[] = [];
  const anomalyInventory: Map<string, Array<{ phone: string; turn: number; cust: string; reason: string }>> = new Map();

  for (let cIdx = 0; cIdx < sampleConvs.length; cIdx++) {
    const convRow = sampleConvs[cIdx];
    const phoneMasked = convRow.phone.slice(0, 6) + '****' + convRow.phone.slice(-2);

    console.log(`\n${'─'.repeat(80)}`);
    console.log(`[CASE ${cIdx + 1}/30] Customer: ${phoneMasked} (Total Inbound: ${convRow.msg_count} pesan)`);
    console.log(`${'─'.repeat(80)}`);

    // Ambil seluruh pesan inbound & outbound percakapan asli
    const realMessages = await prisma.message.findMany({
      where: {
        conversation_id: convRow.id,
        direction: 'INBOUND',
        content: { not: '' },
      },
      orderBy: { created_at: 'asc' },
      take: 8, // Ambil hingga 8 balon chat masuk customer
    });

    const inboundTexts = realMessages
      .map((m) => m.content.trim())
      .filter((t) => t.length > 0 && !t.startsWith('cmd:') && !t.startsWith('/'));

    if (inboundTexts.length < 3) {
      console.log(`[SKIP] Pesan valid < 3 setelah pembersihan.`);
      continue;
    }

    // Inisialisasi state percakapan bersih di memori untuk simulasi isolasi
    const mockCustomer = await customerService.getOrCreateCustomer(`62899${cIdx.toString().padStart(3, '0')}${convRow.phone.slice(-4)}`, DEFAULT_TENANT_ID);
    // Tandai customer sebagai sandbox test agar CAPI dan WAHA tidak mentrigger efek samping
    await prisma.customer.update({
      where: { id: mockCustomer.id },
      data: { is_sandbox_test: true }
    }).catch(() => {});

    const mockConv = await conversationService.getOrCreateConversation(mockCustomer.id, DEFAULT_TENANT_ID);
    await conversationService.updateConversationState(mockConv.id, {
      currentState: 'INITIAL' as any,
      isHumanHandling: false,
      previousState: null
    }, DEFAULT_TENANT_ID).catch(() => {});

    const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    const caseAnomalies: AnomalyRecord[] = [];
    const caseTurns: CaseReplayResult['turns'] = [];
    let ongkirSentCount = 0;

    for (let tIdx = 0; tIdx < inboundTexts.length; tIdx++) {
      const custText = inboundTexts[tIdx];
      console.log(`\n  Turn ${tIdx + 1} | Pelanggan: "${custText.replace(/\n/g, ' ')}"`);

      try {
        const turnCtx: any = {
          customer: { ...mockCustomer, is_sandbox_test: true },
          conversation: mockConv,
          incomingMessage: {
            id: `msg_replay_${cIdx}_${tIdx}`,
            from: `${mockCustomer.phone}@c.us`,
            timestamp: Math.floor(Date.now() / 1000),
            type: 'text',
            text: { body: custText }
          },
          history,
          tenantId: DEFAULT_TENANT_ID,
        };

        const { processSlotEngine } = await import('../src/slot-engine/slot-engine');
        const handlerResult = await processSlotEngine(turnCtx);

        const reply = handlerResult.replyText || (handlerResult.shouldSendReply === false ? `[SILENT_HANDOFF: ${handlerResult.nextState}]` : '');
        const action = handlerResult.aiReasoning?.split('->')[0]?.trim() || handlerResult.nextState || 'ACTION';

        if (reply.toLowerCase().includes('ongkir') && (reply.toLowerCase().includes('jarak') || reply.toLowerCase().includes('gratis'))) {
          ongkirSentCount++;
        }

        console.log(`  Turn ${tIdx + 1} | Bot State : [${handlerResult.nextState}] | shouldSendReply: ${handlerResult.shouldSendReply}`);
        console.log(`  Turn ${tIdx + 1} | Balasan   : "${reply.replace(/\n/g, ' ').slice(0, 95)}..."`);

        // Muat slate terbaru untuk evaluasi anomali
        const currentSlate = SlateStore.hydrateSlate(turnCtx);

        // Deteksi anomali pada giliran ini
        const turnAnomalies = detectAnomaliesInTurn(
          tIdx + 1,
          custText,
          reply,
          action,
          handlerResult.aiReasoning || '',
          currentSlate,
          caseTurns,
          ongkirSentCount
        );

        if (turnAnomalies.length > 0) {
          for (const a of turnAnomalies) {
            console.log(`    ⚠️ [ANOMALI TERDETEKSI] [${a.category}] ${a.reason}`);
            caseAnomalies.push(a);

            if (!anomalyInventory.has(a.category)) {
              anomalyInventory.set(a.category, []);
            }
            anomalyInventory.get(a.category)!.push({
              phone: phoneMasked,
              turn: tIdx + 1,
              cust: custText,
              reason: a.reason,
            });
          }
        }

        caseTurns.push({
          turnNumber: tIdx + 1,
          customerText: custText,
          botReply: reply,
          action,
          decisionReason: handlerResult.aiReasoning || '',
          slateSnapshot: {
            locationConfirmed: currentSlate.isLocationConfirmed,
            kelurahan: currentSlate.kelurahan,
            childAgeMonths: currentSlate.childAgeMonths,
            selectedTreatment: currentSlate.selectedTreatmentName,
            symptoms: [...currentSlate.symptoms],
          },
        });

        history.push({ role: 'user', content: custText });
        if (reply && !reply.startsWith('[SILENT_HANDOFF')) {
          history.push({ role: 'assistant', content: reply });
        }
      } catch (err: any) {
        console.error(`    ❌ [CRASH/ERROR] Turn ${tIdx + 1}: ${err.message}`);
        const crashAnomaly: AnomalyRecord = {
          category: 'PIPELINE_CRASH_ERROR',
          severity: 'HIGH',
          turnIndex: tIdx + 1,
          customerText: custText,
          reason: `Exception saat memproses turn: ${err.message}`,
        };
        caseAnomalies.push(crashAnomaly);
        if (!anomalyInventory.has('PIPELINE_CRASH_ERROR')) {
          anomalyInventory.set('PIPELINE_CRASH_ERROR', []);
        }
        anomalyInventory.get('PIPELINE_CRASH_ERROR')!.push({
          phone: phoneMasked,
          turn: tIdx + 1,
          cust: custText,
          reason: err.message,
        });
      }
    }

    results.push({
      caseIndex: cIdx + 1,
      phoneMasked,
      conversationId: convRow.id,
      totalInboundTurns: inboundTexts.length,
      anomalies: caseAnomalies,
      turns: caseTurns,
    });
  }

  // Rangkum Laporan Komprehensif
  console.log('\n' + '='.repeat(80));
  console.log('   📊 INVENTARIS TEMUAN ANOMALI DARI 30 PERCAKAPAN RIIL');
  console.log('='.repeat(80) + '\n');

  let totalAnomalies = 0;
  for (const [cat, items] of anomalyInventory.entries()) {
    totalAnomalies += items.length;
    console.log(`🔸 [${cat}] Total Kejadian: ${items.length}`);
    for (const ex of items.slice(0, 3)) {
      console.log(`   - ${ex.phone} (Turn ${ex.turn}): "${ex.cust.slice(0, 60)}"`);
      console.log(`     Alasan: ${ex.reason}`);
    }
    if (items.length > 3) {
      console.log(`   - ... dan ${items.length - 3} kejadian lainnya.`);
    }
    console.log('');
  }

  if (totalAnomalies === 0) {
    console.log('🎉 LUAR BIASA! Tidak ditemukan anomali signifikan pada 30 percakapan customer asli!');
  } else {
    console.log(`⚠️ Ditemukan total ${totalAnomalies} anomali yang perlu diperbaiki (lihat rincian di atas).`);
  }

  // Tulis laporan lengkap ke Markdown Artifact
  const reportPath = path.join(process.cwd(), 'docs', 'REAL_CUSTOMER_REPLAY_REPORT.md');
  let mdContent = `# Laporan Pengujian 30 Percakapan Customer Nyata (Historical Replay)\n\n`;
  mdContent += `**Tanggal Pengujian:** ${new Date().toLocaleString('id-ID')}\n`;
  mdContent += `**Jumlah Percakapan Diuji:** ${results.length} nomor pelanggan riil\n`;
  mdContent += `**Total Balon Pesan Masuk:** ${results.reduce((acc, r) => acc + r.totalInboundTurns, 0)} giliran\n`;
  mdContent += `**Total Anomali Terdeteksi:** ${totalAnomalies}\n\n`;

  mdContent += `## 📋 Ringkasan Inventaris Masalah (Real Defect Inventory)\n\n`;
  if (anomalyInventory.size === 0) {
    mdContent += `*Tidak ditemukan anomali.* Seluruh 30 percakapan berjalan lancar.\n\n`;
  } else {
    mdContent += `| Kategori Anomali | Frekuensi | Tingkat Keparahan | Deskripsi Masalah |\n`;
    mdContent += `|---|---|---|---|\n`;
    for (const [cat, items] of anomalyInventory.entries()) {
      mdContent += `| \`${cat}\` | ${items.length} | ${items.length > 3 ? '🔴 TINGGI' : '🟡 SEDANG'} | ${items[0]?.reason || '-'} |\n`;
    }
    mdContent += `\n`;
  }

  mdContent += `## 🔍 Rincian Sampel Temuan per Kategori\n\n`;
  for (const [cat, items] of anomalyInventory.entries()) {
    mdContent += `### Kategori: \`${cat}\` (${items.length} kejadian)\n`;
    for (let i = 0; i < Math.min(items.length, 5); i++) {
      const item = items[i];
      mdContent += `${i + 1}. **Customer ${item.phone} (Turn ${item.turn}):**\n`;
      mdContent += `   - *Pesan Masuk:* \`"${item.cust}"\`\n`;
      mdContent += `   - *Temuan:* ${item.reason}\n\n`;
    }
  }

  mdContent += `## 📑 Papan Skor per Nomor Pelanggan (30 Kasus)\n\n`;
  mdContent += `| No | Pelanggan | Turn | Anomali | Status Evaluasi |\n`;
  mdContent += `|---|---|---|---|---|\n`;
  for (const r of results) {
    const statusIcon = r.anomalies.length === 0 ? '✅ BERSIH' : `⚠️ ${r.anomalies.length} ISU`;
    mdContent += `| ${r.caseIndex} | ${r.phoneMasked} | ${r.totalInboundTurns} | ${r.anomalies.map((a) => a.category).join(', ') || 'Nihil'} | ${statusIcon} |\n`;
  }

  fs.writeFileSync(reportPath, mdContent, 'utf-8');
  console.log(`\n[✓] Laporan lengkap tersimpan di: ${reportPath}\n`);

  await prisma.$disconnect();
}

runReplaySuite().catch(async (e) => {
  console.error('Fatal Error:', e);
  await prisma.$disconnect();
  process.exit(1);
});
