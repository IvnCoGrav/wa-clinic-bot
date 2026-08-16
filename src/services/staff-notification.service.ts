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
}

export const staffNotificationService = new StaffNotificationService();
