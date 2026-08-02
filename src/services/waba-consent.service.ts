import { prisma } from '../db/client';

export type MarketingOptInSource = 'RESERVATION_CONFIRM' | 'CHAT_PROMPT' | 'ADMIN_MANUAL';

export interface ConsentCheckResult {
  allowed: boolean;
  reason: 'NO_OPT_IN_REQUIRED' | 'OPTED_IN' | 'NO_OPT_IN' | 'NOT_FOUND';
}

export class WabaConsentService {
  /**
   * Klasifikasi kategori template Meta berdasarkan tipe follow-up.
   * UTILITY: reminder / review (tidak butuh opt-in).
   * MARKETING: promosi / tawaran (wajib opt-in).
   */
  public getTemplateCategory(type: string): 'UTILITY' | 'MARKETING' {
    if (
      type.startsWith('NO_PURCHASE') ||
      type.startsWith('NEXT_TREATMENT')
    ) {
      return 'MARKETING';
    }
    return 'UTILITY';
  }

  /**
   * Menyimpan bukti opt-in marketing ke customer.
   */
  public async recordOptIn(
    customerId: string,
    source: MarketingOptInSource,
    tenantId?: string
  ): Promise<void> {
    await prisma.customer.update({
      where: { id: customerId },
      data: {
        marketing_opt_in: true,
        marketing_opt_in_at: new Date(),
        marketing_opt_in_source: source,
      },
    });
  }

  /**
   * Menandai customer berhenti langganan marketing (opt-out).
   */
  public async recordOptOut(customerId: string, tenantId?: string): Promise<void> {
    await prisma.customer.update({
      where: { id: customerId },
      data: {
        marketing_opt_in: false,
        marketing_opt_in_at: new Date(),
        marketing_opt_in_source: null,
      },
    });
  }

  /**
   * Gatekeeper: cek apakah pesan MARKETING boleh dikirim ke customer.
   * UTILITY selalu boleh. MARKETING wajib marketing_opt_in = true.
   */
  public async canSendMarketing(customer: { id: string; marketing_opt_in?: boolean }): Promise<ConsentCheckResult> {
    if (customer.marketing_opt_in) {
      return { allowed: true, reason: 'OPTED_IN' };
    }
    return { allowed: false, reason: 'NO_OPT_IN' };
  }
}

export const wabaConsentService = new WabaConsentService();
