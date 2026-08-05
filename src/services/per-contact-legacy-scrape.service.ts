import { prisma } from '../db/client';
import { wahaClient } from '../integrations/waha/client';
import { LegacyHarvestingService } from './legacy-harvesting.service';
import { parseReservationText } from '../utils/reservation-text-parser';

/**
 * PerContactLegacyScrapeService — scraping legacy per-contact (Task 2).
 *
 * Dipicu dari webhook saat chat di-label 'legacy' (gated oleh
 * ENABLE_LEGACY_LABEL_SCRAPE_TRIGGER). Membaca histori pesan chat sampai menemukan
 * form/percakapan reservasi valid PERTAMA, lalu menyimpannya ke LegacyStaging
 * (skip jika phoneNumber sudah ada) dan menandai customer sebagai legacy_scraped_at.
 *
 * Race condition guard: in-memory Set mencegah dobel-proses untuk chat yang sama.
 */
export class PerContactLegacyScrapeService {
  private activeScrapes = new Set<string>();

  public isActive(chatId: string): boolean {
    return this.activeScrapes.has(chatId);
  }

  /**
   * Scrape histori chat hingga lead reservasi pertama yang valid ditemukan.
   * Best-effort: error apapun tidak dilempar ke pemanggil (fire-and-forget).
   */
  public async scrapeContactUntilFirstLead(chatId: string, tenantId: string): Promise<void> {
    if (this.activeScrapes.has(chatId)) {
      console.log(`[LEGACY SCRAPE] Chat ${chatId} already being scraped. Skipping duplicate.`);
      return;
    }
    this.activeScrapes.add(chatId);

    try {
      const maxMessages = parseInt(process.env.LEGACY_SCRAPE_MAX_MESSAGES || '200', 10);
      const rawMessages = await wahaClient.getMessages(chatId, maxMessages);

      // Urutkan kronologis (terlama dulu) supaya berhenti pada lead PERTAMA yang valid
      const messages = [...rawMessages].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

      const phoneNum = chatId.replace(/@.*$/, '');

      for (let i = 0; i < messages.length - 1; i++) {
        const currentMsg = messages[i];
        const nextMsg = messages[i + 1];

        // Hanya proses pasangan: inbound customer → outbound admin/bidan
        if (currentMsg.fromMe || !currentMsg.body || !nextMsg.body) continue;
        if (LegacyHarvestingService.isJunkMessage(currentMsg.body)) continue;

        const combined = `${currentMsg.body}\n${nextMsg.body}`;

        if (LegacyHarvestingService.isTransactionOrScheduleMessage(currentMsg.body)) {
          const reservationDetails = parseReservationText(combined);
          if (reservationDetails.success && reservationDetails.reservation) {
            await this.stageLegacyLead({
              chatId,
              phoneNum,
              reservationJson: reservationDetails.reservation,
              currentMsg,
              nextMsg,
              tenantId,
            });
            console.log(`[LEGACY SCRAPE] Chat ${chatId}: lead pertama ditemukan & di-stage.`);
            break; // STOP pada lead pertama valid
          }
        }
      }

      // Tandai customer sudah di-scrape (best-effort)
      await this.markCustomerScraped(phoneNum, tenantId, chatId);
    } catch (err: any) {
      console.error(`[LEGACY SCRAPE ERROR] Chat ${chatId}:`, err.message);
    } finally {
      this.activeScrapes.delete(chatId);
    }
  }

  /**
   * Simpan ke LegacyStaging (skip jika phoneNumber sudah pernah di-stage)
   * + best-effort addLabel 'legacy' (kecuali dry-run) + set is_legacy_source.
   */
  private async stageLegacyLead(params: {
    chatId: string;
    phoneNum: string;
    reservationJson: any;
    currentMsg: any;
    nextMsg: any;
    tenantId: string;
  }): Promise<void> {
    const { chatId, phoneNum, reservationJson, currentMsg, nextMsg, tenantId } = params;
    const isDryRun = process.env.LEGACY_SCRAPE_DRY_RUN === 'true';

    try {
      const existingLead = await prisma.legacyStaging.findUnique({
        where: { phoneNumber: phoneNum },
      });
      if (!existingLead) {
        await prisma.legacyStaging.create({
          data: {
            tenantId,
            phoneNumber: phoneNum,
            name: reservationJson.name || 'Customer Lama',
            extractedLocation: reservationJson.address || null,
            leadCreatedAt: new Date(),
            extractedReservationJson: JSON.parse(JSON.stringify(reservationJson)),
            status: 'PENDING',
            rawMessagesCount: 2,
            rawMessagesJson: JSON.parse(JSON.stringify([currentMsg, nextMsg])),
          },
        });
        console.log(`[LEGACY SCRAPE] Staged legacy lead for ${phoneNum}.`);
      } else {
        console.log(`[LEGACY SCRAPE] Lead ${phoneNum} sudah ada di LegacyStaging. Skip create.`);
      }
    } catch (err: any) {
      console.warn(`[LEGACY SCRAPE] LegacyStaging create failed (DB offline?):`, err.message);
    }

    if (!isDryRun) {
      wahaClient.addLabel(chatId, 'legacy').catch((err: any) =>
        console.warn('[LEGACY SCRAPE] addLabel "legacy" failed:', err.message)
      );
    }
  }

  /**
   * Set Customer.is_legacy_source = true dan legacy_scraped_at = now() (best-effort).
   */
  private async markCustomerScraped(phoneNum: string, tenantId: string, chatId: string): Promise<void> {
    const isDryRun = process.env.LEGACY_SCRAPE_DRY_RUN === 'true';

    try {
      await prisma.customer.updateMany({
        where: { phone: phoneNum, tenant_id: tenantId },
        data: { is_legacy_source: true, legacy_scraped_at: new Date() },
      });
    } catch (err: any) {
      console.warn('[LEGACY SCRAPE] Failed to mark customer scraped (DB offline?):', err.message);
    }

    if (!isDryRun) {
      wahaClient.addLabel(chatId, 'legacy').catch((err: any) =>
        console.warn('[LEGACY SCRAPE] addLabel "legacy" failed:', err.message)
      );
    }
  }
}

export const perContactLegacyScrapeService = new PerContactLegacyScrapeService();