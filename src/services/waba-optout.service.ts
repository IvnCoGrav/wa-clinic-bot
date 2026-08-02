import { prisma } from '../db/client';

export interface OptOutResult {
  matched: boolean;
  keyword?: string;
  cancelledFollowUps: number;
}

export class WabaOptOutService {
  /**
   * Deteksi apakah teks masuk mengandung keyword opt-out marketing.
   * Scope: WABA only — WAHA tidak punya marketing_opt_in.
   * BERHENTI hanya dianggap opt-out jika dikombinasikan dengan kata
   * penghentian marketing (PROMO/PENAWARAN/IKLAN/SEMUA), karena "berhenti"
   * adalah kata Indonesia yang sering muncul di percakapan normal.
   */
  public isOptOutMessage(text: string | undefined | null): { matched: boolean; keyword?: string } {
    if (!text) return { matched: false };
    const normalized = text.trim().toUpperCase().replace(/\s+/g, ' ');
    const exactKeywords = ['STOP', 'UNSUBSCRIBE', 'BATAL PROMO'] as const;
    for (const kw of exactKeywords) {
      if (normalized === kw) return { matched: true, keyword: kw };
    }
    for (const kw of ['STOP', 'UNSUBSCRIBE']) {
      if (normalized.startsWith(kw + ' ')) return { matched: true, keyword: kw };
    }
    if (normalized.startsWith('BATAL PROMO')) return { matched: true, keyword: 'BATAL PROMO' };
    if (/^BERHENTI($|\s+.*(PROMO|PENAWARAN|IKLAN|SEMUA|MARKETING))/.test(normalized)) {
      return { matched: true, keyword: 'BERHENTI' };
    }
    return { matched: false };
  }

  /**
   * Mengeksekusi opt-out: set marketing_opt_in = false + batalkan semua
   * follow-up terjadwal (PENDING/QUEUED) untuk customer di tenant ini.
   * Ack reply dikirim oleh pemanggil (state machine / route) melalui gateway.
   */
  public async handleOptOut(customerId: string, tenantId?: string): Promise<OptOutResult> {
    let cancelledFollowUps = 0;

    await prisma.customer.update({
      where: { id: customerId },
      data: {
        marketing_opt_in: false,
        marketing_opt_in_at: new Date(),
        marketing_opt_in_source: null,
      },
    });

    const where: any = {
      customer_id: customerId,
      status: { in: ['PENDING', 'QUEUED'] },
    };
    if (tenantId) {
      where.tenant_id = tenantId;
    }

    const result = await prisma.followUp.updateMany({
      where,
      data: { status: 'CANCELLED' },
    });
    cancelledFollowUps = result.count;

    return { matched: true, cancelledFollowUps };
  }

  /**
   * Pesan ack yang dikirim ke customer setelah opt-out.
   */
  public getAckMessage(): string {
    return 'Baik Bunda, kami berhenti mengirimkan informasi promo & penawaran ke nomor ini. Pengingat jadwal perawatan yang sudah berjalan tetap kami kirimkan ya. Jika ingin berlangganan promo lagi, balas YA kapan saja. 🙏';
  }
}

export const wabaOptOutService = new WabaOptOutService();
