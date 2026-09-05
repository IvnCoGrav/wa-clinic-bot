import { prisma } from '../../db/client';
import { DEFAULT_TENANT_ID } from '../../config/tenant';

export interface LocationState {
  rawText: string;
  kelurahan?: string;
  kecamatan?: string;
  kota?: string;
  distanceKm?: number;
  ongkirNormal?: number;
  ongkirPromo?: number;
  isOutOfCoverage?: boolean;
}

export interface ChildState {
  name?: string;
  ageMonths?: number;
  symptoms: string[];
}

export interface BookingState {
  preferredDate?: string;
  preferredTime?: string;
  reservationId?: string;
  isConfirmed: boolean;
}

export interface CustomerGoalSession {
  customerName?: string;
  genderGreeting: 'Bunda' | 'Bapak';
  location?: LocationState;
  childProfile?: ChildState;
  selectedTreatment?: string;
  booking?: BookingState;
}

const DEFAULT_SESSION: CustomerGoalSession = {
  genderGreeting: 'Bunda',
};

export class GoalTracker {
  /**
   * Mengambil session state dari database (kolom preferences di Conversation atau Customer).
   */
  public static async getGoalSession(
    conversationId: string,
    tenantId = DEFAULT_TENANT_ID
  ): Promise<CustomerGoalSession> {
    try {
      const conv = await prisma.conversation.findUnique({
        where: { id: conversationId },
        include: { customer: true }
      });

      if (!conv) return { ...DEFAULT_SESSION };

      const prefs: any = (conv.customer?.preferences as any) || {};
      
      // Deteksi sapaan Bapak jika nama customer menunjukkan pria
      const custName = conv.customer?.name || prefs.customerName || '';
      const isMale = /\b(bapak|pak|ayah|papa|bapake|naufal|ahmad|budi|agus|dwi|eko|adi|ivan)\b/i.test(custName);

      return {
        customerName: custName || undefined,
        genderGreeting: isMale ? 'Bapak' : (prefs.genderGreeting || 'Bunda'),
        location: prefs.location || (conv.customer?.kelurahan ? {
          rawText: conv.customer.kelurahan,
          kelurahan: conv.customer.kelurahan || undefined,
          kecamatan: conv.customer.kecamatan || undefined,
          kota: conv.customer.kota || undefined,
          distanceKm: conv.customer.distance_km != null ? Number(conv.customer.distance_km) : undefined,
          ongkirNormal: conv.customer.ongkir != null ? Number(conv.customer.ongkir) : undefined,
          ongkirPromo: prefs.ongkirPromoFee || undefined,
          isOutOfCoverage: Boolean(conv.customer.is_out_of_coverage)
        } : undefined),
        childProfile: prefs.childProfile || (prefs.childAgeMonths ? {
          ageMonths: prefs.childAgeMonths,
          symptoms: prefs.symptoms || []
        } : undefined),
        selectedTreatment: prefs.selectedTreatmentName || prefs.selectedTreatment || undefined,
        booking: prefs.booking || undefined
      };
    } catch (err: any) {
      console.warn('[GOAL TRACKER GET ERROR]', err.message);
      return { ...DEFAULT_SESSION };
    }
  }

  /**
   * Menyimpan pembaruan session state ke database.
   */
  public static async updateGoalSession(
    conversationId: string,
    updates: Partial<CustomerGoalSession>,
    tenantId = DEFAULT_TENANT_ID
  ): Promise<CustomerGoalSession> {
    const current = await this.getGoalSession(conversationId, tenantId);
    const merged: CustomerGoalSession = {
      ...current,
      ...updates,
      location: updates.location ? { ...current.location, ...updates.location } : current.location,
      childProfile: updates.childProfile ? { ...current.childProfile, ...updates.childProfile } : current.childProfile,
      booking: updates.booking ? { ...current.booking, ...updates.booking } : current.booking,
    };

    try {
      const conv = await prisma.conversation.findUnique({ where: { id: conversationId } });
      if (conv?.customer_id) {
        const updateData: any = {
          preferences: merged,
        };
        if (merged.customerName) {
          updateData.name = merged.customerName;
        }
        if (merged.location) {
          if (merged.location.kelurahan) updateData.kelurahan = merged.location.kelurahan;
          if (merged.location.kecamatan) updateData.kecamatan = merged.location.kecamatan;
          if (merged.location.kota) updateData.kota = merged.location.kota;
          if (merged.location.distanceKm != null) updateData.distance_km = merged.location.distanceKm;
          if (merged.location.ongkirPromo != null || merged.location.ongkirNormal != null) {
            updateData.ongkir = merged.location.ongkirPromo || merged.location.ongkirNormal;
          }
          if (merged.location.isOutOfCoverage != null) updateData.is_out_of_coverage = merged.location.isOutOfCoverage;
        }

        await prisma.customer.update({
          where: { id: conv.customer_id },
          data: updateData
        });
      }
    } catch (err: any) {
      console.warn('[GOAL TRACKER UPDATE ERROR]', err.message);
    }

    return merged;
  }

  /**
   * Format session state menjadi ringkasan faktual ringkas untuk prompt LLM.
   */
  public static formatGoalSessionForPrompt(session: CustomerGoalSession): string {
    const lines: string[] = [
      `[STATUS DATA CUSTOMER SAAT INI]`,
      `• Sapaan: ${session.genderGreeting} ${session.customerName ? `(${session.customerName})` : ''}`,
    ];

    if (session.location?.kelurahan || session.location?.distanceKm) {
      lines.push(`• Lokasi: ${session.location.kelurahan || '-'}, ${session.location.kecamatan || '-'}, ${session.location.kota || '-'} (Jarak: ${session.location.distanceKm || '-'} km)`);
      if (session.location.ongkirPromo != null) {
        lines.push(`• Ongkir: Rp ${session.location.ongkirPromo.toLocaleString('id-ID')} (Promo dari normal Rp ${session.location.ongkirNormal?.toLocaleString('id-ID') || '-'})`);
      }
    } else {
      lines.push(`• Lokasi: Belum diketahui (Perlu ditanyakan kelurahan/kecamatannya)`);
    }

    if (session.childProfile) {
      lines.push(`• Data Si Kecil: Usia ${session.childProfile.ageMonths != null ? session.childProfile.ageMonths + ' bulan' : 'belum spesifik'}${session.childProfile.symptoms.length > 0 ? `, Keluhan: ${session.childProfile.symptoms.join(', ')}` : ''}`);
    }

    if (session.selectedTreatment) {
      lines.push(`• Treatment Terpilih: ${session.selectedTreatment}`);
    } else {
      lines.push(`• Treatment Terpilih: Belum dipilih`);
    }

    if (session.booking?.preferredDate) {
      lines.push(`• Jadwal Booking: ${session.booking.preferredDate} ${session.booking.preferredTime || ''}`);
    }

    return lines.join('\n');
  }
}
