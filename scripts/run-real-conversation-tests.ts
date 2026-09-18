/**
 * run-real-conversation-tests.ts
 *
 * Test Runner untuk mengeksekusi 50 Test Case Percakapan Nyata dari Database PostgreSQL.
 * Menjalankan alur percakapan utuh dari Greeting sampai Closing secara multi-turn,
 * lalu mencatat dan menganalisis bagaimana chatbot menjawab setiap giliran.
 *
 * Penggunaan:
 *   npx tsx scripts/run-real-conversation-tests.ts --id 4 --llm       # Jalankan Kasus #4 dengan LLM
 *   npx tsx scripts/run-real-conversation-tests.ts --from 1 --to 10 --llm  # Jalankan batch 1-10
 *   npx tsx scripts/run-real-conversation-tests.ts --all --llm       # Jalankan ke-50 test case
 */

import * as fs from 'fs';
import * as path from 'path';

// Pastikan flag mock dan typing cepat aktif untuk pengujian CLI
process.env.WAHA_MOCK = 'true';
process.env.BURST_COALESCE_MS = '0';
process.env.HUMANIZER_TYPING_SPEED = '500';

const PRIMARY_DATASET = path.join(process.cwd(), 'scratch', 'all-100-test-cases.json');
const FALLBACK_DATASET = path.join(process.cwd(), 'scratch', 'high-value-50-test-cases.json');
const DATASET_FILE = fs.existsSync(PRIMARY_DATASET) ? PRIMARY_DATASET : FALLBACK_DATASET;
const REPORT_FILE = path.join(process.cwd(), 'test-results', 'real-conversation-test-report.md');

async function main() {
  // Strict Security Guard: DILARANG keras berjalan di server produksi / database cloud publik!
  const isProduction =
    process.env.NODE_ENV === 'production' ||
    process.env.IS_PRODUCTION === 'true' ||
    process.env.SERVER_MODE === 'production' ||
    (process.env.DATABASE_URL &&
      !process.env.DATABASE_URL.includes('localhost') &&
      !process.env.DATABASE_URL.includes('127.0.0.1'));

  if (isProduction) {
    console.error('\n❌ [SECURITY BLOCKED]: Script test runner real-conversation DILARANG KERAS dijalankan di Live Server / Production Database!');
    console.error('Script ini khusus untuk lingkungan pengujian simulasi LOKAL.\n');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const valOf = (k: string) => {
    const idx = args.indexOf(k);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : '';
  };
  const useLLM = !args.includes('--no-llm') && !args.includes('--offline');

  let targetIds: Set<number> | null = null;
  let fromId = parseInt(valOf('--from'), 10);
  let toId = parseInt(valOf('--to'), 10);
  let targetId = parseInt(valOf('--id') || valOf('--case'), 10);
  const casesArg = valOf('--cases') || valOf('--range');
  const maxTurnsArg = parseInt(valOf('--turns') || valOf('--max-turns'), 10);

  // Deteksi argumen posisional, misal: `51-60`, `51..60`, `51 60`, atau `55`
  const nonFlagArgs = args.filter((a) => !a.startsWith('--'));
  if (nonFlagArgs.length > 0) {
    const first = nonFlagArgs[0];
    if (first.includes('-') || first.includes('..')) {
      const parts = first.split(/-|\.\./);
      fromId = parseInt(parts[0], 10);
      toId = parseInt(parts[1], 10);
    } else if (nonFlagArgs.length >= 2 && !isNaN(parseInt(nonFlagArgs[0], 10)) && !isNaN(parseInt(nonFlagArgs[1], 10))) {
      fromId = parseInt(nonFlagArgs[0], 10);
      toId = parseInt(nonFlagArgs[1], 10);
    } else if (!isNaN(parseInt(first, 10)) && isNaN(targetId) && isNaN(fromId)) {
      targetId = parseInt(first, 10);
    }
  }

  // Deteksi flag --cases atau --range
  if (casesArg) {
    if (casesArg.includes('-') || casesArg.includes('..')) {
      const parts = casesArg.split(/-|\.\./);
      fromId = parseInt(parts[0], 10);
      toId = parseInt(parts[1], 10);
    } else if (casesArg.includes(',')) {
      targetIds = new Set(casesArg.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n)));
    } else if (!isNaN(parseInt(casesArg, 10))) {
      targetId = parseInt(casesArg, 10);
    }
  }

  // Muat .env
  await import('dotenv/config');

  if (!fs.existsSync(DATASET_FILE)) {
    console.error(`Dataset file tidak ditemukan di: ${DATASET_FILE}`);
    process.exit(1);
  }

  const allCases: any[] = JSON.parse(fs.readFileSync(DATASET_FILE, 'utf8'));

  // Filter test cases
  const selected = allCases.filter((tc) => {
    if (targetIds && targetIds.size > 0) {
      return targetIds.has(tc.id);
    }
    if (!isNaN(targetId) && tc.id !== targetId) return false;
    if (!isNaN(fromId) && tc.id < fromId) return false;
    if (!isNaN(toId) && tc.id > toId) return false;
    return true;
  });

  if (selected.length === 0) {
    console.log('Tidak ada test case yang cocok dengan kriteria filter.');
    console.log('Contoh penggunaan:');
    console.log('  npx tsx scripts/run-real-conversation-tests.ts 51-60 --llm');
    console.log('  npx tsx scripts/run-real-conversation-tests.ts --from 51 --to 60 --llm');
    console.log('  npx tsx scripts/run-real-conversation-tests.ts --id 54 --llm');
    process.exit(0);
  }

  console.log(`\n======================================================`);
  console.log(`🚀 RUNNING REAL CONVERSATION TEST SUITE (${selected.length} KASUS DARI TOTAL ${allCases.length})`);
  console.log(`Target: Kasus #${selected[0].id} s/d #${selected[selected.length - 1].id}`);
  console.log(`Dataset: ${path.basename(DATASET_FILE)}`);
  console.log(`Model Mode: ${useLLM ? 'LLM ASLI (Active Tenant Config)' : 'OFFLINE / FALLBACK'}`);
  console.log(`======================================================\n`);

  // Inisialisasi service & database
  const { prisma } = await import('../src/db/client');
  const { ConversationStateMachine } = await import('../src/state-machine/machine');
  const { TypingService } = await import('../src/services/typing.service');
  const { customerService } = await import('../src/services/customer.service');
  const { conversationService } = await import('../src/services/conversation.service');
  const { DEFAULT_TENANT_ID } = await import('../src/config/tenant');
  const { AiModelConfigService } = await import('../src/config/ai-models.config');
  const { RecordingWahaClient } = await import('./lib/recording-client');

  if (useLLM) {
    try {
      await AiModelConfigService.loadConfigsFromDb(DEFAULT_TENANT_ID);
      console.log(`[CONFIG] Berhasil memuat model AI aktif dari DB PostgreSQL.`);
    } catch (e: any) {
      console.warn(`[CONFIG WARNING] Gagal memuat model dari DB, menggunakan default:`, e.message);
    }
  }

  // Pastikan label "QA Tester" tersedia di database lokal
  let qaLabel: any = null;
  try {
    qaLabel = await prisma.label.upsert({
      where: {
        tenant_id_name: {
          tenant_id: DEFAULT_TENANT_ID,
          name: 'QA Tester',
        },
      },
      update: {
        color: '#8b5cf6',
        description: 'Percakapan simulasi pengujian otomatis',
      },
      create: {
        tenant_id: DEFAULT_TENANT_ID,
        name: 'QA Tester',
        color: '#8b5cf6',
        description: 'Percakapan simulasi pengujian otomatis',
      },
    });
  } catch (e: any) {
    console.warn('[CONFIG] Label QA Tester note:', e.message);
  }

  const recorder = new RecordingWahaClient();
  const typingSvc = new TypingService(recorder, 1000);
  const machine = new ConversationStateMachine(typingSvc);

  const results: any[] = [];
  const runTimestamp = Date.now();

  for (const tc of selected) {
    let turns: string[] = tc.customerDialogueFlow || tc.customerTurns || [];
    if (!isNaN(maxTurnsArg) && maxTurnsArg > 0) {
      turns = turns.slice(0, maxTurnsArg);
    }
    console.log(`\n------------------------------------------------------`);
    console.log(`KASUS #${tc.id}: [${tc.priority || 'REAL'}] [${tc.flowCategory}] - ${tc.customerName || ''} (${turns.length} Turns)`);
    console.log(`------------------------------------------------------`);

    // Gunakan nomor telepon isolasi untuk setiap sesi testing
    const testPhone = `62899real${String(runTimestamp).slice(-4)}${String(tc.id).padStart(2, '0')}`;
    const testCustomerName = `[QA Tester #${tc.id}] ${tc.customerName || 'Customer'}`;
    const testCustomer = await customerService.getOrCreateCustomer(testPhone, testCustomerName, DEFAULT_TENANT_ID);

    // Pastikan flag is_sandbox_test aktif di database & nama ter-update
    if (!testCustomer.is_sandbox_test || testCustomer.name !== testCustomerName) {
      await prisma.customer.update({
        where: { id: testCustomer.id },
        data: { is_sandbox_test: true, name: testCustomerName },
      });
      testCustomer.is_sandbox_test = true;
      testCustomer.name = testCustomerName;
    }

    // Kaitkan label QA Tester ke customer
    if (qaLabel) {
      try {
        await prisma.customerLabel.upsert({
          where: {
            customer_id_label_id: {
              customer_id: testCustomer.id,
              label_id: qaLabel.id,
            },
          },
          update: {},
          create: {
            customer_id: testCustomer.id,
            label_id: qaLabel.id,
          },
        });
      } catch (_) {}
    }

    const testConversation = await conversationService.getOrCreateConversation(testCustomer.id, DEFAULT_TENANT_ID);

    const turnLogs: Array<{
      turn: number;
      customer: string;
      botBubbles: string[];
      durationMs: number;
      toolCalls: Array<{ tool: string; args: any }>;
      geocoding?: string;
      distanceCalc?: string;
      violations: string[];
      escalationReason?: string;
    }> = [];

    for (let turnIdx = 0; turnIdx < turns.length; turnIdx++) {
      const incomingText = turns[turnIdx];
      recorder.reset();

      const turnEvents: {
        toolCalls: Array<{ tool: string; args: any }>;
        geocoding?: string;
        distanceCalc?: string;
        violations: string[];
        escalationReason?: string;
      } = {
        toolCalls: [],
        violations: [],
      };

      const originalConsoleLog = console.log;
      console.log = (...args: any[]) => {
        const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
        if (line.includes('[V3 AGENT TOOL EXECUTE]')) {
          const m = line.match(/Tool: "([^"]+)", Args: (\{.*\})/);
          if (m) {
            try {
              turnEvents.toolCalls.push({ tool: m[1], args: JSON.parse(m[2]) });
            } catch {
              turnEvents.toolCalls.push({ tool: m[1], args: m[2] });
            }
          }
        }
        if (line.includes('[GEOCODING LOCAL HIT]')) {
          turnEvents.geocoding = line.split('[GEOCODING LOCAL HIT]')[1].trim();
        }
        if (line.includes('[DISTANCE CALC]')) {
          turnEvents.distanceCalc = line.split('[DISTANCE CALC]')[1].trim();
        }
        if (line.includes('FACTUAL_HALLUCINATION_DETECTED')) {
          try {
            const data = JSON.parse(line);
            if (data.violations) turnEvents.violations.push(...data.violations);
          } catch {}
        }
        if (line.includes('[HUMAN HANDOFF]')) {
          const rm = line.match(/Reason:\s*(.*)$/);
          if (rm) turnEvents.escalationReason = rm[1].trim();
        }
        originalConsoleLog(...args);
      };

      const startMs = Date.now();
      const incomingMessage: any = {
        id: `real_msg_${runTimestamp}_${tc.id}_${turnIdx}`,
        chatId: `${testPhone}@c.us`,
        from: testPhone,
        type: 'text',
        text: { body: incomingText },
        timestamp: String(Math.floor(Date.now() / 1000)),
      };

      // Simpan pesan INBOUND customer ke tabel messages agar tampil utuh di LiveChat
      try {
        const { messageService } = await import('../src/services/message.service');
        const { Direction } = await import('@prisma/client');
        await messageService.logMessage({
          tenantId: DEFAULT_TENANT_ID,
          conversationId: testConversation.id,
          direction: Direction.INBOUND,
          content: incomingText,
          waMessageId: incomingMessage.id,
          payloadRaw: incomingMessage,
        });
        (incomingMessage as any)._preLogged = true;
      } catch (err: any) {
        // Abaikan bila DB offline / test mock
      }

      try {
        await machine.processMessage({
          tenantId: DEFAULT_TENANT_ID,
          customer: testCustomer,
          conversation: testConversation,
          incomingMessage,
        });
      } catch (err: any) {
        recorder.sentTexts.push(`[ERROR SYSTEM]: ${err.message}`);
      } finally {
        console.log = originalConsoleLog;
      }

      const durationMs = Date.now() - startMs;
      const bubbles = [...recorder.sentTexts];

      console.log(`\n  Turn ${turnIdx + 1}:`);
      console.log(`  👤 Customer: "${incomingText}"`);
      if (turnEvents.toolCalls.length > 0) {
        turnEvents.toolCalls.forEach((tcCall) => {
          console.log(`  🛠️ Tool: ${tcCall.tool} -> ${JSON.stringify(tcCall.args)}`);
        });
      }
      console.log(`  🤖 Bot (${durationMs}ms):`);
      if (bubbles.length > 0) {
        for (const b of bubbles) {
          console.log(`     > ${b.replace(/\n/g, '\n     > ')}`);
        }
      } else {
        console.log(`     > — (tidak ada balasan teks / silent)`);
      }

      turnLogs.push({
        turn: turnIdx + 1,
        customer: incomingText,
        botBubbles: bubbles,
        durationMs,
        toolCalls: turnEvents.toolCalls,
        geocoding: turnEvents.geocoding,
        distanceCalc: turnEvents.distanceCalc,
        violations: turnEvents.violations,
        escalationReason: turnEvents.escalationReason,
      });
    }

    results.push({
      id: tc.id,
      priority: tc.priority,
      customerName: tc.customerName,
      category: tc.flowCategory,
      totalTurns: turns.length,
      turnLogs,
    });

    // Simpan laporan secara inkremental setiap kali 1 kasus selesai
    generateReport(results);
    console.log(`\n✅ [LAPORAN TERSIMPAN] Kasus #${tc.id} (${tc.customerName}) selesai (${turns.length} turns). Laporan diperbarui di: ${REPORT_FILE}\n`);
  }

  console.log(`\n🎉 Seluruh ${selected.length} kasus pengujian dalam batch ini selesai! Laporan final: ${REPORT_FILE}`);
  process.exit(0);
}

function generateReport(results: any[]) {
  const lines: string[] = [];
  lines.push('# 🔬 Laporan Evaluasi Percakapan Nyata & Tool Inspector Chatbot', '');
  lines.push(`Tanggal Uji: ${new Date().toLocaleString('id-ID')}`, '');
  lines.push(`Total Kasus Diuji: ${results.length}`, '');
  lines.push('---', '');

  for (const r of results) {
    lines.push(`## 🏥 Kasus #${r.id}: ${r.customerName || 'Customer'} — ${r.category} (${r.totalTurns} Turns)`, '');
    for (const t of r.turnLogs) {
      lines.push(`### 🔹 Turn ${t.turn}`);
      lines.push(`**👤 Customer**: \`${t.customer}\``);
      lines.push('');

      if (t.toolCalls && t.toolCalls.length > 0) {
        lines.push(`**🛠️ Tool Calls Executed**:`);
        t.toolCalls.forEach((tc: any) => {
          lines.push(`- **Tool**: \`${tc.tool}\``);
          lines.push(`  - **Args**: \`${JSON.stringify(tc.args)}\``);
        });
        lines.push('');
      }

      if (t.geocoding || t.distanceCalc) {
        lines.push(`**📍 RAG & Spatial Routing**:`);
        if (t.geocoding) lines.push(`- **Geocoding**: ${t.geocoding}`);
        if (t.distanceCalc) lines.push(`- **Distance & Ongkir**: ${t.distanceCalc}`);
        lines.push('');
      }

      if (t.violations && t.violations.length > 0) {
        lines.push(`**⚠️ Safety Guardrail Flag**:`);
        t.violations.forEach((v: string) => lines.push(`- \`${v}\``));
        lines.push('');
      }

      if (t.escalationReason) {
        lines.push(`**🚨 Human Handoff Triggered**: *${t.escalationReason}*`);
        lines.push('');
      }

      lines.push(`**🤖 Bot Response** *(${t.durationMs}ms)*:`);
      if (t.botBubbles.length > 0) {
        for (const b of t.botBubbles) {
          lines.push(`> ${b.replace(/\n/g, '\n> ')}`);
        }
      } else {
        lines.push(`> *(Tidak ada balasan teks / Silent handoff)*`);
      }
      lines.push('');
      lines.push('---');
      lines.push('');
    }
    lines.push('======================================================');
    lines.push('');
  }

  fs.writeFileSync(REPORT_FILE, lines.join('\n'), 'utf8');
}

main();
