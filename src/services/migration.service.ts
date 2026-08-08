import { prisma } from '../db/client';
import { wahaClient } from '../integrations/waha/client';
import { parseReservationText } from '../utils/reservation-text-parser';
import { customerService } from './customer.service';
import { conversationService } from './conversation.service';
import { StagingStatus, TreatmentCategory } from '@prisma/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';

export class MigrationService {
  /**
   * Mengekstrak seluruh room chat dari WAHA, menarik histori teks pesan,
   * mendeteksi leadCreatedAt (pesan pertama) & firstPurchaseAt (form reservasi),
   * lalu menyimpannya ke tabel LegacyStaging dengan status PENDING.
   */
  public async extractFromWaha(limit = 100): Promise<{ success: boolean; extractedCount: number; error?: string }> {
    try {
      console.log('[Migration Service] Starting WAHA chat extraction...');
      const chats = await wahaClient.getChats();
      let extractedCount = 0;

      for (const chat of chats) {
        // Abaikan grup WhatsApp (@g.us)
        if (chat.id.includes('@g.us')) {
          continue;
        }

        // Resolusi nomor telepon JID
        let phone = chat.id.replace(/@.*$/, '');
        if (chat.id.includes('@lid')) {
          phone = await wahaClient.getPhoneNumberFromLid(chat.id);
        }

        if (!phone) {
          continue;
        }

        // Ambil histori pesan teks dari WAHA
        const rawMessages = await wahaClient.getMessages(chat.id, limit);
        // Filter hanya pesan teks (memiliki body)
        const textMessages = rawMessages.filter((m) => m.body && typeof m.body === 'string' && m.body.trim().length > 0);

        if (textMessages.length === 0) {
          continue;
        }

        // Urutkan pesan dari paling lama ke paling baru (timestamp ascending)
        textMessages.sort((a, b) => a.timestamp - b.timestamp);

        // Pesan pertama adalah leadCreatedAt
        const leadCreatedAt = new Date(textMessages[0].timestamp * 1000);
        let firstPurchaseAt: Date | null = null;
        let extractedReservationJson: any = null;
        let extractedLocation: string | null = null;

        // Cari pesan pertama yang berisi form reservasi
        for (const msg of textMessages) {
          const bodyLower = msg.body.toLowerCase();
          const isForm =
            bodyLower.includes('pilihan treatment (baby & kids)') ||
            bodyLower.includes('pilihan treatment (moms)') ||
            bodyLower.includes('berikut list untuk reservasi');

          if (isForm) {
            firstPurchaseAt = new Date(msg.timestamp * 1000);
            const parseResult = parseReservationText(msg.body);
            if (parseResult.success && parseResult.reservation) {
              const res = parseResult.reservation;
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
              };
              if (res.kec || res.kota) {
                extractedLocation = `${res.kec || ''}, ${res.kota || ''}`.replace(/^,\s*|,\s*$/g, '').trim() || null;
              }
            }
            break; // Ambil form reservasi yang paling pertama ditemukan
          }
        }

        // Susun daftar pesan mentah dalam format JSON yang bersih
        const rawMessagesJson = textMessages.map((m) => ({
          id: m.id,
          body: m.body,
          fromMe: m.fromMe,
          timestamp: new Date(m.timestamp * 1000).toISOString(),
        }));

        // Upsert ke LegacyStaging
        const name = extractedReservationJson?.name || chat.name || null;
        await prisma.legacyStaging.upsert({
          where: { phoneNumber: phone },
          create: {
            tenantId: DEFAULT_TENANT_ID,
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
          update: {
            name: name || undefined,
            extractedLocation: extractedLocation || undefined,
            leadCreatedAt,
            firstPurchaseAt: firstPurchaseAt || undefined,
            extractedReservationJson: extractedReservationJson || undefined,
            rawMessagesCount: textMessages.length,
            rawMessagesJson,
          },
        });

        extractedCount++;
      }

      console.log(`[Migration Service] Extracted ${extractedCount} chats to LegacyStaging area.`);
      return { success: true, extractedCount };
    } catch (err: any) {
      console.error('[Migration Service] Error during extraction:', err.message);
      return { success: false, extractedCount: 0, error: err.message };
    }
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

        // 4. Impor Reservasi Pembelian Pertama (jika ada data reservasi ter-extract)
        if (staging.extractedReservationJson) {
          const resData: any = staging.extractedReservationJson;
          try {
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
              await prisma.reservation.create({
                data: {
                  tenant_id: tenantId,
                  customer_id: customer.id,
                  treatment_category: resData.treatmentCategory as TreatmentCategory,
                  treatment_detail: resData.treatmentDetail,
                  booking_date: bookingDate,
                  raw_text: resData.rawText,
                  status: 'confirmed', // Tandai langsung confirmed untuk data penjualan historis
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
