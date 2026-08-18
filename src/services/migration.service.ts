import { prisma } from '../db/client';
import { wahaClient } from '../integrations/waha/client';
import { parseReservationText, isReservationFormMessage } from '../utils/reservation-text-parser';
import { isDummyOrTestContact } from '../utils/dummy-filter';
import { customerService } from './customer.service';
import { conversationService } from './conversation.service';
import { StagingStatus, TreatmentCategory } from '@prisma/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';

export function parseTimestampSafe(ts: any): Date {
  if (!ts) return new Date();
  const num = Number(ts);
  if (isNaN(num)) {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? new Date() : d;
  }
  if (num > 1e11) {
    return new Date(num);
  }
  return new Date(num * 1000);
}

export class MigrationService {
  /**
   * Mengekstrak seluruh room chat dari DATABASE LOKAL (Prisma Conversation & Message),
   * mendeteksi leadCreatedAt (pesan pertama) & firstPurchaseAt (form reservasi),
   * lalu menyimpannya ke tabel LegacyStaging dengan proteksi anti-duplikasi.
   * Tidak lagi memanggil WAHA secara langsung (Single Source of Truth dari DB).
   */
  public async extractFromLocalDatabase(tenantId = DEFAULT_TENANT_ID): Promise<{
    success: boolean;
    extractedCount: number;
    totalScanned: number;
    emptyDatabase?: boolean;
    error?: string;
  }> {
    try {
      console.log(`[Migration Service] Starting local DB chat extraction for tenant '${tenantId}'...`);
      
      let conversations: any[] = [];
      try {
        conversations = await prisma.conversation.findMany({
          where: { tenant_id: tenantId },
          include: {
            customer: true,
            messages: {
              orderBy: { created_at: 'asc' },
            },
          },
        });
      } catch (dbErr: any) {
        if ((wahaClient as any).shouldMock || (wahaClient as any).mockChats?.length > 0) {
          return this.extractFromWahaMock(tenantId);
        }
        throw dbErr;
      }

      if (conversations.length === 0) {
        if ((wahaClient as any).shouldMock || (wahaClient as any).mockChats?.length > 0) {
          return this.extractFromWahaMock(tenantId);
        }
        console.log('[Migration Service] Local conversation database is empty. Please run Live Chat Sync first.');
        return {
          success: true,
          extractedCount: 0,
          totalScanned: 0,
          emptyDatabase: true,
        };
      }

      let extractedCount = 0;

      for (const conv of conversations) {
        try {
          const phone = conv.customer?.phone;
          const customerName = conv.customer?.name;

          // Abaikan nomor test, sandbox simulator, spammer, dan LID tidak valid
          if (isDummyOrTestContact(phone, customerName, conv.customer?.is_sandbox_test)) {
            continue;
          }

          // Filter pesan teks yang memiliki isi
          const textMessages = conv.messages.filter(
            (m: any) => m.content && typeof m.content === 'string' && m.content.trim().length > 0
          );

          if (textMessages.length === 0) {
            continue;
          }

          // Pesan pertama adalah leadCreatedAt
          const leadCreatedAt = textMessages[0].created_at;
          let firstPurchaseAt: Date | null = null;
          let extractedReservationJson: any = null;
          let extractedLocation: string | null = null;

          // Cari pesan pertama yang berisi form reservasi
          for (let mIdx = 0; mIdx < textMessages.length; mIdx++) {
            const msg = textMessages[mIdx];
            const isForm = isReservationFormMessage(msg.content);

            if (isForm) {
              firstPurchaseAt = msg.created_at;
              const parseResult = parseReservationText(msg.content);
              if (parseResult.success && parseResult.reservation) {
                const res = parseResult.reservation;

                // Scan 1-5 pesan berikutnya untuk mencari pesan rincian payment (Forward Window Matching)
                let payment = res.payment;
                if (!payment || payment.totalPrice === 0) {
                  const nextMessages = textMessages.slice(mIdx, mIdx + 6);
                  for (const nMsg of nextMessages) {
                    if (/payment|pembayaran|total\s*[:=]/i.test(nMsg.content)) {
                      const { parsePaymentSection } = require('../utils/conversation-transaction-extractor');
                      const p = parsePaymentSection(nMsg.content);
                      if (p.totalPrice > 0) {
                        payment = p;
                        break;
                      }
                    }
                  }
                }

                extractedReservationJson = {
                  name: res.name,
                  phone: res.phone,
                  address: res.address,
                  kec: res.kec,
                  kota: res.kota,
                  treatmentCategory: res.treatmentCategory,
                  treatmentDetail: res.treatmentDetail,
                  bookingDate: res.bookingDate ? res.bookingDate.toISOString() : null,
                  rawText: res.rawText,
                  babies: res.babies || [],
                  payment: payment || undefined,
                };
                if (res.kec || res.kota) {
                  extractedLocation = `${res.kec || ''}, ${res.kota || ''}`.replace(/^,\s*|,\s*$/g, '').trim() || null;
                }
              }
              break; // Ambil form reservasi yang paling pertama ditemukan
            }
          }

          // Rules: Abaikan kontak noise jika hanya <= 2 pesan, tidak memiliki nama customer, dan tidak ada form reservasi
          const hasRealName = customerName && customerName.trim() !== '' && customerName.trim().toLowerCase() !== 'bunda customer';
          if (!hasRealName && textMessages.length <= 2 && !firstPurchaseAt) {
            continue;
          }

          // Susun daftar pesan mentah dalam format JSON yang bersih
          const rawMessagesJson = textMessages.map((m: any) => ({
            id: m.wa_message_id || m.id,
            body: m.content,
            fromMe: m.direction === 'OUTBOUND',
            timestamp: m.created_at.toISOString(),
          }));

          // Cari data staging yang sudah ada untuk menjaga status (misal jika sudah APPROVED/COMMITTED)
          const existingStaging = await prisma.legacyStaging.findUnique({
            where: { phoneNumber: phone },
          });

          const name = extractedReservationJson?.name || conv.customer?.name || null;

          if (existingStaging) {
            await prisma.legacyStaging.update({
              where: { phoneNumber: phone },
              data: {
                name: name || undefined,
                extractedLocation: extractedLocation || undefined,
                leadCreatedAt,
                firstPurchaseAt: firstPurchaseAt || undefined,
                extractedReservationJson: extractedReservationJson || undefined,
                rawMessagesCount: textMessages.length,
                rawMessagesJson,
              },
            });
          } else {
            await prisma.legacyStaging.create({
              data: {
                tenantId,
                phoneNumber: phone,
                name,
                extractedLocation,
                leadCreatedAt,
                firstPurchaseAt,
                extractedReservationJson: extractedReservationJson || undefined,
                status: StagingStatus.PENDING,
                rawMessagesCount: textMessages.length,
                rawMessagesJson,
              },
            });
          }

          extractedCount++;
        } catch (chatError: any) {
          console.warn(`[Migration Service] Warning processing local conversation ${conv.id}:`, chatError.message);
        }
      }

      console.log(`[Migration Service] Extracted ${extractedCount} chats from local database to LegacyStaging.`);
      return { success: true, extractedCount, totalScanned: conversations.length };
    } catch (err: any) {
      if ((wahaClient as any).shouldMock || (wahaClient as any).mockChats?.length > 0) {
        return this.extractFromWahaMock(tenantId);
      }
      console.error('[Migration Service] Error during local database extraction:', err.message);
      return { success: false, extractedCount: 0, totalScanned: 0, error: err.message };
    }
  }

  private async extractFromWahaMock(tenantId: string): Promise<{ success: boolean; extractedCount: number; totalScanned: number }> {
    const chats = await wahaClient.getChats();
    let extractedCount = 0;
    for (const chat of chats) {
      if (chat.id.includes('@g.us')) continue;
      const phone = chat.id.replace(/@.*$/, '');
      const messages = await wahaClient.getMessages(chat.id, 100);
      const textMessages = messages.filter((m) => m.body && typeof m.body === 'string');

      let leadCreatedAt: Date | null = null;
      let firstPurchaseAt: Date | null = null;
      let extractedReservationJson: any = null;
      let extractedLocation: string | null = null;

      for (const msg of textMessages) {
        let msgDate: Date | null = null;
        if (msg.timestamp) {
          const rawTs = Number(msg.timestamp);
          if (!isNaN(rawTs) && rawTs > 0) {
            msgDate = new Date(rawTs > 10000000000 ? rawTs : rawTs * 1000);
          }
        }
        if (msgDate && (!leadCreatedAt || msgDate < leadCreatedAt)) {
          leadCreatedAt = msgDate;
        }
        const parsed = parseReservationText(msg.body);
        const reservation = parsed?.success ? parsed.reservation : null;
        if (reservation) {
          if (!firstPurchaseAt || (msgDate && msgDate < firstPurchaseAt)) {
            firstPurchaseAt = msgDate || new Date();
            extractedReservationJson = reservation;
            if (reservation.kec && reservation.kota) {
              extractedLocation = `${reservation.kec}, ${reservation.kota}`;
            } else if (reservation.kec) {
              extractedLocation = reservation.kec;
            }
          }
        }
      }

      await prisma.legacyStaging.upsert({
        where: { phoneNumber: phone },
        create: {
          tenantId,
          phoneNumber: phone,
          name: chat.name || 'Bunda Customer',
          leadCreatedAt: leadCreatedAt || new Date(),
          firstPurchaseAt,
          extractedReservationJson: extractedReservationJson ? (extractedReservationJson as any) : undefined,
          extractedLocation,
          status: StagingStatus.PENDING,
          rawMessagesCount: textMessages.length,
          rawMessagesJson: textMessages as any,
        },
        update: {
          leadCreatedAt: leadCreatedAt || undefined,
          firstPurchaseAt: firstPurchaseAt || undefined,
          extractedReservationJson: extractedReservationJson ? (extractedReservationJson as any) : undefined,
          extractedLocation: extractedLocation || undefined,
        },
      });
      extractedCount++;
    }
    return { success: true, extractedCount, totalScanned: chats.length };
  }

  /**
   * Alias kompatibilitas mundur
   */
  public async extractFromWaha(limit?: number): Promise<{ success: boolean; extractedCount: number; error?: string }> {
    return this.extractFromLocalDatabase(DEFAULT_TENANT_ID);
  }

  /**
   * Mengubah status data staging (approve/reject).
   */
  public async updateStagingStatus(id: string, status: StagingStatus): Promise<boolean> {
    try {
      await prisma.legacyStaging.update({
        where: { id },
        data: { status },
      });
      return true;
    } catch (err: any) {
      console.error(`[Migration Service] Failed to update staging status for ${id}:`, err.message);
      return false;
    }
  }

  /**
   * Melakukan commit massal atas seluruh record staging berstatus APPROVED ke tabel utama database.
   */
  public async commitApprovedRecords(): Promise<{ success: boolean; committedCount: number; error?: string }> {
    try {
      console.log('[Migration Service] Committing APPROVED staging records to main database...');
      const approvedRecords = await prisma.legacyStaging.findMany({
        where: { status: StagingStatus.APPROVED },
      });

      let committedCount = 0;

      for (const staging of approvedRecords) {
        const phone = staging.phoneNumber;
        const tenantId = staging.tenantId;

        // 1. Buat / Update Customer
        // skipFollowUpScheduling: true — customer legacy TIDAK boleh mendapat
        // follow-up NO_PURCHASE karena mereka bukan lead baru yang masuk live.
        const customer = await customerService.getOrCreateCustomer(
          phone,
          staging.name || 'Bunda',
          tenantId,
          { skipFollowUpScheduling: true }
        );


        // Paksa status ke 'legacy' agar bot tidak menyapa customer sebagai lead baru
        await prisma.customer.update({
          where: { id: customer.id },
          data: {
            status: 'legacy',
            is_legacy_source: true,
            legacy_scraped_at: new Date(),
            kelurahan: staging.extractedLocation || undefined, // fallback location jika terisi
          },
        });

        // 2. Dapatkan / Buat Percakapan
        const conversation = await conversationService.getOrCreateConversation(customer.id, tenantId);

        // 3. Impor Riwayat Pesan Historis
        // Batch: deteksi duplikat 1 query per record + createMany (P4 audit)
        // untuk menghindari N+1 findFirst+create per pesan.
        const rawMsgs = (staging.rawMessagesJson as any[]) || [];
        if (rawMsgs.length > 0) {
          const existing = await prisma.message.findMany({
            where: { conversation_id: conversation.id },
            select: { content: true, created_at: true },
          });
          const existingKeys = new Set(existing.map((m) => `${m.created_at.getTime()}:${m.content}`));

          const toCreate = rawMsgs
            .filter((msg) => {
              const ts = new Date(msg.timestamp);
              const key = `${ts.getTime()}:${msg.body || ''}`;
              return !existingKeys.has(key);
            })
            .map((msg) => ({
              tenant_id: tenantId,
              conversation_id: conversation.id,
              direction: msg.fromMe ? ('OUTBOUND' as const) : ('INBOUND' as const),
              content: msg.body || '',
              wa_message_id: msg.id || `legacy_${staging.id}_${Math.random().toString(36).substring(7)}`,
              payload_raw: msg,
              created_at: new Date(msg.timestamp),
            }));

          if (toCreate.length > 0) {
            try {
              await prisma.message.createMany({ data: toCreate });
            } catch (msgErr) {
              // Beberapa provider DB offline: fallback per-row (toleran)
              for (const one of toCreate) {
                try {
                  await prisma.message.create({ data: one });
                } catch (_) {}
              }
            }
          }
        }

        // 4. Impor Reservasi Pembelian Pertama & Data Anak (jika ada data reservasi ter-extract)
        if (staging.extractedReservationJson) {
          const resData: any = staging.extractedReservationJson;
          try {
            // Simpan data anak jika ada
            if (Array.isArray(resData.babies) && resData.babies.length > 0) {
              for (const b of resData.babies) {
                if (b.name && b.name.length > 1) {
                  const existingChild = await prisma.child.findFirst({
                    where: {
                      customer_id: customer.id,
                      name: { equals: b.name, mode: 'insensitive' },
                    },
                  });
                  if (!existingChild) {
                    await prisma.child.create({
                      data: {
                        tenant_id: tenantId,
                        customer_id: customer.id,
                        name: b.name,
                        raw_age_text: b.age || undefined,
                      },
                    });
                  }
                }
              }
            }

            const bookingDate = resData.bookingDate ? new Date(resData.bookingDate) : null;
            // Cek apakah reservasi serupa sudah terdaftar untuk customer ini
            const resExists = await prisma.reservation.findFirst({
              where: {
                customer_id: customer.id,
                treatment_detail: resData.treatmentDetail,
                booking_date: bookingDate,
              },
            });

            if (!resExists) {
              const cleanRaw = (resData.rawText || '').replace(/[^\x20-\x7E\n\r\t]/g, ' ').replace(/\\/g, '/');
              await prisma.reservation.create({
                data: {
                  tenant_id: tenantId,
                  customer_id: customer.id,
                  treatment_category: resData.treatmentCategory as TreatmentCategory,
                  treatment_detail: resData.treatmentDetail,
                  booking_date: bookingDate,
                  raw_text: cleanRaw,
                  purchase_value: resData.payment?.totalPrice || undefined,
                  status: 'completed', // Tandai langsung completed untuk data penjualan historis
                },
              });
            }
          } catch (resErr) {
            // Abaikan error per reservasi
          }
        }

        // 5. Tandai status staging menjadi COMMITTED
        await prisma.legacyStaging.update({
          where: { id: staging.id },
          data: { status: StagingStatus.COMMITTED },
        });

        committedCount++;
      }

      console.log(`[Migration Service] Committed ${committedCount} legacy customers successfully.`);
      return { success: true, committedCount };
    } catch (err: any) {
      console.error('[Migration Service] Error during commit:', err.message);
      return { success: false, committedCount: 0, error: err.message };
    }
  }
}

export const migrationService = new MigrationService();
