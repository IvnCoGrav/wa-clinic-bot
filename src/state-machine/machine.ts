import { ConversationState, Direction } from '@prisma/client';
import { StateHandlerContext, StateHandlerResult } from './types';
import { handleGreetingState } from './handlers/greeting';
import { handleLocationState } from './handlers/location';
import { handleInterestState } from './handlers/interest';
import { handleHumanHandlingState } from './handlers/human';
import { handleLocationConfirmationState } from './handlers/location-confirmation';
import { conversationService } from '../services/conversation.service';
import { messageService } from '../services/message.service';
import { customerService } from '../services/customer.service';
import { TypingService, typingService } from '../services/typing.service';
import { wahaClient } from '../integrations/waha/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';

export class ConversationStateMachine {
  private typingSvc: TypingService;

  constructor(typingSvc?: TypingService) {
    this.typingSvc = typingSvc || typingService;
  }

  /**
   * Core State Machine Engine:
   * Memproses pesan masuk, mengarahkan ke handler state yang sesuai, 
   * dan mengirim balasan otomatis MENGGUNAKAN SIMULASI MENGETIK (typingService).
   */
  public async processMessage(ctx: StateHandlerContext): Promise<StateHandlerResult> {
    const { customer, conversation, incomingMessage } = ctx;
    const tenantId = ctx.tenantId || customer.tenant_id || DEFAULT_TENANT_ID;

    // --- GATE KELAS 🔴: BLOCKED CUSTOMER ---
    if (customer.status === 'blocked') {
      console.warn(`[SECURITY WARNING] [BLOCKED CUSTOMER] Phone ${customer.phone} is blocked. Bypassing processing.`);
      return {
        nextState: conversation.current_state,
        shouldSendReply: false,
      };
    }

    // 1. Audit Log Pesan Inbound (Masuk)
    const inboundContent = incomingMessage.text?.body || (incomingMessage.location ? `[LOCATION SHARE: Lat ${incomingMessage.location.latitude}, Lng ${incomingMessage.location.longitude}]` : '[MEDIA/UNKNOWN]');
    await messageService.logMessage({
      tenantId,
      conversationId: conversation.id,
      direction: Direction.INBOUND,
      content: inboundContent,
      waMessageId: incomingMessage.id,
      payloadRaw: incomingMessage,
    });

    // In-memory rewriting for Promo[CODE] greeting trigger
    if (incomingMessage.text?.body && /Promo\[(\w+)\]/i.test(incomingMessage.text.body)) {
      incomingMessage.text.body = 'Halo';
    }

    // --- GATE KELAS 🏥: MEDICAL CONCERN DETECTION ENGINE ---
    const incomingText = incomingMessage.text?.body || '';
    const { MedicalDetectionService } = await import('../services/medical-detection.service');
    const medicalResult = MedicalDetectionService.detectMedicalConcern(incomingText);

    if (medicalResult.isMedical) {
      const { knowledgeBaseService } = await import('../services/knowledge.service');
      const approvedFaqMatch = await knowledgeBaseService.findMatchingFaq(incomingText, tenantId);

      // Exemption: If approved medical FAQ matches, allow bot to answer facts from approved FAQ
      if (approvedFaqMatch && (approvedFaqMatch as any).category === 'medical' && (approvedFaqMatch as any).status === 'APPROVED') {
        console.log(`[MEDICAL FAQ EXEMPTION] Approved medical FAQ found for "${incomingText}". Proceeding with official FAQ response.`);
      } else {
        const isHigh = medicalResult.severity === 'HIGH';
        console.log(`[MEDICAL ESCALATION] Severity ${medicalResult.severity} detected for customer ${customer.phone}. Symptoms: ${medicalResult.detectedSymptoms.join(', ')}`);

        // Set conversation to HUMAN_HANDLING with escalation_reason = 'medical_concern'
        conversation.is_human_handling = true;
        conversation.human_handling_since = new Date();
        conversation.escalation_reason = 'medical_concern';

        await conversationService.escalateToHumanHandling(
          conversation,
          customer.phone,
          `Kondisi medis terdeteksi (Severity: ${medicalResult.severity})`,
          tenantId,
          'medical_concern'
        );

        // Emergency template based on severity (HIGH vs MEDIUM)
        const replyText = isHigh
          ? 'Bunda, untuk kondisi darurat seperti ini mohon segera bawa si kecil ke IGD/Rumah Sakit terdekat atau hubungi layanan darurat 119 ya Bunda. Tim Bidan & CS kami juga akan segera menghubungi Bunda secara langsung.'
          : 'Bunda, untuk pertimbangan kondisi kesehatan si kecil, Bidan & CS kami akan segera membalas pesan Bunda secara langsung. Mohon tunggu sebentar ya Bunda.';

        // Dispatch Real-Time Alert to Telegram / Emergency Log
        try {
          const { AlertService, AlertType, AlertSeverity } = await import('../services/alert.service');
          const alertService = new AlertService();
          await alertService.notifyAlert({
            type: isHigh ? AlertType.MEDICAL_EMERGENCY_HIGH : AlertType.MEDICAL_CONCERN_MEDIUM,
            severity: isHigh ? AlertSeverity.CRITICAL : AlertSeverity.WARNING,
            message: `[MEDICAL ALERT ${medicalResult.severity}] Customer: ${customer.phone}. Symptoms: ${medicalResult.detectedSymptoms.join(', ')}. Text: "${incomingText}"`,
            metadata: {
              customerPhone: customer.phone,
              detectedSymptoms: medicalResult.detectedSymptoms,
              incomingText,
            },
          });
        } catch (alertErr: any) {
          console.error('[EMERGENCY LOG FALLBACK] Failed to trigger alert for medical emergency:', alertErr.message);
        }

        // Send 1x template reply and then remain SILENT
        const chatId = (incomingMessage as any).chatId || `${customer.phone}@c.us`;
        await this.typingSvc.simulateHumanReply({
          chatId,
          incomingMessageId: incomingMessage.id,
          incomingText,
          replyText,
        });

        await messageService.logMessage({
          tenantId,
          conversationId: conversation.id,
          direction: Direction.OUTBOUND,
          content: replyText,
        });

        return {
          nextState: ConversationState.HUMAN_HANDLING,
          shouldSendReply: false,
          isHumanHandling: true,
        };
      }
    }


    // 2. Cek Auto-Release Timeout terlebih dahulu jika sedang Human Handling
    const autoRelease = conversationService.checkAndApplyAutoRelease(conversation, tenantId);
    let activeConversation = autoRelease.updatedConversation;

    // --- PENGECEKAN IDLE TIMEOUT > 24 JAM ATAU 5 MENIT UNTUK LOCATION_CONFIRMED ---
    const IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000;
    const CONFIRMATION_TIMEOUT_MS = 5 * 60 * 1000; // 5 menit

    const lastMsgTime = activeConversation.last_message_at ? new Date(activeConversation.last_message_at).getTime() : 0;
    const isIdleTooLong = lastMsgTime > 0 && (Date.now() - lastMsgTime > IDLE_TIMEOUT_MS);
    const isConfirmationTimeout = activeConversation.current_state === ConversationState.LOCATION_CONFIRMED &&
      lastMsgTime > 0 && (Date.now() - lastMsgTime > CONFIRMATION_TIMEOUT_MS);

    if ((isIdleTooLong || isConfirmationTimeout) && activeConversation.current_state !== ConversationState.INITIAL && !activeConversation.is_human_handling) {
      if (isConfirmationTimeout) {
        console.log(`[CONFIRMATION TIMEOUT] Resetting conversation ${activeConversation.id} from LOCATION_CONFIRMED to INITIAL due to 5-minute inactivity.`);
      } else {
        console.log(`[IDLE TIMEOUT] Resetting conversation ${activeConversation.id} from ${activeConversation.current_state} to INITIAL.`);
      }
      
      // Clean up pending location jika di-reset
      await customerService.clearPendingLocation(customer.id, tenantId);
      customer.pending_kelurahan = null;
      customer.pending_kecamatan = null;
      customer.pending_kota = null;
      customer.pending_lat = null;
      customer.pending_lng = null;

      await conversationService.updateConversationState(
        activeConversation.id,
        {
          currentState: ConversationState.INITIAL,
          previousState: null,
          locationAttempts: 0,
        },
        tenantId
      );
      activeConversation.current_state = ConversationState.INITIAL;
    }

    let result: StateHandlerResult;

    // 3. Routing ke State Handler yang sesuai
    const { AiModelConfigService } = await import('../config/ai-models.config');
    if (!AiModelConfigService.globalBotActive && !activeConversation.is_human_handling) {
      console.log(`[GLOBAL BOT DEACTIVATED] Bypassing bot responder and routing customer ${customer.phone} directly to human handling.`);
      await conversationService.escalateToHumanHandling(
        activeConversation,
        customer.phone,
        'Global bot disabled',
        tenantId,
        'global_bot_disabled'
      );
      activeConversation.is_human_handling = true;
      activeConversation.current_state = ConversationState.HUMAN_HANDLING;
    }

    const handlerCtx = { ...ctx, tenantId, conversation: activeConversation };
    if (activeConversation.is_human_handling) {
      result = await handleHumanHandlingState(handlerCtx);

    } else {
      switch (activeConversation.current_state) {
        case ConversationState.INITIAL:
          result = await handleGreetingState(handlerCtx);
          break;

        case ConversationState.AWAITING_LOCATION:
          result = await handleLocationState(handlerCtx);
          break;

        case ConversationState.LOCATION_CONFIRMED:
          result = await handleLocationConfirmationState(handlerCtx);
          break;

        case ConversationState.AWAITING_INTEREST:
          result = await handleInterestState(handlerCtx);
          break;

        case ConversationState.RESERVATION_SENT:
        case ConversationState.COMPLETED:
          result = await handleInterestState(handlerCtx);
          break;

        case ConversationState.HUMAN_HANDLING:
          result = await handleHumanHandlingState(handlerCtx);
          break;

        default:
          result = await handleGreetingState(handlerCtx);
          break;
      }
    }

    // 4. Update Conversation State di Database
    await conversationService.updateConversationState(
      activeConversation.id,
      {
        currentState: result.nextState,
        isHumanHandling: result.isHumanHandling,
      },
      tenantId
    );

    // --- TEMPORARY SAFETY NET: INTERCEPT & APPROVE VIA TERMINAL ---
    if (process.env.TERMINAL_APPROVAL_ENABLED === 'true' && process.env.NODE_ENV !== 'test' && result.shouldSendReply && result.replyText) {
      const finalReply = await this.promptTerminal(
        result.replyText,
        incomingMessage.text?.body || (incomingMessage.location ? '[SHARE LOCATION]' : '[MEDIA]'),
        customer.phone
      );
      if (finalReply === null) {
        result.shouldSendReply = false;
      } else {
        result.replyText = finalReply;
      }
    }

    // 5. Kirim Balasan Otomatis via Typing Simulation Service jika required
    if (result.shouldSendReply && result.replyText) {
      // Memulai alur simulasi ngetik manusia: sendSeen -> reading delay -> per bubble (startTyping -> typing delay -> stopTyping -> sendText)
      const chatId = (incomingMessage as any).chatId || `${customer.phone}@c.us`;
      const resultHuman = await this.typingSvc.simulateHumanReply({
        chatId,
        incomingMessageId: incomingMessage.id,
        incomingText: incomingMessage.text?.body || '',
        replyText: result.replyText,
      });

      if (resultHuman.success) {
        // Audit Log Pesan Outbound (Keluar)
        await messageService.logMessage({
          tenantId,
          conversationId: activeConversation.id,
          direction: Direction.OUTBOUND,
          content: result.replyText,
        });

        // Kirim Pricelist Image jika diinstruksikan oleh state handler (hanya 1x per customer)
        if (result.sendPricelistImage) {
          try {
            const { prisma } = await import('../db/client');
            const dbCustomer = await prisma.customer.findUnique({
              where: { id: customer.id }
            });
            const alreadySent = dbCustomer ? dbCustomer.pricelist_sent : false;

            if (!alreadySent) {
              const pricelistUrl = process.env.CLINIC_PRICELIST_IMAGE_URL || 'assets/pricelist_spa.jpg';
              await wahaClient.sendImage(chatId, pricelistUrl, "Pricelist Kala Moms & Baby Spa 🌸");

              if (dbCustomer) {
                await prisma.customer.update({
                  where: { id: customer.id },
                  data: { pricelist_sent: true }
                });
                customer.pricelist_sent = true;
              }
            } else {
              console.log(`[PRICELIST SKIPPED] Pricelist image was already sent to customer ${customer.phone}. Skipping duplicate send.`);
            }
          } catch (dbErr: any) {
            console.error('[PRICELIST ERROR] Failed to query/update pricelist_sent:', dbErr.message);
            const pricelistUrl = process.env.CLINIC_PRICELIST_IMAGE_URL || 'assets/pricelist_spa.jpg';
            await wahaClient.sendImage(chatId, pricelistUrl, "Pricelist Kala Moms & Baby Spa 🌸");
          }
        }
      }
    }

    return result;
  }

  private promptTerminal(proposedReply: string, incomingText: string, phone: string): Promise<string | null> {
    return new Promise((resolve) => {
      const readline = require('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      console.log('\n============================================================');
      console.log(`🌸 [SAFETY NET INTERCEPTED]`);
      console.log(`   Customer: ${phone}`);
      console.log(`   Pesan Masuk: "${incomingText}"`);
      console.log(`------------------------------------------------------------`);
      console.log(`   Proposed Bot Reply:`);
      console.log(proposedReply);
      console.log(`------------------------------------------------------------`);
      console.log(`Pilihan:`);
      console.log(`  - Tekan [Enter] atau ketik 'y' untuk SETUJU dan kirim`);
      console.log(`  - Ketik 'n' untuk BATALKAN pengiriman`);
      console.log(`  - Ketik kalimat kustom Anda di bawah ini untuk OVERRIDE balasan`);
      console.log('============================================================');

      rl.question('Masukkan pilihan / pesan kustom Anda: ', (answer: string) => {
        rl.pause(); // Pause stream instead of closing, preserving process.stdin for subsequent inputs and avoiding tsx watch EOF crash
        const clean = answer.trim();
        if (clean === '' || clean.toLowerCase() === 'y') {
          resolve(proposedReply);
        } else if (clean.toLowerCase() === 'n') {
          resolve(null);
        } else {
          resolve(clean);
        }
      });
    });
  }
}

export const stateMachine = new ConversationStateMachine();
