import { prisma } from '../db/client';
import { wahaClient } from '../integrations/waha/client';
import { MedicalDetectionService } from './medical-detection.service';
import { AiModelConfigService } from '../config/ai-models.config';
import { parseReservationText } from '../utils/reservation-text-parser';
import { isDummyOrTestContact } from '../utils/dummy-filter';

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

    // 4. Best-Effort Name Scrubbing (Phrases starting with Bunda/Ibu/Kak/Bu followed by capitalized names, ignoring common terms like Hamil/Menyusui/Bidan/Dokter/Anak)
    cleaned = cleaned.replace(/\b(?:Bunda|Ibu|Kak|Bu)\s+(?!(?:Hamil|Menyusui|Melahirkan|Bidan|Dokter|Anak|Bayi|Balita)\b)([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g, 'Bunda [REDACTED_NAME]');

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
    const lower = text.toLowerCase().trim();

    // 1. Kata kunci & frasa transaksi, booking, jadwal, jam, hari, lokasi, & form
    const scheduleKeywords = [
      'jadwal', 'dijadwalkan', 'penjadwalan', 'slot', 'booking', 'reservasi',
      'reschedule', 'ganti hari', 'pindah hari', 'ganti jam', 'pindah jam',
      'buka jam', 'tutup jam', 'jam berapa', 'jam berapa saja', 'jam berapa aja',
      'jam 0', 'jam 1', 'jam 2', 'jam 3', 'jam 4', 'jam 5', 'jam 6', 'jam 7', 'jam 8', 'jam 9', 'jam 10', 'jam 11', 'jam 12',
      'jam 13', 'jam 14', 'jam 15', 'jam 16', 'jam 17', 'jam 18', 'jam 19', 'jam 20', 'jam 21', 'jam 22', 'jam 23',
      'hari ini', 'besok', 'lusa', 'minggu ini', 'bulan ini',
      'hari senin', 'hari selasa', 'hari rabu', 'hari kamis', 'hari jumat', 'hari sabtu', 'hari minggu',
      'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu', 'minggu',
      'pagi', 'siang', 'sore', 'malam', 'wib',
      'isi form', 'kirim form', 'isi data', 'kirim data', 'form reservasi', 'form booking',
      'lokasi', 'alamat', 'shareloc', 'share location', 'titik', 'posisi', 'otw', 'perjalanan',
      'bisa booking', 'mau booking', 'mau reservasi', 'mau daftar', 'daftar sekarang',
      'tersedia', 'ready', 'kosong', 'slot kosong', 'jadwal kosong', 'slot ready',
      'ambil slot', 'pilih slot', 'booking slot', 'dapat slot',
    ];

    if (scheduleKeywords.some((kw) => lower.includes(kw))) {
      return true;
    }

    // 2. Pola Tanggal spesifik (mis. 10 agustus, tgl 5, tanggal 12, 12/08, 12-08-2026)
    const datePattern = /(?:tgl|tanggal|\b\d{1,2}[\/\.-]\d{1,2}(?:[\/\.-]\d{2,4})?|\b\d{1,2}\s+(?:jan|feb|mar|apr|mei|jun|jul|agu|sep|okt|nov|des|januari|februari|maret|april|juni|juli|agustus|september|oktober|november|desember))/i;
    if (datePattern.test(lower)) {
      return true;
    }

    // 3. Pola Jam spesifik (mis. 09.00, 10:00, 14.30)
    const timePattern = /\b\d{1,2}[.:]\d{2}\b/;
    if (timePattern.test(lower)) {
      return true;
    }

    return false;
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
   * 1. Fetches historical chats from WAHA API and dumps into a consolidated JSON file (storage/harvesting/raw_scraped_chats_<timestamp>.json)
   * 2. Fetches existing Knowledge Base FAQs from DB for LLM context
   * 3. Analyzes transcript with DeepSeek LLM to extract ONLY NEW medical and general Q&As not present in existing FAQs
   * 4. Ingests new candidates into MedicalFaqStaging & GeneralFaqStaging for manual review
   */
  static async runHarvestingJob(
    tenantId: string = DEFAULT_TENANT_ID,
    options?: { maxChats?: number; maxMessagesPerChat?: number }
  ): Promise<HarvestingProgressStats> {
    if (activeHarvestingJob.status === 'PROCESSING') {
      return activeHarvestingJob;
    }

    const maxChats = options?.maxChats || 50;
    const maxMessagesPerChat = options?.maxMessagesPerChat || 50;

    // Resolve AI model dynamically from AI Model Config Registry (Defaults to DeepSeek / deepseek-chat)
    const aiConfig = AiModelConfigService.getModelConfig('HARVESTING');
    console.log(`[HARVESTING ENGINE] Starting file-based harvesting job (maxChats: ${maxChats}) using model '${aiConfig.modelName}' (${aiConfig.provider})...`);

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
        const { default: fs } = await import('fs');
        const { default: path } = await import('path');
        const storageDir = path.join(process.cwd(), 'storage', 'harvesting');
        if (!fs.existsSync(storageDir)) {
          fs.mkdirSync(storageDir, { recursive: true });
        }

        // STEP 1: Fetch conversations & messages from local PostgreSQL database
        const conversations = await prisma.conversation.findMany({
          where: { tenant_id: tenantId },
          include: {
            customer: true,
            messages: {
              orderBy: { created_at: 'asc' },
            },
          },
        });

        if (conversations.length === 0) {
          console.log('[HARVESTING ENGINE] Local conversation database is empty. Please run Live Chat Sync first.');
          activeHarvestingJob = {
            status: 'COMPLETED',
            progressPercent: 100,
            totalChatsScanned: 0,
            totalMessagesScanned: 0,
            medicalStagedCount: 0,
            generalStagedCount: 0,
            legacyLeadsExtractedCount: 0,
          };
          return;
        }

        const chatLimit = maxChats && maxChats > 0 ? Math.min(conversations.length, maxChats) : conversations.length;
        activeHarvestingJob.totalChatsScanned = chatLimit;
        activeHarvestingJob.progressPercent = 20;

        const consolidatedTranscripts: Array<{
          chatId: string;
          customerPhone: string;
          dialogue: Array<{ sender: 'CUSTOMER' | 'BIDAN_ADMIN'; message: string }>;
        }> = [];

        for (let i = 0; i < chatLimit; i++) {
          const conv = conversations[i];
          const phone = conv.customer?.phone || conv.id;
          const customerName = conv.customer?.name;

          // Abaikan nomor test, sandbox simulator, spammer, dan LID tidak valid
          if (isDummyOrTestContact(phone, customerName, conv.customer?.is_sandbox_test)) {
            continue;
          }

          const rawMessages = conv.messages;

          // Abaikan percakapan noise <= 2 pesan tanpa nama pelanggan
          const hasRealName = customerName && customerName.trim() !== '' && customerName.trim().toLowerCase() !== 'bunda customer';
          if (!hasRealName && rawMessages.length <= 2) {
            continue;
          }
          activeHarvestingJob.totalMessagesScanned += rawMessages.length;

          const chatDialogue: Array<{ sender: 'CUSTOMER' | 'BIDAN_ADMIN'; message: string }> = [];

          for (let j = 0; j < rawMessages.length - 1; j++) {
            const currentMsg = rawMessages[j];
            const nextMsg = rawMessages[j + 1];

            // Match Inbound question from customer -> Outbound answer from admin/bidan
            if (
              currentMsg.direction === 'INBOUND' &&
              nextMsg.direction === 'OUTBOUND' &&
              currentMsg.content &&
              nextMsg.content
            ) {
              const rawQ = currentMsg.content;
              const rawA = nextMsg.content;

              // Pre-AI Junk Filter & Schedule/Form Exclusion
              if (this.isJunkMessage(rawQ)) continue;
              if (this.isTransactionOrScheduleMessage(rawQ)) {
                // Check if it extracts a lead for LegacyStaging
                const reservationDetails = parseReservationText(`${rawQ}\n${rawA}`);
                if (reservationDetails.success && reservationDetails.reservation) {
                  try {
                    const phoneNum = phone;
                    const existingLead = await prisma.legacyStaging.findUnique({
                      where: { phoneNumber: phoneNum },
                    });
                    if (!existingLead) {
                      await prisma.legacyStaging.create({
                        data: {
                          tenantId: tenantId,
                          phoneNumber: phoneNum,
                          name: reservationDetails.reservation.name || 'Customer Lama',
                          extractedLocation: reservationDetails.reservation.address || null,
                          leadCreatedAt: currentMsg.created_at,
                          extractedReservationJson: JSON.parse(JSON.stringify(reservationDetails.reservation)),
                          status: 'PENDING',
                          rawMessagesCount: 2,
                          rawMessagesJson: JSON.parse(
                            JSON.stringify([
                              {
                                id: currentMsg.wa_message_id || currentMsg.id,
                                body: currentMsg.content,
                                fromMe: false,
                                timestamp: currentMsg.created_at.toISOString(),
                              },
                              {
                                id: nextMsg.wa_message_id || nextMsg.id,
                                body: nextMsg.content,
                                fromMe: true,
                                timestamp: nextMsg.created_at.toISOString(),
                              },
                            ])
                          ),
                        },
                      });
                      activeHarvestingJob.legacyLeadsExtractedCount++;
                    }
                  } catch (err: any) {}
                }
                continue; // EXCLUDE scheduling/booking from FAQ dump
              }

              // PII Scrubbing
              const cleanQ = this.scrubPII(rawQ);
              const cleanA = this.scrubPII(rawA);

              chatDialogue.push({ sender: 'CUSTOMER', message: cleanQ });
              chatDialogue.push({ sender: 'BIDAN_ADMIN', message: cleanA });
            }
          }

          if (chatDialogue.length > 0) {
            consolidatedTranscripts.push({
              chatId: conv.id,
              customerPhone: phone,
              dialogue: chatDialogue,
            });
          }

          activeHarvestingJob.progressPercent = Math.min(45, 20 + Math.round(((i + 1) / chatLimit) * 25));
        }

        // Save consolidated file to storage/harvesting/raw_scraped_chats_<timestamp>.json & latest_raw_scraped_chats.json
        const timestampStr = new Date().toISOString().replace(/[:.]/g, '-');
        const dumpFilePath = path.join(storageDir, `raw_scraped_chats_${timestampStr}.json`);
        const latestFilePath = path.join(storageDir, `latest_raw_scraped_chats.json`);

        const dumpData = {
          scrapedAt: new Date().toISOString(),
          tenantId,
          totalChats: consolidatedTranscripts.length,
          totalMessagesScanned: activeHarvestingJob.totalMessagesScanned,
          conversations: consolidatedTranscripts,
        };

        fs.writeFileSync(dumpFilePath, JSON.stringify(dumpData, null, 2), 'utf-8');
        fs.writeFileSync(latestFilePath, JSON.stringify(dumpData, null, 2), 'utf-8');
        console.log(`[HARVESTING ENGINE] Consolidated raw chats dumped to file: ${dumpFilePath}`);

        activeHarvestingJob.progressPercent = 50;

        // STEP 2: Fetch existing Knowledge Base FAQs from DB for LLM Context
        let existingFaqsContext: Array<{ id: string; title: string; content: string }> = [];
        try {
          const chunks = await prisma.knowledgeChunk.findMany({
            where: { tenant_id: tenantId },
            select: { id: true, title: true, content: true },
          });
          existingFaqsContext = chunks.map((c) => ({ id: c.id, title: c.title, content: c.content }));
        } catch (err: any) {
          console.warn('[HARVESTING ENGINE] Could not fetch existing knowledge chunks:', err.message);
        }

        // STEP 3: Deep LLM Context Analysis with DeepSeek (or configured model)
        const { knowledgeBaseService } = await import('./knowledge.service');
        activeHarvestingJob.progressPercent = 60;

        // Format prompt for DeepSeek LLM with full consolidated file dump
        const existingFaqTitles = existingFaqsContext.map((f) => `- ${f.title}`).join('\n') || '(Belum ada FAQ)';
        const transcriptText = consolidatedTranscripts
          .map((c) => `=== CHAT (${c.customerPhone}) ===\n` + c.dialogue.map((d) => `[${d.sender}]: ${d.message}`).join('\n'))
          .join('\n\n');

        const systemPrompt = `You are an expert Medical & Knowledge Base Curator for Kala Spa (Moms & Baby Spa).
Your task is to analyze historical chat transcripts and extract NEW, high-value FAQ entries.

CRITICAL INSTRUCTIONS:
1. EXISTING APPROVED FAQs IN OUR SYSTEM:
${existingFaqTitles}

2. Compare the chat transcript against the existing FAQs above. DO NOT extract questions that are already answered or covered by existing FAQs.
3. Filter out personal greetings, appointment scheduling, specific slot availability, location sharelocs, or price negotiations.
4. Separate findings into two arrays:
   - "medicalFaqs": Clinical/health questions about babies, moms, pregnancy, postpartum care, infant massage safety (for Bidan review).
   - "generalFaqs": General clinic policy, service descriptions, general price guidelines, homecare rules (for Admin review).
5. Format the output strictly as JSON object with structure:
{
  "medicalFaqs": [ { "question": "Clean Question?", "answer": "Clean Answer.", "symptoms": ["Demam", "Batuk"] } ],
  "generalFaqs": [ { "question": "Clean Question?", "answer": "Clean Answer.", "category": "general" } ]
}`;

        const apiKey = process.env.DEEPSEEK_API_KEY || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '';
        const baseUrl = (process.env.DEEPSEEK_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/$/, '');
        const model = process.env.AI_MODEL_HARVESTING || 'deepseek-chat';

        let extractedResult: { medicalFaqs: any[]; generalFaqs: any[] } = { medicalFaqs: [], generalFaqs: [] };

        if (apiKey && !apiKey.startsWith('mock')) {
          console.log(`[HARVESTING ENGINE] Sending transcript file to DeepSeek LLM (${model}) for context analysis...`);
          const startedAt = Date.now();
          try {
            const { callChatCompletionsWithFallback, getFallbackModel } = await import('../integrations/llm/model-fallback');
            const callResult = await callChatCompletionsWithFallback({
              baseUrl,
              apiKey,
              model,
              fallbackModel: getFallbackModel(),
              timeoutMs: 30000,
              payload: {
                model,
                response_format: { type: 'json_object' },
                messages: [
                  { role: 'system', content: systemPrompt },
                  { role: 'user', content: `Chat Transcripts File Dump:\n${transcriptText}` },
                ],
                temperature: 0.2,
                max_tokens: 3000,
              },
            });

            try {
              const { auditLlmCall } = await import('../utils/llm-audit-buffer');
              auditLlmCall({
                customer_phone: 'harvesting-audit',
                task_type: 'HARVESTING',
                model_name: callResult.model,
                baseUrl: callResult.baseUrl,
                startedAt,
                usage: callResult.data?.usage,
              });
            } catch {
              // Fire-and-forget
            }

            const content = callResult.data?.choices?.[0]?.message?.content || '{}';
            const parsed = JSON.parse(content);
            if (parsed && typeof parsed === 'object') {
              extractedResult = {
                medicalFaqs: Array.isArray(parsed.medicalFaqs) ? parsed.medicalFaqs : [],
                generalFaqs: Array.isArray(parsed.generalFaqs) ? parsed.generalFaqs : [],
              };
            }
          } catch (llmErr: any) {
            console.warn('[HARVESTING ENGINE] LLM analysis API call failed, falling back to rule-based extractor:', llmErr.message);
          }
        }

        // STEP 4: Rule-based fallback if LLM returned empty or offline mode
        if (extractedResult.medicalFaqs.length === 0 && extractedResult.generalFaqs.length === 0) {
          console.log('[HARVESTING ENGINE] Processing Q&A pairs via fallback extraction & similarity check...');
          for (const conv of consolidatedTranscripts) {
            for (let k = 0; k < conv.dialogue.length - 1; k += 2) {
              const qMsg = conv.dialogue[k];
              const aMsg = conv.dialogue[k + 1];
              if (qMsg && aMsg && qMsg.sender === 'CUSTOMER' && aMsg.sender === 'BIDAN_ADMIN') {
                const cleanQ = qMsg.message;
                const cleanA = aMsg.message;

                const dupCheck = await knowledgeBaseService.checkDuplicateFaq(cleanQ, tenantId, 0.70);
                if (!dupCheck.isDuplicate) {
                  const medicalCheck = MedicalDetectionService.detectMedicalConcern(cleanQ);
                  if (medicalCheck.isMedical) {
                    extractedResult.medicalFaqs.push({
                      question: `Bagaimana penanganan ${medicalCheck.detectedSymptoms.join(', ')}?`,
                      answer: cleanA,
                      rawQuestion: cleanQ,
                      rawReply: cleanA,
                      symptoms: medicalCheck.detectedSymptoms,
                      customerPhone: conv.customerPhone,
                    });
                  } else {
                    extractedResult.generalFaqs.push({
                      question: cleanQ,
                      answer: cleanA,
                      rawQuestion: cleanQ,
                      rawReply: cleanA,
                      category: 'general',
                      customerPhone: conv.customerPhone,
                    });
                  }
                }
              }
            }
          }
        }

        activeHarvestingJob.progressPercent = 85;

        // STEP 5: Ingest LLM candidates into MedicalFaqStaging & GeneralFaqStaging
        for (const medItem of extractedResult.medicalFaqs) {
          const qText = medItem.question || medItem.rawQuestion || '';
          const aText = medItem.answer || medItem.rawReply || '';
          if (!qText || !aText) continue;

          const dupCheck = await knowledgeBaseService.checkDuplicateFaq(qText, tenantId, 0.70);
          const status: any = dupCheck.isDuplicate ? 'EXISTING_MATCH' : 'PENDING';

          try {
            await prisma.medicalFaqStaging.create({
              data: {
                tenant_id: tenantId,
                conversation_id: `harvest_${Date.now()}`,
                customer_phone: medItem.customerPhone || 'WAHA_SCRAPED',
                raw_question: medItem.rawQuestion || qText,
                bidan_raw_reply: medItem.rawReply || aText,
                general_question: qText,
                general_answer: aText,
                symptoms_tagged: medItem.symptoms || [],
                status,
                matched_chunk_id: dupCheck.matchedChunk?.id || null,
                matched_similarity: dupCheck.similarity || null,
              },
            });
            activeHarvestingJob.medicalStagedCount++;
          } catch (e: any) {}
        }

        for (const genItem of extractedResult.generalFaqs) {
          const qText = genItem.question || genItem.rawQuestion || '';
          const aText = genItem.answer || genItem.rawReply || '';
          if (!qText || !aText) continue;

          const dupCheck = await knowledgeBaseService.checkDuplicateFaq(qText, tenantId, 0.70);
          const status: any = dupCheck.isDuplicate ? 'EXISTING_MATCH' : 'PENDING';

          try {
            await prisma.generalFaqStaging.create({
              data: {
                tenant_id: tenantId,
                conversation_id: `harvest_${Date.now()}`,
                raw_question: genItem.rawQuestion || qText,
                raw_answer: genItem.rawReply || aText,
                general_question: qText,
                general_answer: aText,
                category: genItem.category || 'general',
                status,
                matched_chunk_id: dupCheck.matchedChunk?.id || null,
                matched_similarity: dupCheck.similarity || null,
              },
            });
            activeHarvestingJob.generalStagedCount++;
          } catch (e: any) {}
        }

        activeHarvestingJob.status = 'COMPLETED';
        activeHarvestingJob.progressPercent = 100;
        console.log(`[HARVESTING ENGINE COMPLETED] File Dumped to ${dumpFilePath}. Medical Staged: ${activeHarvestingJob.medicalStagedCount}, General Staged: ${activeHarvestingJob.generalStagedCount}, Leads Extracted: ${activeHarvestingJob.legacyLeadsExtractedCount}`);
      } catch (err: any) {
        activeHarvestingJob.status = 'FAILED';
        activeHarvestingJob.errorMessage = err.message;
        console.error('[HARVESTING ENGINE ERROR]', err.message);
      }
    }, 100);

    return activeHarvestingJob;
  }
}
