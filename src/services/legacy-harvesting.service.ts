import { prisma } from '../db/client';
import { wahaClient } from '../integrations/waha/client';
import { MedicalDetectionService } from './medical-detection.service';
import { AiModelConfigService } from '../config/ai-models.config';
import { parseReservationText } from '../utils/reservation-text-parser';

import { DEFAULT_TENANT_ID } from '../config/tenant';

export interface HarvestingProgressStats {
  status: 'IDLE' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  progressPercent: number;
  totalChatsScanned: number;
  totalMessagesScanned: number;
  medicalStagedCount: number;
  generalStagedCount: number;
  legacyLeadsExtractedCount: number;
  errorMessage?: string;
}

let activeHarvestingJob: HarvestingProgressStats = {
  status: 'IDLE',
  progressPercent: 0,
  totalChatsScanned: 0,
  totalMessagesScanned: 0,
  medicalStagedCount: 0,
  generalStagedCount: 0,
  legacyLeadsExtractedCount: 0,
};

export class LegacyHarvestingService {
  /**
   * PII Scrubbing: Best-effort regex scrubbing of phone numbers, bank accounts, emails, and names.
   */
  static scrubPII(text: string): string {
    if (!text || typeof text !== 'string') return '';

    let cleaned = text;

    // 1. Scrub Phone Numbers (explicitly starting with 08xx, 628xx, or +628xx)
    cleaned = cleaned.replace(/(?:\+?62|0)8[1-9][0-9]{7,10}\b/gi, '[REDACTED_PHONE]');

    // 2. Scrub Bank Account Numbers (numbers after rekening / BCA / Mandiri etc or 10-16 standalone digits)
    cleaned = cleaned.replace(/(?:rekening|rek|bca|mandiri|bni|bri|cimb)\s*[:.-]?\s*\b\d{10,16}\b/gi, '[REDACTED_ACCOUNT]');

    // 3. Scrub Email Addresses
    cleaned = cleaned.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[REDACTED_EMAIL]');

    // 4. Best-Effort Name Scrubbing (Phrases starting with Bunda/Ibu/Kak followed by capitalized names)
    cleaned = cleaned.replace(/\b(?:Bunda|Ibu|Kak|Bu)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g, 'Bunda [REDACTED_NAME]');

    return cleaned;
  }



  /**
   * Pre-AI Junk Filter: Skip short (<10 chars) or junk messages.
   */
  static isJunkMessage(text: string): boolean {
    if (!text || typeof text !== 'string') return true;

    const trimmed = text.trim().toLowerCase();
    if (trimmed.length < 10) return true;

    const junkPhrases = [
      'ok', 'okay', 'ya', 'ya bunda', 'siap', 'terima kasih', 'makasih', 'halo',
      'p', 'ping', 'lokasi', 'assalamualaikum', 'sore', 'pagi', 'malam', 'siang'
    ];

    if (junkPhrases.includes(trimmed)) return true;

    // Skip single emojis or punctuation
    if (/^[^\w\s]+$/u.test(trimmed)) return true;

    return false;
  }

  /**
   * Filter Penjadwalan & Form Reservasi:
   * Pertanyaan terkait reschedule, booking slot, jam operasional spesifik, atau pengisian form reservasi
   * diklasifikasikan sebagai transaksi atau di-exclude total dari kandidat FAQ.
   */
  static isTransactionOrScheduleMessage(text: string): boolean {
    if (!text || typeof text !== 'string') return false;
    const lower = text.toLowerCase();
    const pattern = /\b(reschedule|jadwal|jam berapa|isi form|buka jam|slot|booking|reservasi|ganti hari|pindah hari|isi data|kirim form)\b/i;
    return pattern.test(lower);
  }

  /**
   * Anti-Duplication Guard: Checks if question already exists in MedicalFaqStaging, GeneralFaqStaging, or FaqItem
   */
  static async isDuplicateFaq(question: string, tenantId: string): Promise<boolean> {
    const cleaned = question.trim().toLowerCase();

    try {
      // 1. Check GeneralFaqStaging
      const existingGeneral = await prisma.generalFaqStaging.findFirst({
        where: { tenant_id: tenantId, raw_question: { contains: cleaned.substring(0, 20) } },
      });
      if (existingGeneral) return true;

      // 2. Check MedicalFaqStaging
      const existingMedical = await prisma.medicalFaqStaging.findFirst({
        where: { tenant_id: tenantId, raw_question: { contains: cleaned.substring(0, 20) } },
      });
      if (existingMedical) return true;

      // 3. Check official KnowledgeBase FAQ
      const existingFaq = await prisma.knowledgeChunk.findFirst({
        where: { tenant_id: tenantId, title: { contains: cleaned.substring(0, 20) } },
      });
      if (existingFaq) return true;
    } catch (err) {
      // Fallback for mock mode
    }

    return false;
  }

  /**
   * Get Current Harvesting Job Status & Statistics (for UI Polling)
   */
  static getJobStatus(): HarvestingProgressStats {
    return activeHarvestingJob;
  }

  /**
   * Main Async Harvesting Worker Engine:
   * 1. Fetches historical chats from WAHA API
   * 2. Extracts Q&A pairs & Lead/Purchase data
   * 3. Performs PII Scrubbing & Pre-AI Filtering
   * 4. Routes Medical ➔ MedicalFaqStaging, Non-Medical ➔ GeneralFaqStaging, Leads ➔ LegacyStaging
   */
  static async runHarvestingJob(tenantId: string = DEFAULT_TENANT_ID): Promise<HarvestingProgressStats> {
    if (activeHarvestingJob.status === 'PROCESSING') {
      return activeHarvestingJob;
    }

    // Resolve AI model dynamically from AI Model Config Registry
    const aiConfig = AiModelConfigService.getModelConfig('HARVESTING');
    console.log(`[HARVESTING ENGINE] Starting harvesting job using model '${aiConfig.modelName}' (${aiConfig.provider})...`);

    activeHarvestingJob = {
      status: 'PROCESSING',
      progressPercent: 5,
      totalChatsScanned: 0,
      totalMessagesScanned: 0,
      medicalStagedCount: 0,
      generalStagedCount: 0,
      legacyLeadsExtractedCount: 0,
    };

    // Execute in background
    setTimeout(async () => {
      try {
        const chats = await wahaClient.getChats();
        activeHarvestingJob.totalChatsScanned = chats.length || 1;
        activeHarvestingJob.progressPercent = 25;

        for (let i = 0; i < Math.min(chats.length, 10); i++) {
          const chat = chats[i];
          const messages = await wahaClient.getMessages(chat.id, 20);
          activeHarvestingJob.totalMessagesScanned += messages.length;

          for (let j = 0; j < messages.length - 1; j++) {
            const currentMsg = messages[j];
            const nextMsg = messages[j + 1];

            // Match Inbound question from customer -> Outbound answer from admin/bidan
            if (!currentMsg.fromMe && nextMsg.fromMe && currentMsg.body && nextMsg.body) {
              const rawQ = currentMsg.body;
              const rawA = nextMsg.body;

              // 1. Pre-AI Junk Filter & Schedule/Form Exclusion
              if (this.isJunkMessage(rawQ)) continue;
              if (this.isTransactionOrScheduleMessage(rawQ)) {
                // If it's a schedule/form message, check if it extracts a lead for LegacyStaging, but EXCLUDE from FAQ staging!
                const reservationDetails = parseReservationText(`${rawQ}\n${rawA}`);
                if (reservationDetails.success && reservationDetails.reservation) {
                  try {
                    const phoneNum = chat.id.replace(/@.*$/, '');
                    const existingLead = await prisma.legacyStaging.findUnique({
                      where: { phoneNumber: phoneNum }
                    });
                    if (!existingLead) {
                      await prisma.legacyStaging.create({
                        data: {
                          tenantId: tenantId,
                          phoneNumber: phoneNum,
                          name: reservationDetails.reservation.name || 'Customer Lama',
                          extractedLocation: reservationDetails.reservation.address || null,
                          leadCreatedAt: new Date(),
                          extractedReservationJson: JSON.parse(JSON.stringify(reservationDetails.reservation)),
                          status: 'PENDING',
                          rawMessagesCount: 2,
                          rawMessagesJson: JSON.parse(JSON.stringify([currentMsg, nextMsg])),
                        },
                      });
                      activeHarvestingJob.legacyLeadsExtractedCount++;
                    }
                  } catch (err: any) {}
                }
                continue; // SKIP FAQ STAGING TOTAL
              }

              // 2. PII Scrubbing
              const cleanQ = this.scrubPII(rawQ);
              const cleanA = this.scrubPII(rawA);

              // 3. Deduplikasi Otomatis via KnowledgeBaseService.checkDuplicateFaq (Threshold = 0.70)
              const { knowledgeBaseService } = await import('./knowledge.service');
              const dupCheck = await knowledgeBaseService.checkDuplicateFaq(cleanQ, tenantId, 0.70);
              const stagingStatus: any = dupCheck.isDuplicate ? 'EXISTING_MATCH' : 'PENDING';
              const matchedChunkId = dupCheck.matchedChunk?.id || null;
              const matchedSimilarity = dupCheck.similarity || null;

              // 4. Sub-Part B Lead/Purchase Extraction (using parseReservationText)
              const reservationDetails = parseReservationText(`${rawQ}\n${rawA}`);
              if (reservationDetails.success && reservationDetails.reservation) {
                try {
                  const phoneNum = chat.id.replace(/@.*$/, '');
                  const existingLead = await prisma.legacyStaging.findUnique({
                    where: { phoneNumber: phoneNum }
                  });

                  if (!existingLead) {
                    await prisma.legacyStaging.create({
                      data: {
                        tenantId: tenantId,
                        phoneNumber: phoneNum,
                        name: reservationDetails.reservation.name || 'Customer Lama',
                        extractedLocation: reservationDetails.reservation.address || null,
                        leadCreatedAt: new Date(),
                        extractedReservationJson: JSON.parse(JSON.stringify(reservationDetails.reservation)),
                        status: 'PENDING',
                        rawMessagesCount: 2,
                        rawMessagesJson: JSON.parse(JSON.stringify([currentMsg, nextMsg])),
                      },
                    });
                    activeHarvestingJob.legacyLeadsExtractedCount++;
                  }
                } catch (err: any) {
                  // Fallback for mock mode
                }
              }

              // 5. Sub-Part A Medical Detection & Dual Routing
              const medicalCheck = MedicalDetectionService.detectMedicalConcern(cleanQ);

              if (medicalCheck.isMedical) {
                // Route to MedicalFaqStaging (Bidan Queue)
                try {
                  await prisma.medicalFaqStaging.create({
                    data: {
                      tenant_id: tenantId,
                      conversation_id: chat.id,
                      customer_phone: chat.id.replace(/@.*$/, ''),
                      raw_question: cleanQ,
                      bidan_raw_reply: cleanA,
                      general_question: `Bagaimana penanganan ${medicalCheck.detectedSymptoms.join(', ')}?`,
                      general_answer: cleanA,
                      symptoms_tagged: medicalCheck.detectedSymptoms,
                      status: stagingStatus,
                      matched_chunk_id: matchedChunkId,
                      matched_similarity: matchedSimilarity,
                    },
                  });
                  activeHarvestingJob.medicalStagedCount++;
                } catch (err: any) {
                  // Fallback
                }
              } else {
                // Route to GeneralFaqStaging (Admin Queue)
                try {
                  await prisma.generalFaqStaging.create({
                    data: {
                      tenant_id: tenantId,
                      conversation_id: chat.id,
                      raw_question: cleanQ,
                      raw_answer: cleanA,
                      general_question: cleanQ,
                      general_answer: cleanA,
                      category: 'general',
                      status: stagingStatus,
                      matched_chunk_id: matchedChunkId,
                      matched_similarity: matchedSimilarity,
                    },
                  });
                  activeHarvestingJob.generalStagedCount++;
                } catch (err: any) {
                  // Fallback
                }
              }
            }
          }

          activeHarvestingJob.progressPercent = Math.min(95, 25 + Math.round(((i + 1) / 10) * 70));
        }

        activeHarvestingJob.status = 'COMPLETED';
        activeHarvestingJob.progressPercent = 100;
        console.log(`[HARVESTING ENGINE COMPLETED] Medical Staged: ${activeHarvestingJob.medicalStagedCount}, General Staged: ${activeHarvestingJob.generalStagedCount}, Leads Extracted: ${activeHarvestingJob.legacyLeadsExtractedCount}`);
      } catch (err: any) {
        activeHarvestingJob.status = 'FAILED';
        activeHarvestingJob.errorMessage = err.message;
        console.error('[HARVESTING ENGINE ERROR]', err.message);
      }
    }, 100);

    return activeHarvestingJob;
  }
}
