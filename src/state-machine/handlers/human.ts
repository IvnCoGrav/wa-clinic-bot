import { ConversationState } from '@prisma/client';
import { StateHandlerContext, StateHandlerResult } from '../types';
import { conversationService } from '../../services/conversation.service';
import { handleLocationState } from './location';
import { handleInterestState } from './interest';
import { DEFAULT_TENANT_ID } from '../../config/tenant';

/**
 * Handler untuk state HUMAN_HANDLING:
 * Memeriksa auto-release timeout 6 jam. Jika masih dalam penganganan manusia (is_human_handling = true),
 * bot DIAM / TIDAK membalas otomatis. Jika sudah > 6 jam, kembalikan ke previous_state!
 */
export async function handleHumanHandlingState(ctx: StateHandlerContext): Promise<StateHandlerResult> {
  const { conversation, customer } = ctx;
  const tenantId = ctx.tenantId || customer?.tenant_id || DEFAULT_TENANT_ID;

  // 1. Periksa apakah timeout 6 jam sudah terlampaui (Auto-release evaluation)
  const autoRelease = conversationService.checkAndApplyAutoRelease(conversation, tenantId);

  // 2. Jika AUTO-RELEASE Terjadi:
  if (autoRelease.released) {
    const restoredState = autoRelease.updatedConversation.current_state as ConversationState;
    console.log(`[AUTO-RELEASE EXECUTED] Conversation ${conversation.id} restored to state: ${restoredState}`);

    // Update context dengan state baru
    ctx.conversation.current_state = restoredState;
    ctx.conversation.is_human_handling = false;

    // Rute pesan masuk ke handler state yang baru dipulihkan (misal AWAITING_LOCATION atau AWAITING_INTEREST)
    if (restoredState === ConversationState.AWAITING_LOCATION) {
      return await handleLocationState(ctx);
    } else {
      return await handleInterestState(ctx);
    }
  }

  // 3. BACKGROUND ENRICHMENT: delegasikan ke human-background-enrichment service (silent, non-blocking)
  try {
    const { humanBackgroundEnrichmentService } = await import('../../services/human-background-enrichment.service');
    const hist = (ctx as any).history || [];
    await humanBackgroundEnrichmentService.enrichSync({ ...ctx, history: hist } as any, tenantId);
  } catch (enrichErr: any) {
    console.warn('[HUMAN HANDLER ENRICH ERROR]', enrichErr.message);
  }

  // 3b. Legacy reservation auto-capture sebagai backup idempoten 24h
  const userText = ctx.incomingMessage.text?.body || '';
  if (userText.trim()) {
    try {
      const { isReservationFormMessage, parseReservationText } = await import('../../utils/reservation-text-parser');
      if (isReservationFormMessage(userText)) {
        const parseResult = parseReservationText(userText);
        if (parseResult.success && parseResult.reservation) {
          const parsed = parseResult.reservation;
          const { prisma } = await import('../../db/client');
          const recentExisting = await prisma.reservation.findFirst({
            where: {
              customer_id: customer.id,
              tenant_id: tenantId,
              created_at: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
              treatment_detail: parsed.treatmentDetail,
            },
          });
          if (!recentExisting) {
            const reservation = await prisma.reservation.create({
              data: {
                tenant_id: tenantId,
                customer_id: customer.id,
                treatment_category: parsed.treatmentCategory,
                treatment_detail: parsed.treatmentDetail,
                booking_date: parsed.bookingDate,
                raw_text: userText,
                status: 'pending',
              },
            });
            console.log(`[HUMAN HANDLER AUTO-CAPTURE] Created reservation ${reservation.id} for customer ${customer.phone} (${parsed.treatmentDetail})`);
            const { reservationLifecycleService } = await import('../../services/reservation-lifecycle.service');
            await reservationLifecycleService.onReservationCreated({
              customerId: customer.id,
              reservationId: reservation.id,
              tenantId,
              chatId: ctx.incomingMessage.chatId || `${customer.phone}@c.us`,
              babies: parsed.babies || [],
              customerName: parsed.name,
              kecamatan: parsed.kec,
              kota: parsed.kota,
              kelurahan: parsed.address,
            }).catch(() => {});
            try {
              const { fireCapiEvent } = await import('../../services/capi.service');
              fireCapiEvent({ eventName: 'InitiateCheckout', customer, tenantId, customData: { source: 'HUMAN_HANDLER_FORM_CAPTURE', treatment: parsed.treatmentDetail } });
            } catch {}
            const cName = parsed.name?.trim();
            if (cName && cName.length > 0 && cName.toLowerCase() !== 'bunda') {
              const kec = customer.kecamatan || '';
              const contactName = `Bunda ${cName}${kec ? ` ${kec}` : ''}`.trim();
              const { customerService } = await import('../../services/customer.service');
              await customerService.updateCustomerName(customer.id, contactName, tenantId).catch(() => {});
            }
          }
        }
      }
    } catch {}
  }

  // 4. Jika MASIH dalam Human Handling (< 6 jam):
  // BOT TIDAK BOLEH MEMBALAS OTOMATIS KE THREAD INI!
  console.log(`[HUMAN HANDLING ACTIVE] Conversation ${conversation.id} is managed by human agent. Bot stays silent.`);

  return {
    nextState: ConversationState.HUMAN_HANDLING,
    shouldSendReply: false, // TIDAK kirim balasan otomatis
    isHumanHandling: true,
  };
}
