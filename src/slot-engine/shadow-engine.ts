import { StateHandlerContext } from '../state-machine/types';
import { SlateStore } from './slate-store';
import { EntityExtractor } from './entity-extractor';
import { DecisionMatrix } from './decision-matrix';
import { GroundingComposer } from './grounding-composer';
import { ReplyGenerator } from './reply-generator';
import { DEFAULT_TENANT_ID } from '../config/tenant';

/**
 * Shadow Engine Runner — menjalankan Unified Pipeline di background tanpa memblokir balasan aktif
 * dan tanpa mengirim pesan ke WhatsApp. Hasil dicatat ke llm_audit_logs dengan eval_run.
 */
export class ShadowEngine {
  public static async runShadowTurn(ctx: StateHandlerContext): Promise<void> {
    const start = Date.now();
    const tenantId = ctx.tenantId || (ctx.customer as any)?.tenant_id || DEFAULT_TENANT_ID;
    const incomingText = ctx.incomingMessage?.text?.body || '';
    // Clone slate agar tidak mengotori state produksi
    const initialSlate = SlateStore.hydrateSlate(ctx);
    try {
      const extraction = await EntityExtractor.extract(incomingText, {
        history: ctx.history as any,
        customerPhone: ctx.customer.phone,
        conversationId: ctx.conversation.id,
        tenantId,
        incomingMessage: ctx.incomingMessage,
      });
      const slateAfterExtraction = SlateStore.updateSlateWithExtraction({ ...initialSlate }, extraction);
      const decision = await DecisionMatrix.evaluate(slateAfterExtraction, extraction, {
        tenantId,
        incomingText,
        history: ctx.history as any,
      });

      let shadowReply: string | null = decision.deterministicTemplateReply || null;
      let slateForGrounding = decision.updatedSlate;
      if (!shadowReply) {
        const grounding = await GroundingComposer.compose(decision.updatedSlate, extraction, {
          customerInput: incomingText,
          tenantId,
        });
        // Sinkronisasi HANYA jika pelanggan eksplisit memilih treatment (tanpa auto-fill)
        if (!slateForGrounding.selectedTreatmentName && extraction.treatmentReferenced) {
          slateForGrounding.selectedTreatmentName = extraction.treatmentReferenced;
        }
        try {
          shadowReply = await ReplyGenerator.generate(slateForGrounding, extraction, grounding, {
            history: ctx.history as any,
            customerPhone: ctx.customer.phone,
            customerInput: incomingText,
            tenantId,
          });
        } catch (e: any) {
          shadowReply = `[SHADOW ERROR] ${e.message}`;
        }
      }

      const latencyMs = Date.now() - start;
      // Catat ke llm_audit_logs dengan eval_run = shadow_unified_v1 (best-effort, jangan ganggu produksi)
      try {
        const { recordLlmExecution } = await import('../utils/llm-execution-logger');
        await recordLlmExecution({
          flowType: 'SHADOW_UNIFIED_V1',
          customerPhone: ctx.customer.phone,
          customerInput: incomingText,
          promptPayload: { shadow: true, tenantId },
          reasoning: `Shadow run: action=${decision.action} reason=${decision.reason}`,
          groundTruthUsed: { filteredCatalog: (await GroundingComposer.compose(decision.updatedSlate, extraction, { customerInput: incomingText, tenantId })).filteredCatalog } as any,
          finalReply: shadowReply || '',
          modelUsed: 'shadow-unified-v1',
          durationMs: latencyMs,
          status: 'SUCCESS',
          evalRun: 'shadow_unified_v1',
        } as any);
      } catch {}

      // Juga catat ringkas ke llm_audit_logs via prisma (best-effort)
      try {
        const { prisma } = await import('../db/client');
        await prisma.llmAuditLog.create({
          data: {
            tenant_id: tenantId,
            customer_phone: ctx.customer.phone,
            task_type: 'SHADOW_UNIFIED_V1',
            model_name: 'shadow-unified-v1',
            eval_run: 'shadow_unified_v1',
            prompt_tokens: 0,
            completion_tokens: 0,
            cost_idr: 0,
            latency_ms: latencyMs,
          },
        }).catch(() => {});
      } catch {}
    } catch (err: any) {
      // Isolasi mutlak: error shadow tidak boleh mempengaruhi alur produksi
      console.warn('[SHADOW ENGINE] Shadow run failed (isolated):', err.message);
      try {
        const { recordLlmExecution } = await import('../utils/llm-execution-logger');
        await recordLlmExecution({
          flowType: 'SHADOW_UNIFIED_V1',
          customerPhone: ctx.customer.phone,
          customerInput: incomingText,
          promptPayload: {},
          reasoning: `Shadow error: ${err.message}`,
          finalReply: '',
          modelUsed: 'shadow-unified-v1',
          durationMs: Date.now() - start,
          status: 'FAILED',
          evalRun: 'shadow_unified_v1',
        } as any);
      } catch {}
    }
  }
}
