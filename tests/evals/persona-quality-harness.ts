/**
 * persona-quality-harness.ts — Gate kualitas bahasa persona (PLAN 9 FASE 9.2).
 *
 * Menjalankan subset skenario golden corpus lewat ConversationStateMachine ASLI
 * dengan LLM NYATA, lalu menilai tiap balasan dengan rubrik persona
 * (src/evals/persona-rubric.ts — single source, sama dengan evaluator produksi).
 *
 * BUKAN bagian `npm test` offline: membutuhkan LLM_API_KEY. Tanpa key → exit 0
 * dengan pesan skip (tidak menghijaukan palsu, tidak memerahkan).
 *
 * Usage:
 *   npx tsx tests/evals/persona-quality-harness.ts               # semua skenario (mahal!)
 *   npx tsx tests/evals/persona-quality-harness.ts --limit=5     # 5 skenario pertama
 *   npx tsx tests/evals/persona-quality-harness.ts --dry-run     # validasi skrip tanpa LLM
 *   npx tsx tests/evals/persona-quality-harness.ts --min=3.5     # ambang rata-rata
 */

/* eslint-disable no-console */
import {
  PERSONA_DIMENSIONS,
  PERSONA_OVERALL_MIN_PASS,
  buildPersonaJudgeSystemPrompt,
  averagePersonaScore,
  failingPersonaDimensions,
} from '../../src/evals/persona-rubric';

interface HarnessTurn {
  input: string;
  reply: string;
  avg: number | null;
  failing: string[];
  feedback: string;
}

async function main() {
  await import('dotenv/config');

  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const minArg = process.argv.find((a) => a.startsWith('--min='));
  const dryRun = process.argv.includes('--dry-run');
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) || 0 : 0;
  const minAvg = minArg ? parseFloat(minArg.split('=')[1]) || PERSONA_OVERALL_MIN_PASS : PERSONA_OVERALL_MIN_PASS;

  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '';
  if (!dryRun && (!apiKey || apiKey.startsWith('mock'))) {
    console.log('[PERSONA QUALITY] LLM_API_KEY tidak tersedia — harness dilewati (bukan bagian gate offline).');
    return;
  }

  const { allGoldenScenarios } = await import('../golden-corpus/index');
  const scenarios = limit > 0 ? allGoldenScenarios.slice(0, limit) : allGoldenScenarios;
  console.log(`[PERSONA QUALITY] Skenario: ${scenarios.length}, ambang rata-rata: ${minAvg}`);

  if (dryRun) {
    console.log('[PERSONA QUALITY] dry-run OK: rubrik valid, skenario termuat.');
    console.log(`[PERSONA QUALITY] Dimensi: ${PERSONA_DIMENSIONS.map((d) => `${d.key}(≥${d.minPass})`).join(', ')}`);
    console.log('[PERSONA QUALITY] Prompt judge preview (200 char):');
    console.log(buildPersonaJudgeSystemPrompt().slice(0, 200) + '...');
    return;
  }

  const { getLlmEndpointConfig, callChatWithRetry } = await import('../../src/integrations/llm/llm-gateway');
  const { AiModelConfigService } = await import('../../src/config/ai-models.config');
  const endpoint = getLlmEndpointConfig({ modelConfigKey: 'CHAT_REPLY' });
  const config = AiModelConfigService.getModelConfig('CHAT_REPLY');

  // Jalankan skenario lewat pipeline ASLI (bukan stub) — butuh DB + LLM nyata.
  // Catatan: harness ini untuk lingkungan staging/live, bukan CI offline.
  const { customerService } = await import('../../src/services/customer.service');
  const { conversationService } = await import('../../src/services/conversation.service');
  const { ConversationStateMachine } = await import('../../src/state-machine/machine');
  const { TypingService } = await import('../../src/services/typing.service');
  const { MockWAHAClient } = await import('../../src/cli/mock-waha-client');
  const { DEFAULT_TENANT_ID } = await import('../../src/config/tenant');

  const judgeSystem = buildPersonaJudgeSystemPrompt();
  const allTurns: Array<HarnessTurn & { scenario: string; turn: number }> = [];

  let idx = 0;
  for (const sc of scenarios) {
    idx++;
    const phone = `6289000${String(100000 + idx).slice(-6)}`;
    const customer: any = await customerService.getOrCreateCustomer(phone, `Quality ${sc.id}`, DEFAULT_TENANT_ID);
    const conversation: any = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    const client = new MockWAHAClient();
    const sentTexts: string[] = [];
    const origSend = client.sendText.bind(client);
    (client as any).sendText = async (...args: any[]) => {
      sentTexts.push(String(args[1] ?? args[0] ?? ''));
      return origSend(...args);
    };
    const machine = new ConversationStateMachine(new TypingService(client as any));

    let n = 0;
    for (const turn of sc.turns) {
      n++;
      await machine.processMessage({
        tenantId: DEFAULT_TENANT_ID,
        customer,
        conversation,
        incomingMessage: {
          id: `quality_${Date.now()}_${idx}_${n}`,
          from: phone,
          chatId: `${phone}@c.us`,
          timestamp: String(Date.now()),
          type: 'text',
          text: { body: turn.input },
        } as any,
      });
      const reply = sentTexts.slice(-1)[0] ?? '';

      const judgeRes = await callChatWithRetry({
        baseUrl: endpoint.baseUrl,
        apiKey: endpoint.apiKey,
        model: endpoint.model,
        fallbackModel: endpoint.fallbackModel,
        timeoutMs: 30000,
        maxRetries: 1,
        retryDelayMs: 500,
        payload: {
          model: endpoint.model,
          temperature: 0.2,
          max_tokens: 600,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: judgeSystem },
            { role: 'user', content: `PERTANYAAN CUSTOMER: ${turn.input}\nJAWABAN BOT: ${reply}` },
          ],
        },
      });
      const raw = judgeRes.data?.choices?.[0]?.message?.content?.trim() || '{}';
      let parsed: any = {};
      try {
        parsed = JSON.parse(raw.replace(/^```(json)?\n?/, '').replace(/\n?```$/, '').trim());
      } catch {
        parsed = {};
      }
      const avg = averagePersonaScore(parsed);
      allTurns.push({
        scenario: sc.id, turn: n, input: turn.input, reply,
        avg, failing: failingPersonaDimensions(parsed), feedback: String(parsed.feedback || ''),
      });
      console.log(`[${sc.id} t${n}] avg=${avg === null ? '?' : avg.toFixed(2)} failing=${failingPersonaDimensions(parsed).join(',') || '-'}`);
    }
  }

  const scored = allTurns.filter((t) => t.avg !== null);
  const overall = scored.length ? scored.reduce((a, t) => a + (t.avg as number), 0) / scored.length : 0;
  const below = allTurns.filter((t) => t.avg !== null && (t.avg as number) < minAvg);
  console.log(`\n[PERSONA QUALITY] Turn ternilai: ${scored.length}/${allTurns.length}, rata-rata: ${overall.toFixed(2)}, di bawah ambang: ${below.length}`);
  for (const t of below.slice(0, 10)) {
    console.log(`  - ${t.scenario} t${t.turn} avg=${(t.avg as number).toFixed(2)} failing=${t.failing.join(',')} :: ${t.feedback}`);
  }

  if (overall < minAvg) {
    console.error(`[PERSONA QUALITY] GAGAL: rata-rata ${overall.toFixed(2)} < ambang ${minAvg}`);
    process.exit(1);
  }
  console.log('[PERSONA QUALITY] LULUS.');
}

main().catch((err) => {
  console.error('[PERSONA QUALITY] Gagal:', err?.message || err);
  process.exit(1);
});
