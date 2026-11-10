import { buildEffectiveTaskAddress, buildMapsUrls } from './staff-reservation.service';

export interface AssignmentMessageParams {
  staffName: string;
  patientName: string;
  childrenStr: string;
  treatmentDetail: string;
  dateStr: string;
  timeStr: string;
  addressText: string;
  landmark?: string | null;
  distanceStr?: string | null;
  navigationUrl: string;
  totalFee: number;
  paymentStatusLabel: string;
  notes?: string | null;
  portalUrl: string;
}

export interface PreVisitBriefMessageParams {
  staffName: string;
  timeStr: string;
  patientName: string;
  childLine?: string | null;
  lastVisitLine: string;
  treatmentName: string;
  areaLine?: string | null;
  adminNotes?: string | null;
  portalUrl: string;
}

export interface CancellationMessageParams {
  staffName: string;
  patientName: string;
  treatmentDetail: string;
  dateStr: string;
  timeStr: string;
  addressText: string;
  reason?: string | null;
  portalUrl: string;
}

export interface UnassignedMessageParams {
  staffName: string;
  newStaffLabel: string;
  patientName: string;
  treatmentDetail: string;
  dateStr: string;
  timeStr: string;
  portalUrl: string;
}

export class StaffNotificationFormatterService {
  /**
   * Escape markdown karakter khusus agar tidak merusak formatting Telegram Markdown.
   */
  public escapeMarkdown(text: string): string {
    return (text || '').replace(/[*_`\[\]]/g, ' ').trim();
  }

  /**
   * Format pesan Telegram untuk penugasan reservasi baru ke staf.
   */
  public formatAssignmentTelegramMessage(params: AssignmentMessageParams): string {
    const {
      staffName,
      patientName,
      childrenStr,
      treatmentDetail,
      dateStr,
      timeStr,
      addressText,
      landmark,
      distanceStr,
      navigationUrl,
      totalFee,
      paymentStatusLabel,
      notes,
      portalUrl,
    } = params;

    return `🔔 *TUGAS RESERVASI BARU DITUGASKAN!*
Halo *${staffName}*, Anda memiliki jadwal kunjungan pasien baru:

👤 *Pasien:* ${patientName}
👶 *Anak:* ${childrenStr || 'Belum diisi'}
💆‍♀️ *Layanan:* ${treatmentDetail}
📅 *Waktu:* ${dateStr} — *Pukul ${timeStr} WIB*

📍 *Alamat:* ${addressText}
${landmark ? `🏠 *Patokan Rumah:* _${landmark}_\n` : ''}${distanceStr ? `🏍️ *Estimasi Jarak:* ${distanceStr}\n` : ''}🗺️ *Rute Navigasi Motor:* [Buka Google Maps](${navigationUrl})

💰 *Total Biaya:* Rp ${totalFee.toLocaleString('id-ID')} _(${paymentStatusLabel})_
${notes ? `📝 *Catatan Pasien:* _${notes}_\n` : ''}
🔒 *Komunikasi & Tugas:*
👉 [Buka Tugas & Chat Pasien di Portal Terapis](${portalUrl})

_Semoga lancar dan berikan pelayanan terbaik ya! ✨_`;
  }

  /**
   * Format pesan Telegram untuk ringkasan sebelum kunjungan (Pre-Visit Brief H-30 menit).
   */
  public formatPreVisitBriefMessage(params: PreVisitBriefMessageParams): string {
    const {
      staffName,
      timeStr,
      patientName,
      childLine,
      lastVisitLine,
      treatmentName,
      areaLine,
      adminNotes,
      portalUrl,
    } = params;

    return `📋 [RINGKASAN PASIEN SEBELUM KUNJUNGAN]
⏰ Jam: ${timeStr} WIB
👤 Pasien: ${this.escapeMarkdown(patientName)}${childLine ? `\n👶 Anak: ${this.escapeMarkdown(childLine)}` : ''}
🔄 ${this.escapeMarkdown(lastVisitLine)}
🎯 Layanan: ${this.escapeMarkdown(treatmentName)}${areaLine ? `\n📍 Area Kunjungan: ${this.escapeMarkdown(areaLine)}` : ''}${adminNotes ? `\n💡 Catatan Khusus:\n${this.escapeMarkdown(adminNotes)}` : ''}

📍 Alamat lengkap & rute tersedia di portal (login):
👉 [Buka Tugas di Portal Terapis](${portalUrl})`;
  }

  /**
   * Format pesan Telegram saat jadwal reservasi dibatalkan.
   */
  public formatCancellationTelegramMessage(params: CancellationMessageParams): string {
    const {
      staffName,
      patientName,
      treatmentDetail,
      dateStr,
      timeStr,
      addressText,
      reason,
      portalUrl,
    } = params;

    const reasonLine = reason ? `Alasan: _${this.escapeMarkdown(reason)}_\n` : '';
    return `JADWAL KUNJUNGAN DIBATALKAN\nHalo *${this.escapeMarkdown(staffName)}*, jadwal kunjungan berikut telah dibatalkan:\n\nPasien: ${this.escapeMarkdown(patientName)}\nLayanan: ${this.escapeMarkdown(treatmentDetail)}\nWaktu: ${dateStr} - Pukul ${timeStr} WIB\nAlamat: ${addressText}\n${reasonLine}\nCatatan: Anda tidak perlu menuju ke lokasi pasien untuk jadwal ini.\n\n[Buka Portal Terapis](${portalUrl})`;
  }

  /**
   * Format pesan Telegram saat tugas dialihkan ke staf lain oleh supervisor.
   */
  public formatUnassignedTelegramMessage(params: UnassignedMessageParams): string {
    const {
      staffName,
      newStaffLabel,
      patientName,
      treatmentDetail,
      dateStr,
      timeStr,
      portalUrl,
    } = params;

    return `JADWAL DIALIHKAN\nHalo *${this.escapeMarkdown(staffName)}*, jadwal kunjungan berikut telah dialihkan${newStaffLabel} oleh supervisor:\n\nPasien: ${this.escapeMarkdown(patientName)}\nLayanan: ${this.escapeMarkdown(treatmentDetail)}\nWaktu: ${dateStr} - Pukul ${timeStr} WIB\n\nAnda tidak perlu menuju ke lokasi untuk jadwal ini. Terima kasih.\n\n[Buka Portal Terapis](${portalUrl})`;
  }

  /**
   * Format pesan Telegram untuk briefing pagi harian seluruh jadwal staf.
   */
  public formatDailyBriefingMessage(
    staffName: string,
    formattedDate: string,
    reservations: any[]
  ): string {
    const cleanStaffName = this.escapeMarkdown(staffName);
    const count = reservations.length;

    const emojiNumbers = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

    const itemsText = reservations
      .map((reservation, idx) => {
        const numEmoji = emojiNumbers[idx] || `${idx + 1}️⃣`;
        const cust = reservation.customer;
        const allChildren = reservation.children?.length ? reservation.children : cust?.children || [];

        // 1. Data Anak / Pasien
        let patientDetail = '';
        if (allChildren.length > 0) {
          const chStr = allChildren
            .map((ch: any) => {
              const name = this.escapeMarkdown(ch.name);
              const age = ch.raw_age_text ? `, ${this.escapeMarkdown(ch.raw_age_text)}` : '';
              return `${name}${age}`;
            })
            .join(', ');
          patientDetail = `👶 ${chStr}`;
        } else {
          const detail = String(reservation.treatment_detail || '').toLowerCase();
          const structuredStage = String((reservation as any).mom_stage || '').toUpperCase();
          const weeks = (reservation as any).gestational_weeks;
          if (structuredStage === 'PREGNANT' || (!structuredStage && (detail.includes('hamil') || detail.includes('prenatal')))) {
            patientDetail = weeks ? `Ibu Hamil (${weeks} minggu)` : 'Ibu Hamil';
          } else if (structuredStage === 'POSTPARTUM' || (!structuredStage && detail.includes('postpartum'))) {
            patientDetail = 'Ibu Nifas / Pasca Salin';
          } else if (structuredStage === 'LACTATING') {
            patientDetail = 'Ibu Menyusui / Laktasi';
          } else {
            patientDetail = 'Moms';
          }
          if ((reservation as any).hpl_date) {
            const hpl = new Date((reservation as any).hpl_date);
            if (!isNaN(hpl.getTime())) patientDetail += ` • HPL ${hpl.toISOString().slice(0, 10)}`;
          }
        }

        const custName = this.escapeMarkdown(cust?.name || 'Bunda');

        // 2. Format Jam WIB
        const bookingDate = reservation.booking_date ? new Date(reservation.booking_date) : null;
        let timeStr = '-';
        if (bookingDate) {
          const wibDate = new Date(bookingDate.getTime() + 7 * 60 * 60 * 1000);
          const hours = String(wibDate.getUTCHours()).padStart(2, '0');
          const minutes = String(wibDate.getUTCMinutes()).padStart(2, '0');
          timeStr = `${hours}:${minutes}`;
        }

        // 3. Layanan
        const treatmentName = this.escapeMarkdown(
          reservation.treatment_detail || reservation.treatment_category || 'Treatment Homecare'
        );

        // 4. Alamat & Google Maps
        const addrEntity = (reservation as any).customer_address;
        const effectiveAddr2: any = buildEffectiveTaskAddress(addrEntity, cust) || {};
        const addressParts: string[] = [];
        if (effectiveAddr2.address) addressParts.push(this.escapeMarkdown(effectiveAddr2.address));
        if (effectiveAddr2.kelurahan) addressParts.push(`Kel. ${this.escapeMarkdown(effectiveAddr2.kelurahan)}`);
        if (effectiveAddr2.kecamatan) addressParts.push(`Kec. ${this.escapeMarkdown(effectiveAddr2.kecamatan)}`);
        if (effectiveAddr2.kota) addressParts.push(this.escapeMarkdown(effectiveAddr2.kota));
        const addressText = addressParts.join(', ') || 'Alamat tercatat di sistem';

        const lat = effectiveAddr2.lat ?? cust?.lat;
        const lng = effectiveAddr2.lng ?? cust?.lng;
        const hasAddressText2 = !!addressText && addressText !== 'Alamat tercatat di sistem';
        const { navigationUrl: seamNavUrl2 } = buildMapsUrls(
          lat, lng,
          effectiveAddr2.location_source ?? (cust as any)?.location_source ?? null,
          hasAddressText2 ? addressText : null
        );
        const navigationUrl =
          seamNavUrl2 ||
          (hasAddressText2
            ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addressText)}&travelmode=two-wheeler`
            : `https://maps.google.com/?q=${encodeURIComponent(addressText)}`);

        // 5. Total Biaya
        const purchaseValue = reservation.purchase_value || 0;
        const ongkir = reservation.delivery_fee ?? addrEntity?.ongkir ?? cust?.ongkir ?? 0;
        const totalFee = purchaseValue || (ongkir > 0 ? ongkir : 0);
        let totalFeeStr = '';
        if (totalFee > 0) {
          if (totalFee >= 1000 && totalFee % 1000 === 0) {
            totalFeeStr = `${totalFee / 1000}k`;
          } else {
            totalFeeStr = `Rp ${totalFee.toLocaleString('id-ID')}`;
          }
        }

        const lines: string[] = [
          `${numEmoji} *${timeStr} WIB* — *${custName}* (${patientDetail})`,
          `• *Layanan:* ${treatmentName}`,
          `• *Alamat:* ${addressText} ([Buka Maps](${navigationUrl}))`,
        ];

        if (totalFeeStr) {
          lines.push(`• *Total :* ${totalFeeStr}`);
        }

        return lines.join('\n');
      })
      .join('\n\n');

    const baseUrl = process.env.ADMIN_DASHBOARD_URL || 'http://localhost:3000/admin';
    const portalUrl = `${baseUrl}/#staff-today`;

    return `🌅 *BRIEFING JADWAL HARI INI — ${cleanStaffName}*
📅 *${formattedDate}*

Halo ${cleanStaffName}, hari ini Anda memiliki *${count} Jadwal Kunjungan*:

${itemsText}

🔗 [Buka Detail di Portal Petugas](${portalUrl})

_Semangat melayani Bunda & Buah Hati hari ini! ✨_`;
  }
}

export const staffNotificationFormatterService = new StaffNotificationFormatterService();
