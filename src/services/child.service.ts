import { parseAgeTextToBirthDate, monthsBetween } from '../utils/age-calculator';
import { BabyDetail } from '../utils/reservation-text-parser';

/**
 * ChildService — persistensi entitas anak per customer (multi-tenant).
 * Upsert berbasis (customer_id, name) sehingga repeat order TIDAK membuat duplikasi anak.
 * Usia disimpan sebagai birth_date (estimasi) + snapshot usia, dan bisa dihitung ulang
 * terhadap hari ini oleh AgeCalculator.
 */
export class ChildService {
  /**
   * Persist data bayi/anak hasil parsing reservasi ke tabel children.
   * DB offline → gagal senyap (konsisten pola in-memory fallback sistem).
   */
  public async upsertChildrenFromBabies(params: {
    customerId: string;
    reservationId?: string | null;
    tenantId: string;
    babies: BabyDetail[];
  }): Promise<void> {
    const { customerId, reservationId, tenantId, babies } = params;
    if (!babies || babies.length === 0) return;
    if (!customerId) return;

    const cleaned = babies
      .map((b) => ({ name: (b.name || '').trim(), age: (b.age || '').trim() }))
      .filter((b) => b.name && b.name !== '-');

    if (cleaned.length === 0) return;

    try {
      const { prisma } = await import('../db/client');
      const now = new Date();

      for (const baby of cleaned) {
        const birthDate = parseAgeTextToBirthDate(baby.age, now);
        const ageMonthsAtReg = birthDate ? monthsBetween(birthDate, now) : null;

        await prisma.child.upsert({
          where: {
            customer_id_name: {
              customer_id: customerId,
              name: baby.name,
            },
          },
          create: {
            tenant_id: tenantId,
            customer_id: customerId,
            reservation_id: reservationId ?? null,
            name: baby.name,
            birth_date: birthDate,
            age_months_at_registration: ageMonthsAtReg,
            raw_age_text: baby.age || null,
          },
          update: {
            reservation_id: reservationId ?? null,
            birth_date: birthDate ?? undefined,
            age_months_at_registration: ageMonthsAtReg ?? undefined,
            raw_age_text: baby.age || null,
          },
        });
      }
    } catch (err: any) {
      console.warn('[CHILD SERVICE] Failed to persist children (DB offline?):', err.message);
    }
  }

  /**
   * Ambil daftar anak customer dengan usia real-time terhadap hari ini.
   * DB offline → [] (senyap).
   */
  public async getChildrenWithCurrentAge(
    customerId: string,
    today: Date = new Date()
  ): Promise<Array<{ id: string; name: string; birth_date: Date | null; raw_age_text: string | null; age_months_at_registration: number | null; current_age: string }>> {
    if (!customerId) return [];
    try {
      const { prisma } = await import('../db/client');
      const children = await prisma.child.findMany({
        where: { customer_id: customerId },
        orderBy: { created_at: 'asc' },
      });

      const { computeCurrentAge } = await import('../utils/age-calculator');
      return children.map((c: any) => ({
        id: c.id,
        name: c.name,
        birth_date: c.birth_date,
        raw_age_text: c.raw_age_text,
        age_months_at_registration: c.age_months_at_registration,
        current_age: computeCurrentAge({
          birthDate: c.birth_date,
          ageMonthsAtRegistration: c.age_months_at_registration,
          registeredAt: c.created_at,
          rawAgeText: c.raw_age_text,
        }, today),
      }));
    } catch (err: any) {
      console.warn('[CHILD SERVICE] Failed to load children (DB offline?):', err.message);
      return [];
    }
  }
}

export const childService = new ChildService();
