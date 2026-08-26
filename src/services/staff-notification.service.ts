import { prisma } from '../db/client';
import { telegramService } from './telegram.service';
import { calculateHaversineDistance } from '../utils/haversine';
import { clinicConfig } from '../config/clinic';
import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config();

export interface StaffTelegramPairingInfo {
  staffId: string;
  staffName: string;
  pairingToken: string;
  directLink: string;
  isConnected: boolean;
  telegramChatId: string | null;
  botUsername: string;
}

export class StaffNotificationService {
  /**
   * Mengambil atau membuat token pairing Telegram unik untuk profil staf/terapis
   */
  async getStaffPairingInfo(staffId: string): Promise<StaffTelegramPairingInfo | null> {
    const staff = await prisma.staff.findUnique({
      where: { id: staffId },
    });
    if (!staff) return null;

    let token = staff.telegram_pairing_token;
    if (!token) {
      token = `staff_PAIR_${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
      try {
        await prisma.staff.update({
          where: { id: staffId },
          data: { telegram_pairing_token: token },
        });
      } catch (err: any) {
        const fresh = await prisma.staff.findUnique({ where: { id: staffId } });
        token = fresh?.telegram_pairing_token || token;
      }
    }

    const botUsername = (process.env.TELEGRAM_BOT_USERNAME || 'KalaReport_bot').replace(/^@/, '');
    const directLink = `https://t.me/${botUsername}?start=${token}`;

    return {
      staffId: staff.id,
      staffName: staff.name,
      pairingToken: token,
      directLink,
      isConnected: Boolean(staff.telegram_chat_id),
      telegramChatId: staff.telegram_chat_id || null,
      botUsername,
    };
  }

  /**
   * Reset / buat ulang token pairing untuk staf tertentu
   */
  async regenerateStaffPairingToken(staffId: string): Promise<StaffTelegramPairingInfo | null> {
    const newToken = `staff_PAIR_${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    await prisma.staff.update({
      where: { id: staffId },
      data: { telegram_pairing_token: newToken },
    });
    return this.getStaffPairingInfo(staffId);
  }

  /**
   * Mengirimkan notifikasi penugasan reservasi ke akun Telegram pribadi terapis/bidan
   * Catatan Privasi: Nomor telepon WhatsApp pasien TIDAK disertakan demi keamanan data perusahaan.
   * Sebagai gantinya disediakan link langsung ke portal staf internal.
   */
  async sendReservationAssignmentNotification(
    reservationId: string,
    staffId: string
  ): Promise<{ sent: boolean; reason?: string }> {
    try {
      const staff = await prisma.staff.findUnique({
        where: { id: staffId },
        select: { id: true, name: true, telegram_chat_id: true, tenant_id: true },
      });

      if (!staff || !staff.telegram_chat_id) {
        return { sent: false, reason: 'Staff belum menghubungkan akun Telegram pribadi' };
      }

      const reservation = await prisma.reservation.findUnique({
        where: { id: reservationId },
        include: {
          customer: {
            include: {
              children: true,
            },
          },
          children: true,
        },
      });

      if (!reservation) {
        return { sent: false, reason: 'Reservasi tidak ditemukan' };
      }

      const cust = reservation.customer;
      const allChildren = reservation.children?.length ? reservation.children : cust?.children || [];

      // 1. Format Nama Anak & Usia
      const childrenStr = allChildren
        .map((ch) => {
          const age = ch.raw_age_text ? ` (${ch.raw_age_text})` : '';
          return `${ch.name}${age}`;
        })
        .join(', ');

      // 2. Format Alamat Lengkap & Patokan Rumah
      const addressParts: string[] = [];
      if (cust?.kelurahan) addressParts.push(`Kel. ${cust.kelurahan}`);
      if (cust?.kecamatan) addressParts.push(`Kec. ${cust.kecamatan}`);
      if (cust?.kota) addressParts.push(cust.kota);
      const addressText = addressParts.join(', ') || 'Alamat belum tercatat lengkap';

      const landmark = (cust?.preferences as any)?.landmark || null;
      const housePhotoUrl = (cust?.preferences as any)?.house_photo_url || null;

      // 3. Format Waktu & Tanggal (WIB)
      const bookingDate = reservation.booking_date ? new Date(reservation.booking_date) : null;
      const dateStr = bookingDate
        ? bookingDate.toLocaleDateString('id-ID', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            timeZone: 'Asia/Jakarta',
          })
        : 'Tanggal belum ditentukan';

      const timeStr = bookingDate
        ? bookingDate.toLocaleTimeString('id-ID', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Asia/Jakarta',
          })
        : '-';

      // 4. Navigasi Google Maps Motor
      const lat = cust?.lat;
      const lng = cust?.lng;
      const navigationUrl =
        lat && lng
          ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=two-wheeler`
          : 'https://maps.google.com';

      // 5. Jarak Tempuh
      let distanceKm = cust?.distance_km ?? null;
      if (distanceKm == null && typeof lat === 'number' && typeof lng === 'number') {
        const straight = calculateHaversineDistance({ lat: clinicConfig.lat, lng: clinicConfig.lng }, { lat, lng });
        distanceKm = parseFloat((straight * 1.6).toFixed(1));
      }
      const distanceStr = distanceKm != null ? `${distanceKm} km` : null;

      // 6. Rincian Biaya & Status Bayar
      const purchaseValue = reservation.purchase_value || 0;
      const ongkir = cust?.ongkir || 0;
      const totalFee = purchaseValue || (ongkir > 0 ? ongkir : 0);
      const isLunas = reservation.status === 'CONFIRMED' || reservation.status === 'COMPLETED';
      const paymentStatusLabel = isLunas ? 'LUNAS (Transfer)' : 'TAGIH DI TEMPAT (Cash/QRIS)';

      // 7. Catatan / Preferensi Pasien
      const notes = (cust?.preferences as any)?.allergies || (cust?.preferences as any)?.notes || null;

      // 8. Tautan Aman ke Portal Terapis (tanpa mengekspos nomor HP)
      const baseUrl = process.env.ADMIN_DASHBOARD_URL || 'http://localhost:3000/admin';
      const portalUrl = `${baseUrl}/#staff-today`;

      // 9. Susun Pesan Telegram Markdown
      const messageText = `🔔 *TUGAS RESERVASI BARU DITUGASKAN!*
Halo *${staff.name}*, Anda memiliki jadwal kunjungan pasien baru:

👤 *Pasien:* ${cust?.name || 'Bunda'}
👶 *Anak:* ${childrenStr || 'Belum diisi'}
💆‍♀️ *Layanan:* ${reservation.treatment_detail || reservation.treatment_category || 'Treatment Homecare'}
📅 *Waktu:* ${dateStr} — *Pukul ${timeStr} WIB*

📍 *Alamat:* ${addressText}
${landmark ? `🏠 *Patokan Rumah:* _${landmark}_\n` : ''}${distanceStr ? `🏍️ *Estimasi Jarak:* ${distanceStr}\n` : ''}🗺️ *Rute Navigasi Motor:* [Buka Google Maps](${navigationUrl})

💰 *Total Biaya:* Rp ${totalFee.toLocaleString('id-ID')} _(${paymentStatusLabel})_
${notes ? `📝 *Catatan Pasien:* _${notes}_\n` : ''}
🔒 *Komunikasi & Tugas:*
👉 [Buka Tugas & Chat Pasien di Portal Terapis](${portalUrl})

_Semoga lancar dan berikan pelayanan terbaik ya! ✨_`;

      const res = await telegramService.sendMessage({
        chatId: staff.telegram_chat_id,
        text: messageText,
        parseMode: 'Markdown',
      });

      return { sent: res.ok, reason: res.description };
    } catch (err: any) {
      console.error(`[StaffNotificationService] Failed to notify staff ${staffId}:`, err.message);
      return { sent: false, reason: err.message };
    }
  }

  /**
   * Helper pembersih karakter markdown berbahaya
   */
  private escapeMarkdown(text: string): string {
    return (text || '').replace(/[*_`\[\]]/g, ' ').trim();
  }

  /**
   * Menyusun pesan Markdown Briefing Jadwal Harian Bidan/Terapis
   */
  generateDailyBriefingText(
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
          const category = String(reservation.treatment_category || '').toUpperCase();
          const detail = String(reservation.treatment_detail || '').toLowerCase();
          if (category === 'PREGNANCY' || detail.includes('hamil') || detail.includes('prenatal') || detail.includes('postpartum')) {
            patientDetail = 'Ibu Hamil';
          } else {
            patientDetail = 'Moms';
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
        const addressParts: string[] = [];
        if (cust?.kelurahan) addressParts.push(`Kel. ${this.escapeMarkdown(cust.kelurahan)}`);
        if (cust?.kecamatan) addressParts.push(`Kec. ${this.escapeMarkdown(cust.kecamatan)}`);
        if (cust?.kota) addressParts.push(this.escapeMarkdown(cust.kota));
        const addressText = addressParts.join(', ') || 'Alamat tercatat di sistem';

        const lat = cust?.lat;
        const lng = cust?.lng;
        const navigationUrl =
          lat && lng
            ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=two-wheeler`
            : `https://maps.google.com/?q=${encodeURIComponent(addressText)}`;

        // 5. Total Biaya
        const purchaseValue = reservation.purchase_value || 0;
        const ongkir = cust?.ongkir || 0;
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

  /**
   * Menghitung rentang waktu 00:00:00 s/d 23:59:59 dalam zona waktu WIB
   */
  getWibDayRange(targetDate: Date = new Date()): {
    startOfDay: Date;
    endOfDay: Date;
    dateStr: string;
    formattedDate: string;
  } {
    const wibMs = targetDate.getTime() + 7 * 60 * 60 * 1000;
    const wibDate = new Date(wibMs);
    const year = wibDate.getUTCFullYear();
    const month = wibDate.getUTCMonth();
    const day = wibDate.getUTCDate();

    // 00:00:00.000 WIB dinyatakan dalam UTC adalah -7 jam
    const startOfDay = new Date(Date.UTC(year, month, day, -7, 0, 0, 0));
    const endOfDay = new Date(Date.UTC(year, month, day, 16, 59, 59, 999));

    const formattedDate = targetDate.toLocaleDateString('id-ID', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Asia/Jakarta',
    });

    const monthStr = String(month + 1).padStart(2, '0');
    const dayStr = String(day).padStart(2, '0');
    const dateStr = `${year}-${monthStr}-${dayStr}`;

    return { startOfDay, endOfDay, dateStr, formattedDate };
  }

  /**
   * Mengirimkan briefing jadwal harian ke 1 staf/bidan spesifik
   */
  async sendStaffDailyBriefing(
    staffId: string,
    targetDate: Date = new Date()
  ): Promise<{ sent: boolean; reason?: string; count?: number }> {
    try {
      const staff = await prisma.staff.findUnique({
        where: { id: staffId },
        select: { id: true, name: true, telegram_chat_id: true, tenant_id: true, active: true },
      });

      if (!staff || !staff.telegram_chat_id) {
        return { sent: false, reason: 'Staff belum menghubungkan akun Telegram pribadi', count: 0 };
      }

      if (staff.active === false) {
        return { sent: false, reason: 'Akun staff nonaktif', count: 0 };
      }

      const { startOfDay, endOfDay, formattedDate } = this.getWibDayRange(targetDate);

      const reservations = await prisma.reservation.findMany({
        where: {
          tenant_id: staff.tenant_id,
          assigned_staff_id: staff.id,
          status: { notIn: ['cancelled', 'CANCELLED'] },
          booking_date: {
            gte: startOfDay,
            lte: endOfDay,
          },
        },
        include: {
          customer: {
            include: {
              children: true,
            },
          },
          children: true,
        },
        orderBy: {
          booking_date: 'asc',
        },
      });

      if (!reservations.length) {
        return { sent: false, reason: 'Tidak ada jadwal kunjungan untuk tanggal ini', count: 0 };
      }

      const messageText = this.generateDailyBriefingText(staff.name, formattedDate, reservations);

      const res = await telegramService.sendMessage({
        chatId: staff.telegram_chat_id,
        text: messageText,
        parseMode: 'Markdown',
      });

      return { sent: res.ok, reason: res.description, count: reservations.length };
    } catch (err: any) {
      console.error(`[StaffNotificationService] Error sending daily briefing to staff ${staffId}:`, err.message);
      return { sent: false, reason: err.message, count: 0 };
    }
  }

  /**
   * Mengirimkan briefing pagi harian ke seluruh Bidan/Terapis aktif yang memiliki jadwal
   */
  async sendAllStaffMorningBriefings(
    tenantId: string = 'default-tenant',
    targetDate: Date = new Date()
  ): Promise<{ totalStaff: number; briefedStaff: number; totalReservations: number }> {
    try {
      const activeStaffList = await prisma.staff.findMany({
        where: {
          tenant_id: tenantId,
          active: true,
          telegram_chat_id: { not: null },
        },
        select: { id: true, name: true },
      });

      let briefedStaff = 0;
      let totalReservations = 0;

      for (const staff of activeStaffList) {
        const res = await this.sendStaffDailyBriefing(staff.id, targetDate);
        if (res.sent) {
          briefedStaff++;
          totalReservations += res.count || 0;
        }
      }

      console.log(
        `[StaffNotificationService] Morning Briefing selesai dikirim ke ${briefedStaff}/${activeStaffList.length} staf (${totalReservations} total jadwal).`
      );

      return {
        totalStaff: activeStaffList.length,
        briefedStaff,
        totalReservations,
      };
    } catch (err: any) {
      console.error('[StaffNotificationService] Error sending morning briefings to all staff:', err.message);
      return { totalStaff: 0, briefedStaff: 0, totalReservations: 0 };
    }
  }
}

export const staffNotificationService = new StaffNotificationService();
