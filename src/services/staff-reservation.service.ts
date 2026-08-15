import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { calculateHaversineDistance, Coordinates } from '../utils/haversine';
import { clinicConfig } from '../config/clinic';

export interface StaffTaskChild {
  name: string;
  rawAgeText: string | null;
  birthDate: string | null;
}

export interface StaffTaskAddress {
  kelurahan: string | null;
  kecamatan: string | null;
  kota: string | null;
  distanceKm: number | null;
  estimatedMinutes?: number | null;
  fullText: string;
  distanceSource?: 'CLINIC' | 'PREVIOUS_PATIENT' | null;
  originName?: string | null;
}

export interface StaffTaskPricing {
  treatmentFee: number;
  deliveryFee: number;
  totalFee: number;
  paymentStatus: 'LUNAS' | 'TAGIH_DI_TEMPAT';
  paymentStatusLabel: string;
}

export interface StaffTaskItem {
  reservationId: string;
  customerName: string | null;
  treatmentDetail: string | null;
  treatmentCategory: string | null;
  bookingDate: Date | null;
  status: string;
  conversationId: string | null;
  mapsUrl: string | null;
  navigationUrl: string | null;
  address: StaffTaskAddress;
  children: StaffTaskChild[];
  pricing: StaffTaskPricing;
  shareLocationText: string | null;
}

function buildAddressText(c: {
  kelurahan?: string | null;
  kecamatan?: string | null;
  kota?: string | null;
}): string {
  const parts: string[] = [];
  if (c.kelurahan) parts.push(`Kel. ${c.kelurahan}`);
  if (c.kecamatan) parts.push(`Kec. ${c.kecamatan}`);
  if (c.kota) parts.push(c.kota);
  return parts.join(', ') || 'Alamat belum tercatat lengkap';
}

/**
 * Menghitung estimasi durasi tempuh perjalanan sepeda motor (dalam menit).
 * Dikalibrasi dari benchmark rute nyata Google Maps: ~2.05 menit/km + buffer lampu merah/gang 2 menit.
 */
export function estimateTravelDurationMinutes(distanceKm: number | null): number | null {
  if (distanceKm == null || distanceKm <= 0) return null;
  return Math.max(3, Math.round(distanceKm * 2.05 + 2));
}

function buildShareText(
  name: string | null,
  address: string,
  treatment: string | null,
  mapsUrl: string | null,
  pricing: StaffTaskPricing
): string {
  const lines: string[] = [
    `📍 *TUGAS HOMECARE TERAPIS*`,
    `👤 Pasien: ${name || 'Bunda'}`,
    `🏠 Alamat: ${address}`,
  ];
  if (treatment) lines.push(`💆 Treatment: ${treatment}`);
  lines.push(`💰 Total Bayar: Rp ${pricing.totalFee.toLocaleString('id-ID')} (${pricing.paymentStatusLabel})`);
  if (mapsUrl) lines.push(`🗺️ Google Maps: ${mapsUrl}`);
  return lines.join('\n');
}

export class StaffReservationService {
  /**
   * Mengambil daftar tugas reservasi khusus milik staff ini untuk HARI INI saja,
   * diperkaya dengan alamat, data anak/bayi, navigasi turn-by-turn Maps, rincian harga,
   * dan perhitungan jarak berantai sekuensial (Klinik -> Pasien 1 -> Pasien 2) via Haversine.
   * Catatan keamanan: Nomor HP customer SENGAJA TIDAK di-select dari database (masking layer).
   */
  static async getTodayTasks(staffId: string, tenantId = DEFAULT_TENANT_ID): Promise<StaffTaskItem[]> {
    if (!staffId) return [];

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    try {
      const rows = await prisma.reservation.findMany({
        where: {
          tenant_id: tenantId,
          assigned_staff_id: staffId,
          booking_date: { gte: startOfDay, lte: endOfDay },
        },
        select: {
          id: true,
          treatment_detail: true,
          treatment_category: true,
          booking_date: true,
          status: true,
          purchase_value: true,
          purchase_occurred_at: true,
          customer: {
            select: {
              name: true,
              lat: true,
              lng: true,
              kelurahan: true,
              kecamatan: true,
              kota: true,
              distance_km: true,
              ongkir: true,
              children: {
                select: {
                  name: true,
                  raw_age_text: true,
                  birth_date: true,
                },
              },
              // phone: TIDAK di-select dari DB untuk privasi data customer
              conversations: {
                select: { id: true },
                orderBy: { updated_at: 'desc' },
                take: 1,
              },
            },
          },
          children: {
            select: {
              name: true,
              raw_age_text: true,
              birth_date: true,
            },
          },
        },
        orderBy: { booking_date: 'asc' },
      });

      const circuityFactor = parseFloat(process.env.HAVERSINE_CIRCUITY_FACTOR || '1.60');
      let prevCoords: Coordinates = { lat: clinicConfig.lat, lng: clinicConfig.lng };
      let prevOriginName = 'Klinik';
      let isFirstPatient = true;

      return rows.map((r) => {
        const cust = r.customer;
        const lat = cust?.lat;
        const lng = cust?.lng;
        const mapsUrl = lat && lng ? `https://maps.google.com/?q=${lat},${lng}` : null;
        const navigationUrl =
          lat && lng
            ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`
            : null;
        const addressText = buildAddressText(cust || {});

        // Sequential Homecare Distance Calculation (Haversine 0-API call)
        let distanceKm: number | null = null;
        let distanceSource: 'CLINIC' | 'PREVIOUS_PATIENT' | null = null;
        let originName: string | null = null;

        if (typeof lat === 'number' && typeof lng === 'number') {
          const currentCoords: Coordinates = { lat, lng };
          if (isFirstPatient) {
            // Pasien #1: Dari Klinik ke Pasien #1
            distanceKm = cust?.distance_km ?? parseFloat((calculateHaversineDistance(prevCoords, currentCoords) * circuityFactor).toFixed(1));
            distanceSource = 'CLINIC';
            originName = clinicConfig.name || 'Klinik';
          } else {
            // Pasien #2, #3, dst: Dari Pasien Sebelumnya ke Pasien Sekarang
            const straightKm = calculateHaversineDistance(prevCoords, currentCoords);
            distanceKm = parseFloat((straightKm * circuityFactor).toFixed(1));
            distanceSource = 'PREVIOUS_PATIENT';
            originName = prevOriginName;
          }
          // Update waypoint untuk pasien berikutnya
          prevCoords = currentCoords;
          prevOriginName = cust?.name ? (cust.name.toLowerCase().startsWith('bunda') ? cust.name : `Bunda ${cust.name}`) : 'Pasien Sebelumnya';
          isFirstPatient = false;
        } else {
          // Jika pasien tidak punya koordinat, gunakan fallback distance_km jika ada
          distanceKm = cust?.distance_km ?? null;
          distanceSource = 'CLINIC';
          originName = clinicConfig.name || 'Klinik';
        }

        // Gabungkan children dari reservation dan customer profile (deduplicate by name)
        const combinedChildren = [...(r.children || []), ...(cust?.children || [])];
        const uniqueChildrenMap = new Map<string, StaffTaskChild>();
        for (const ch of combinedChildren) {
          if (ch?.name && !uniqueChildrenMap.has(ch.name)) {
            uniqueChildrenMap.set(ch.name, {
              name: ch.name,
              rawAgeText: ch.raw_age_text || null,
              birthDate: ch.birth_date ? ch.birth_date.toISOString() : null,
            });
          }
        }
        const childrenList = Array.from(uniqueChildrenMap.values());

        // Pricing calculation
        const treatmentFee = r.purchase_value || 0;
        const deliveryFee = cust?.ongkir || 0;
        const totalFee = treatmentFee + deliveryFee;
        const isLunas = !!r.purchase_occurred_at;
        const paymentStatus: 'LUNAS' | 'TAGIH_DI_TEMPAT' = isLunas ? 'LUNAS' : 'TAGIH_DI_TEMPAT';
        const paymentStatusLabel = isLunas ? 'Lunas (Online/Transfer)' : 'Tagih di Tempat (Tunai/Transfer)';

        const pricing: StaffTaskPricing = {
          treatmentFee,
          deliveryFee,
          totalFee,
          paymentStatus,
          paymentStatusLabel,
        };

        return {
          reservationId: r.id,
          customerName: cust?.name || null,
          treatmentDetail: r.treatment_detail,
          treatmentCategory: r.treatment_category || null,
          bookingDate: r.booking_date,
          status: r.status,
          conversationId: cust?.conversations?.[0]?.id || null,
          mapsUrl,
          navigationUrl,
          address: {
            kelurahan: cust?.kelurahan || null,
            kecamatan: cust?.kecamatan || null,
            kota: cust?.kota || null,
            distanceKm,
            estimatedMinutes: estimateTravelDurationMinutes(distanceKm),
            distanceSource,
            originName,
            fullText: addressText,
          },
          children: childrenList,
          pricing,
          shareLocationText: buildShareText(
            cust?.name || null,
            addressText,
            r.treatment_detail,
            mapsUrl,
            pricing
          ),
        };
      });
    } catch (err: any) {
      console.error('[STAFF RESERVATION] Error fetching today tasks:', err.message);
      return [];
    }
  }

  /**
   * Mengambil daftar jadwal reservasi masa depan (hari esok dan seterusnya) milik staff.
   * Bersifat jadwal saja (read-only), TIDAK memiliki akses atau menyertakan conversationId/chat.
   */
  static async getUpcomingSchedule(
    staffId: string,
    tenantId = DEFAULT_TENANT_ID,
    daysAhead = 30
  ): Promise<StaffTaskItem[]> {
    if (!staffId) return [];

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const maxDate = new Date(tomorrow);
    maxDate.setDate(maxDate.getDate() + daysAhead);
    maxDate.setHours(23, 59, 59, 999);

    try {
      const rows = await prisma.reservation.findMany({
        where: {
          tenant_id: tenantId,
          assigned_staff_id: staffId,
          booking_date: { gte: tomorrow, lte: maxDate },
        },
        select: {
          id: true,
          treatment_detail: true,
          treatment_category: true,
          booking_date: true,
          status: true,
          purchase_value: true,
          purchase_occurred_at: true,
          customer: {
            select: {
              name: true,
              lat: true,
              lng: true,
              kelurahan: true,
              kecamatan: true,
              kota: true,
              distance_km: true,
              ongkir: true,
              children: {
                select: {
                  name: true,
                  raw_age_text: true,
                  birth_date: true,
                },
              },
            },
          },
          children: {
            select: {
              name: true,
              raw_age_text: true,
              birth_date: true,
            },
          },
        },
        orderBy: { booking_date: 'asc' },
      });

      const circuityFactor = parseFloat(process.env.HAVERSINE_CIRCUITY_FACTOR || '1.60');
      let lastDateKey = '';
      let prevCoords: Coordinates = { lat: clinicConfig.lat, lng: clinicConfig.lng };
      let prevOriginName = 'Klinik';
      let isFirstPatientOfDay = true;

      return rows.map((r) => {
        const cust = r.customer;
        const lat = cust?.lat;
        const lng = cust?.lng;
        const mapsUrl = lat && lng ? `https://maps.google.com/?q=${lat},${lng}` : null;
        const navigationUrl =
          lat && lng
            ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`
            : null;
        const addressText = buildAddressText(cust || {});

        const dateKey = r.booking_date ? new Date(r.booking_date).toISOString().split('T')[0] : '';
        if (dateKey !== lastDateKey) {
          lastDateKey = dateKey;
          prevCoords = { lat: clinicConfig.lat, lng: clinicConfig.lng };
          prevOriginName = 'Klinik';
          isFirstPatientOfDay = true;
        }

        // Sequential Homecare Distance Calculation (Haversine 0-API call)
        let distanceKm: number | null = null;
        let distanceSource: 'CLINIC' | 'PREVIOUS_PATIENT' | null = null;
        let originName: string | null = null;

        if (typeof lat === 'number' && typeof lng === 'number') {
          const currentCoords: Coordinates = { lat, lng };
          if (isFirstPatientOfDay) {
            distanceKm = cust?.distance_km ?? parseFloat((calculateHaversineDistance(prevCoords, currentCoords) * circuityFactor).toFixed(1));
            distanceSource = 'CLINIC';
            originName = clinicConfig.name || 'Klinik';
          } else {
            const straightKm = calculateHaversineDistance(prevCoords, currentCoords);
            distanceKm = parseFloat((straightKm * circuityFactor).toFixed(1));
            distanceSource = 'PREVIOUS_PATIENT';
            originName = prevOriginName;
          }
          prevCoords = currentCoords;
          prevOriginName = cust?.name ? (cust.name.toLowerCase().startsWith('bunda') ? cust.name : `Bunda ${cust.name}`) : 'Pasien Sebelumnya';
          isFirstPatientOfDay = false;
        } else {
          distanceKm = cust?.distance_km ?? null;
          distanceSource = 'CLINIC';
          originName = clinicConfig.name || 'Klinik';
        }

        const combinedChildren = [...(r.children || []), ...(cust?.children || [])];
        const uniqueChildrenMap = new Map<string, StaffTaskChild>();
        for (const ch of combinedChildren) {
          if (ch?.name && !uniqueChildrenMap.has(ch.name)) {
            uniqueChildrenMap.set(ch.name, {
              name: ch.name,
              rawAgeText: ch.raw_age_text || null,
              birthDate: ch.birth_date ? ch.birth_date.toISOString() : null,
            });
          }
        }
        const childrenList = Array.from(uniqueChildrenMap.values());

        const treatmentFee = r.purchase_value || 0;
        const deliveryFee = cust?.ongkir || 0;
        const totalFee = treatmentFee + deliveryFee;
        const isLunas = !!r.purchase_occurred_at;
        const paymentStatus: 'LUNAS' | 'TAGIH_DI_TEMPAT' = isLunas ? 'LUNAS' : 'TAGIH_DI_TEMPAT';
        const paymentStatusLabel = isLunas ? 'Lunas' : 'Tagih di Tempat';

        const pricing: StaffTaskPricing = {
          treatmentFee,
          deliveryFee,
          totalFee,
          paymentStatus,
          paymentStatusLabel,
        };

        return {
          reservationId: r.id,
          customerName: cust?.name || null,
          treatmentDetail: r.treatment_detail,
          treatmentCategory: r.treatment_category || null,
          bookingDate: r.booking_date,
          status: r.status,
          conversationId: null, // DILARANG: Tidak ada akses chat untuk jadwal masa depan
          mapsUrl,
          navigationUrl,
          address: {
            kelurahan: cust?.kelurahan || null,
            kecamatan: cust?.kecamatan || null,
            kota: cust?.kota || null,
            distanceKm,
            estimatedMinutes: estimateTravelDurationMinutes(distanceKm),
            distanceSource,
            originName,
            fullText: addressText,
          },
          children: childrenList,
          pricing,
          shareLocationText: null,
        };
      });
    } catch (err: any) {
      console.error('[STAFF RESERVATION] Error fetching upcoming schedule:', err.message);
      return [];
    }
  }

  /**
   * Mengambil dan merender template pesan OTW (Menuju Lokasi) khusus tenant.
   * Mendukung kustomisasi dari Super Admin (`FollowUpTemplate` tipe `STAFF_OTW`).
   */
  static async getOtwMessageText(
    tenantId: string = DEFAULT_TENANT_ID,
    params: { patientName: string; therapistName: string }
  ): Promise<string> {
    try {
      // 1. Ambil template kustom tenant dari DB
      const customTpl = await prisma.followUpTemplate.findUnique({
        where: {
          tenant_id_type_variant: {
            tenant_id: tenantId,
            type: 'STAFF_OTW',
            variant: 1,
          },
        },
      });

      // 2. Ambil nama klinik tenant
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true },
      });
      const clinicName = tenant?.name || 'Kala Spa Baby & Mom Homecare';

      let templateText = customTpl?.text;
      if (!templateText) {
        templateText = `Halo Bunda {patientName}, saya {therapistName} dari {clinicName} sudah bersiap dan sedang dalam perjalanan menuju ke lokasi Bunda ya. Mohon ditunggu ya Bunda 🙏🛵`;
      }

      // 3. Render placeholders
      return templateText
        .replace(/\{\{?patientName\}\}?/gi, params.patientName || 'Bunda')
        .replace(/\{\{?name\}\}?/gi, params.patientName || 'Bunda')
        .replace(/\{\{?therapistName\}\}?/gi, params.therapistName || 'Bidan Terapis')
        .replace(/\{\{?clinicName\}\}?/gi, clinicName);
    } catch (err: any) {
      console.error('[STAFF RESERVATION] Error rendering OTW template:', err.message);
      return `Halo Bunda ${params.patientName || 'Bunda'}, saya ${params.therapistName || 'Bidan Terapis'} dari klinik sudah bersiap dan sedang dalam perjalanan menuju ke lokasi Bunda ya. Mohon ditunggu ya Bunda 🙏🛵`;
    }
  }

  /**
   * Mencatat penyelesaian pembayaran transaksi homecare oleh terapis di lapangan.
   * Mendukung pembayaran Tunai (Cash) dan Non-Tunai (Transfer / QRIS) beserta upload bukti foto ringan (bukan HD).
   */
  static async recordPayment(params: {
    reservationId: string;
    staffId: string;
    staffName: string;
    tenantId?: string;
    paymentMethod: 'CASH' | 'TRANSFER' | 'QRIS';
    amount?: number;
    proofImageB64?: string;
    notes?: string;
  }): Promise<{ success: boolean; data?: any; error?: string }> {
    const {
      reservationId,
      staffId,
      staffName,
      tenantId = DEFAULT_TENANT_ID,
      paymentMethod,
      amount,
      proofImageB64,
      notes,
    } = params;

    if (!reservationId || !staffId) {
      return { success: false, error: 'reservationId dan staffId wajib disertakan.' };
    }

    try {
      const reservation = await prisma.reservation.findUnique({
        where: { id: reservationId },
        include: {
          customer: {
            include: {
              conversations: {
                orderBy: { updated_at: 'desc' },
                take: 1,
              },
            },
          },
        },
      });

      if (!reservation) {
        return { success: false, error: 'Reservasi tidak ditemukan.' };
      }

      if (reservation.tenant_id !== tenantId || reservation.assigned_staff_id !== staffId) {
        return { success: false, error: 'Anda tidak memiliki hak akses untuk reservasi ini.' };
      }

      const totalPaid = amount ?? reservation.purchase_value ?? 0;
      const now = new Date();

      // Simpan bukti foto transfer/QRIS jika ada (disimpan dalam format web-res ringan)
      let proofUrl: string | null = null;
      if (proofImageB64 && proofImageB64.startsWith('data:image/')) {
        const { mediaService } = await import('./media.service');
        const matches = proofImageB64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        const mimeType = matches ? matches[1] : 'image/jpeg';
        const rawB64 = matches ? matches[2] : proofImageB64;
        const saved = await mediaService.saveOutboundMedia({
          tenantId,
          imageB64: rawB64,
          mimeType,
          fileName: `proof-${reservationId}.jpg`,
        });
        proofUrl = saved.hdUrl;
      }

      // Update data Reservasi menjadi Lunas
      const updated = await prisma.reservation.update({
        where: { id: reservationId },
        data: {
          purchase_occurred_at: now,
          purchase_value: totalPaid,
          purchase_review_status: 'confirmed',
          status: 'completed',
        },
      });

      // Kirim konfirmasi pembayaran otomatis ke chat customer jika ada percakapan aktif
      const conversationId = reservation.customer?.conversations?.[0]?.id;
      if (conversationId) {
        const methodLabel = paymentMethod === 'CASH' ? 'Tunai' : paymentMethod === 'QRIS' ? 'QRIS' : 'Transfer';
        const receiptText = `✅ *PEMBAYARAN DITERIMA*\n\nTerima kasih Bunda ${reservation.customer?.name || ''}! Pembayaran sebesar *Rp ${totalPaid.toLocaleString('id-ID')}* (${methodLabel}) telah berhasil diterima dan dicatat.\n\nSemoga adik lekas sehat, ceria, dan tumbuh kembangnya optimal ya Bunda! 🙏🥰✨\n\n~ ${staffName}`;

        try {
          const { liveChatService } = await import('./live-chat.service');
          await liveChatService.sendAdminReply({
            conversationId,
            text: receiptText,
            tenantId,
            adminName: staffName,
          });
        } catch (chatErr: any) {
          console.error('[STAFF RESERVATION] Error sending receipt chat message:', chatErr.message);
        }
      }

      // Audit log
      const { auditService } = await import('./audit.service');
      await auditService.logAdminAction({
        apiKey: 'STAFF_SESSION',
        adminIdentity: staffName,
        action: 'STAFF_RECORD_PAYMENT',
        targetId: reservationId,
        payload: {
          paymentMethod,
          amount: totalPaid,
          proofUrl,
          notes,
        },
        tenantId,
      });

      return {
        success: true,
        data: {
          reservationId: updated.id,
          purchaseValue: updated.purchase_value,
          purchaseOccurredAt: updated.purchase_occurred_at,
          paymentMethod,
          proofUrl,
        },
      };
    } catch (err: any) {
      console.error('[STAFF RESERVATION] Error recording payment:', err.message);
      return { success: false, error: `Gagal mencatat pembayaran: ${err.message}` };
    }
  }

  /**
   * Guard kepemilikan: Memastikan bahwa percakapan yang diakses staff memang terhubung
   * ke customer yang memiliki reservasi tugas aktif hari ini yang ditugaskan ke staff tsb.
   */
  static async assertConversationOwnedByStaffToday(
    conversationId: string,
    staffId: string,
    tenantId = DEFAULT_TENANT_ID
  ): Promise<boolean> {
    if (!conversationId || !staffId) return false;

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    try {
      const conv = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { customer_id: true, tenant_id: true },
      });

      if (!conv || conv.tenant_id !== tenantId) return false;

      const owns = await prisma.reservation.findFirst({
        where: {
          tenant_id: tenantId,
          customer_id: conv.customer_id,
          assigned_staff_id: staffId,
          booking_date: { gte: startOfDay, lte: endOfDay },
        },
        select: { id: true },
      });

      return !!owns;
    } catch (err: any) {
      console.error('[STAFF RESERVATION] Error asserting conversation ownership:', err.message);
      return false;
    }
  }
}
