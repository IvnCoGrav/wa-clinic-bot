import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../db/client';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { auditService } from '../../services/audit.service';

export interface MemoryQuickReply {
  id: string;
  tenant_id: string;
  shortcut: string;
  title: string;
  content: string;
  category: string | null;
  media_type: string | null;
  image_url: string | null;
  created_at: Date;
  updated_at: Date;
}

export const memoryQuickReplies = new Map<string, MemoryQuickReply>();
export const memoryInitializedTenants = new Set<string>();

export function isDatabaseOfflineError(err: any): boolean {
  if (!err) return false;
  const msg = String(err?.message || '').toLowerCase();
  const code = String(err?.code || '');
  return (
    msg.includes('database offline') ||
    msg.includes('connection refused') ||
    msg.includes('econnrefused') ||
    code === 'P1000' ||
    code === 'P1001' ||
    code === 'P1002' ||
    code === 'P1008' ||
    code === 'P1017' ||
    code === 'ECONNREFUSED'
  );
}

/**
 * 25 Template Quick Reply Ongkir Cepat (/ongkir1 s/d /ongkir25)
 * Disesuaikan persis dengan tier ongkir resmi klinik (delivery_tiers_custom.json).
 */
export const ONGKIR_QUICK_REPLIES: Array<{
  shortcut: string;
  title: string;
  content: string;
  category: string;
  media_type: string;
  image_url: null;
}> = Array.from({ length: 25 }, (_, idx) => {
  const km = idx + 1;
  let title = `Ongkir ${km} km`;
  let content = '';

  if (km <= 5) {
    title = `Ongkir ${km} km  Gratis`;
    content = `Jika kami cek bunda, dilihat dari jaraknya kurang lebih ${km}km. Dari pricelist kami di 0-5 km layanannya GRATIS ongkir (Free Ongkir) tanpa tambahan biaya bunda ☺️ \nMau pilih treatment apa bund? 🤗`;
  } else if (km <= 7) {
    title = `Ongkir ${km} km  Rp 5.000`;
    content = `Jika kami cek bunda, dilihat dari jaraknya kurang lebih ${km}km. Dari pricelist kami di 5-10 km ada tambahan ongkir 15.000 tetapi karna bulan ini ada promo, kami bisa kasih bunda ongkir menjadi 5.000 saja bunda ☺️ \nMau pilih treatment apa bund? 🤗`;
  } else if (km <= 10) {
    title = `Ongkir ${km} km  Rp 10.000`;
    content = `Jika kami cek bunda, dilihat dari jaraknya kurang lebih ${km}km. Dari pricelist kami di 5-10 km ada tambahan ongkir 15.000 tetapi karna bulan ini ada promo, kami bisa kasih bunda ongkir menjadi 10.000 saja bunda ☺️ \nMau pilih treatment apa bund? 🤗`;
  } else if (km <= 15) {
    title = `Ongkir ${km} km  Rp 15.000`;
    content = `Jika kami cek bunda, dilihat dari jaraknya kurang lebih ${km}km. Dari pricelist kami di 10-15 km ada tambahan ongkir 25.000 tetapi karna bulan ini ada promo, kami bisa kasih bunda ongkir menjadi 15.000 saja bunda ☺️ \nMau pilih treatment apa bund? 🤗`;
  } else if (km <= 20) {
    title = `Ongkir ${km} km  Rp 20.000`;
    content = `Jika kami cek bunda, dilihat dari jaraknya kurang lebih ${km}km. Dari pricelist kami di 15-20 km ada tambahan ongkir 25.000 tetapi karna bulan ini ada promo, kami bisa kasih bunda ongkir menjadi 20.000 saja bunda ☺️ \nMau pilih treatment apa bund? 🤗`;
  } else {
    // 21 - 25 km
    title = `Ongkir ${km} km  Rp 25.000`;
    content = `Jika kami cek bunda, dilihat dari jaraknya kurang lebih ${km}km. Dari pricelist kami di 20-25 km ada tambahan ongkir 35.000 tetapi karna bulan ini ada promo, kami bisa kasih bunda ongkir menjadi 25.000 saja bunda ☺️ \nMau pilih treatment apa bund? 🤗`;
  }

  return {
    shortcut: `ongkir${km}`,
    title,
    content,
    category: 'Lokasi',
    media_type: 'NONE',
    image_url: null,
  };
});

export const DEFAULT_QUICK_REPLIES: Array<{
  shortcut: string;
  title: string;
  content: string;
  category: string;
  media_type?: string | null;
  image_url?: string | null;
}> = [
  ...ONGKIR_QUICK_REPLIES,
  {
    shortcut: 'qris',
    title: 'Pembayaran QRIS & Rekening Resmi',
    category: 'Pembayaran',
    media_type: 'QRIS',
    image_url: null,
    content:
      'Berikut barcode QRIS & rekening resmi kami ya Bunda {name} ✨\n\n' +
      '{bank_accounts}\n\n' +
      '{petunjuk}\n\n' +
      'Mohon kirimkan bukti transfer ke sini setelah pembayaran ya. Terima kasih 🙏',
  },
  {
    shortcut: 'pricelist',
    title: 'Pricelist & Katalog Layanan',
    category: 'Umum',
    media_type: 'PRICELIST',
    image_url: null,
    content:
      'Berikut pricelist dan daftar treatment lengkap di {clinic_name} ya Bunda {name} ✨\n\n' +
      'Silakan dilihat-lihat terlebih dahulu, jika ada keluhan si kecil atau ingin konsultasi treatment yang cocok, boleh kabari kami ya Bunda 🙏',
  },
  {
    shortcut: 'lokasi',
    title: 'Alamat & Patokan Klinik',
    category: 'Lokasi',
    media_type: 'NONE',
    image_url: null,
    content:
      'Alamat lengkap klinik kami:\n📍 Jl. Raya Rungkut No. 45, Surabaya.\nPatokan: Sebelah Apotek K-24.\nJam operasional: 08.00 - 17.00 WIB.\nDitunggu kedatangannya Bunda {name} 🙏',
  },
  {
    shortcut: 'ongkir',
    title: 'Ketentuan & Tarif Ongkir',
    category: 'Lokasi',
    media_type: 'NONE',
    image_url: null,
    content:
      'Tarif transport homecare dihitung berdasarkan jarak dari klinik kami ya Bunda {name}.\nJarak 0-5 km bebas ongkir, selebihnya Rp 3.000/km.\nContoh: jarak 8 km → ongkir Rp 9.000.',
  },
  {
    shortcut: 'jadwal',
    title: 'Jam Operasional & Layanan',
    category: 'Umum',
    media_type: 'NONE',
    image_url: null,
    content:
      'Layanan kami tersedia setiap hari Senin - Minggu pukul 08.00 - 17.00 WIB.\nTersedia home-treatment dan kunjungan klinik.\nSilakan pilih hari & jam yang nyaman untuk Bunda {name} ya ✨',
  },
  {
    shortcut: 'format_reservasi',
    title: 'Format Data Reservasi',
    category: 'Reservasi',
    media_type: 'NONE',
    image_url: null,
    content:
      'Untuk reservasi homecare/klinik, mohon melengkapi data berikut ya Bunda {name}:\n• Nama Bunda: {name}\n• Nama & Usia Anak:\n• Alamat Lengkap & Shareloc:\n• Layanan yang dipilih:\n• Pilihan Hari & Jam:',
  },
  {
    shortcut: 'terimakasih',
    title: 'Ucapan Terima Kasih',
    category: 'Umum',
    media_type: 'NONE',
    image_url: null,
    content:
      'Terima kasih banyak Bunda {name} telah mempercayakan layanan kesehatan keluarga kepada {clinic_name} 🙏\nSemoga lekas pulih dan sehat selalu! ✨',
  },
  {
    shortcut: 'batal',
    title: 'Konfirmasi Pembatalan Reservasi',
    category: 'Reservasi',
    media_type: 'NONE',
    image_url: null,
    content:
      'Baik Bunda {name}, reservasi Anda telah kami batalkan sesuai permintaan.\nJika ingin reschedule di lain waktu, silakan hubungi kami kembali ya. Terima kasih 🙏',
  },
  {
    shortcut: 'shareloc',
    title: 'Permintaan Titik Presisi (Shareloc GPS)',
    category: 'Lokasi',
    media_type: 'NONE',
    image_url: null,
    content:
      'Boleh bantu kirimkan titik lokasi (shareloc WhatsApp) atau seret pin peta di rumah Bunda {name} agar Bidan kami langsung sampai tepat di depan rumah dan tidak tersasar ya Bunda 🙏',
  },
];

export function normalizeShortcut(raw: string): string {
  if (!raw) return '';
  let s = raw.trim().toLowerCase();
  if (s.startsWith('/')) s = s.slice(1);
  s = s.replace(/\s+/g, '');
  return s;
}

export function isValidShortcut(s: string): string | null {
  if (!s) return 'Shortcut tidak boleh kosong.';
  if (s.length < 2 || s.length > 30) return 'Shortcut harus 2-30 karakter.';
  if (!/^[a-z0-9_-]+$/.test(s)) return 'Shortcut hanya boleh huruf kecil, angka, dash dan underscore.';
  return null;
}

export function extToMime(url?: string | null): string {
  if (!url) return 'image/jpeg';
  const clean = url.toLowerCase().split('?')[0];
  if (clean.endsWith('.png')) return 'image/png';
  if (clean.endsWith('.webp')) return 'image/webp';
  if (clean.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

/** True bila URL benar-benar bisa diserahkan ke gateway: publik http(s) atau media outbound tenant. */
export function isDeliverableMediaRef(url?: string | null): boolean {
  if (!url) return false;
  if (url.startsWith('/media/outbound/')) return true;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function renderBankAccounts(paymentInfo: any): string {
  if (paymentInfo?.bankAccounts && Array.isArray(paymentInfo.bankAccounts) && paymentInfo.bankAccounts.length > 0) {
    return paymentInfo.bankAccounts
      .map((a: any) => `• *${a.bank}*: \`${a.accountNumber}\`\n  a.n. ${a.accountName}`)
      .join('\n');
  }
  return '-';
}

/**
 * Resolusi SSOT: gambar + teks rekening HANYA dari Tenant.settings.paymentInfo.
 * Template di DB tetap bertuliskan placeholder — bisa di-edit admin tanpa menyentuh data bank.
 */
export async function resolveQuickReplyMedia(row: any, tenantId: string, cachedPaymentInfo?: any): Promise<any> {
  if (!row) return row;

  let paymentInfo = cachedPaymentInfo;
  const contentStr = typeof row.content === 'string' ? row.content : '';
  const needsPaymentInfo =
    row.media_type === 'QRIS' || contentStr.includes('{bank_accounts}') || contentStr.includes('{petunjuk}');

  if (needsPaymentInfo && paymentInfo === undefined) {
    try {
      const { StaffReservationService } = await import('../../services/staff-reservation.service');
      paymentInfo = await StaffReservationService.getPaymentInfo(tenantId);
    } catch {
      paymentInfo = null;
    }
  }

  let finalContent = contentStr;
  if (paymentInfo && (finalContent.includes('{bank_accounts}') || finalContent.includes('{petunjuk}'))) {
    finalContent = finalContent
      .replace(/\{bank_accounts\}/g, renderBankAccounts(paymentInfo))
      .replace(/\{petunjuk\}/g, paymentInfo.instructions?.trim() || '-');
  }

  if (row.media_type === 'PRICELIST') {
    try {
      const { getPricelistImageUrl } = await import('../../services/pricelist-config.service');
      const raw = await getPricelistImageUrl(tenantId);
      // Hanya sertakan gambar yang bisa dikirim gateway. Fallback aset lokal default
      // TIDAK dikirim agar teks tetap terkirim (mirror perilaku QRIS yang null-safe).
      const deliverable = isDeliverableMediaRef(raw) ? raw : null;
      return {
        ...row,
        content: contentStr,
        resolved_content: finalContent,
        image_url: deliverable,
        mime_type: deliverable ? extToMime(deliverable) : undefined,
      };
    } catch {
      return {
        ...row,
        content: contentStr,
        resolved_content: finalContent,
        image_url: null,
        mime_type: undefined,
      };
    }
  }

  if (row.media_type === 'QRIS') {
    const qrisUrl = paymentInfo?.qrisImageUrl ?? null;
    return {
      ...row,
      content: contentStr,
      resolved_content: finalContent,
      image_url: qrisUrl,
      mime_type: extToMime(qrisUrl),
    };
  }

  return {
    ...row,
    content: contentStr,
    resolved_content: finalContent,
    mime_type: row.image_url ? extToMime(row.image_url) : undefined,
  };
}

export function initMemoryDefaults(tenantId: string) {
  if (memoryInitializedTenants.has(tenantId)) {
    return;
  }
  memoryInitializedTenants.add(tenantId);
  for (const item of DEFAULT_QUICK_REPLIES) {
    const id = `mem_qr_${tenantId}_${item.shortcut}`;
    const now = new Date();
    memoryQuickReplies.set(id, {
      id,
      tenant_id: tenantId,
      shortcut: item.shortcut,
      title: item.title,
      content: item.content,
      category: item.category,
      media_type: item.media_type || 'NONE',
      image_url: item.image_url || null,
      created_at: now,
      updated_at: now,
    });
  }
}

export async function quickRepliesAdminRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/admin/quick-replies
   * List semua quick replies tenant. Auto-seed defaults jika kosong.
   */
  fastify.get('/api/admin/quick-replies', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
    try {
      let rows = await (prisma as any).quickReply.findMany({
        where: { tenant_id: tenantId },
        orderBy: [{ category: 'asc' }, { shortcut: 'asc' }],
      });
      if (rows.length === 0) {
        // Cek flag di tenant.settings untuk memastikan tenant baru belum pernah di-seed
        let alreadySeeded = false;
        try {
          const tenant = await (prisma as any).tenant.findUnique({
            where: { id: tenantId },
            select: { settings: true },
          });
          alreadySeeded = Boolean((tenant?.settings as any)?.quickRepliesSeeded);
        } catch {}

        if (!alreadySeeded) {
          for (const item of DEFAULT_QUICK_REPLIES) {
            await (prisma as any).quickReply.upsert({
              where: { tenant_id_shortcut: { tenant_id: tenantId, shortcut: item.shortcut } },
              update: {},
              create: {
                tenant_id: tenantId,
                shortcut: item.shortcut,
                title: item.title,
                content: item.content,
                category: item.category,
                media_type: item.media_type || 'NONE',
                image_url: item.image_url || null,
              },
            });
          }
          try {
            const currentTenant = await (prisma as any).tenant.findUnique({
              where: { id: tenantId },
              select: { settings: true },
            });
            const prevSettings = (currentTenant?.settings as any) || {};
            await (prisma as any).tenant.update({
              where: { id: tenantId },
              data: { settings: { ...prevSettings, quickRepliesSeeded: true } },
            });
          } catch {}

          rows = await (prisma as any).quickReply.findMany({
            where: { tenant_id: tenantId },
            orderBy: [{ category: 'asc' }, { shortcut: 'asc' }],
          });
        }
      }

      // Ambil paymentInfo sekali per request untuk mencegah N+1 DB query
      let paymentInfo: any = null;
      try {
        const { StaffReservationService } = await import('../../services/staff-reservation.service');
        paymentInfo = await StaffReservationService.getPaymentInfo(tenantId);
      } catch {}

      const resolved = await Promise.all(rows.map((r: any) => resolveQuickReplyMedia(r, tenantId, paymentInfo)));
      return reply.status(200).send({ success: true, data: resolved });
    } catch (err: any) {
      initMemoryDefaults(tenantId);
      const list = Array.from(memoryQuickReplies.values())
        .filter((r) => r.tenant_id === tenantId)
        .sort((a, b) => (a.category || '').localeCompare(b.category || '') || a.shortcut.localeCompare(b.shortcut));
      
      let paymentInfo: any = null;
      try {
        const { StaffReservationService } = await import('../../services/staff-reservation.service');
        paymentInfo = await StaffReservationService.getPaymentInfo(tenantId);
      } catch {}

      const resolvedList = await Promise.all(list.map((r: any) => resolveQuickReplyMedia(r, tenantId, paymentInfo)));
      return reply.status(200).send({ success: true, data: resolvedList, note: 'Fallback in-memory mode' });
    }
  });

  /**
   * POST /api/admin/quick-replies
   * Create quick reply baru.
   */
  fastify.post(
    '/api/admin/quick-replies',
    { bodyLimit: 12 * 1024 * 1024 },
    async (
      request: FastifyRequest<{
        Body: {
          shortcut?: string;
          title?: string;
          content?: string;
          category?: string;
          media_type?: string;
          image_url?: string;
          imageB64?: string;
          mimeType?: string;
          fileName?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
      const { shortcut: rawShortcut, title, content, category, media_type, image_url, imageB64 } = request.body || {};
      const shortcut = normalizeShortcut(rawShortcut || '');
      const err = isValidShortcut(shortcut);
      if (err) return reply.status(400).send({ success: false, error: err });
      if (!title || !title.trim()) return reply.status(400).send({ success: false, error: 'Judul wajib diisi.' });
      if (!content || !content.trim()) return reply.status(400).send({ success: false, error: 'Isi template wajib diisi.' });

      if (media_type && !['NONE', 'CUSTOM_IMAGE', 'QRIS', 'PRICELIST'].includes(media_type)) {
        return reply.status(400).send({ success: false, error: 'media_type tidak valid. Harus NONE, CUSTOM_IMAGE, QRIS, atau PRICELIST.' });
      }

      let finalMediaType = media_type || 'NONE';
      let finalImageUrl: string | null = null;

      if (imageB64) {
        const { mediaService } = await import('../../services/media.service');
        const rawB64 = imageB64.replace(/^data:image\/[^;]+;base64,/, '');
        const saved = await mediaService.saveOutboundMedia({
          tenantId,
          imageB64: rawB64,
          mimeType: (request.body as any)?.mimeType || 'image/png',
          fileName: (request.body as any)?.fileName || 'quick-reply-media.png',
        });
        finalImageUrl = saved.hdUrl;
        finalMediaType = 'CUSTOM_IMAGE';
      } else if (finalMediaType === 'CUSTOM_IMAGE') {
        const candidateUrl = image_url?.trim() || null;
        if (!candidateUrl || !isDeliverableMediaRef(candidateUrl)) {
          return reply.status(400).send({
            success: false,
            error: 'Lampiran gambar kustom wajib diunggah atau memiliki URL media yang valid.',
          });
        }
        finalImageUrl = candidateUrl;
      } else {
        finalImageUrl = null;
      }

      try {
        const existing = await (prisma as any).quickReply.findFirst({
          where: { tenant_id: tenantId, shortcut },
        });
        if (existing) {
          return reply.status(409).send({ success: false, error: `Shortcut /${shortcut} sudah digunakan.` });
        }
        const created = await (prisma as any).quickReply.create({
          data: {
            tenant_id: tenantId,
            shortcut,
            title: title.trim(),
            content: content.trim(),
            category: category?.trim() || null,
            media_type: finalMediaType,
            image_url: finalImageUrl,
          },
        });
        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'CREATE_QUICK_REPLY',
          targetId: created.id,
          payload: { shortcut, title, media_type: finalMediaType },
          ipAddress: request.ip,
          tenantId,
        } as any);
        const resolved = await resolveQuickReplyMedia(created, tenantId);
        return reply.status(201).send({ success: true, data: resolved });
      } catch (err: any) {
        if (!isDatabaseOfflineError(err)) {
          request.log.error({ err, tenantId, shortcut }, '[QUICK_REPLIES] Gagal membuat quick reply di database');
          if (err?.code === 'P2002') {
            return reply.status(409).send({ success: false, error: `Shortcut /${shortcut} sudah digunakan.` });
          }
          return reply.status(500).send({ success: false, error: 'Terjadi kesalahan basis data saat menyimpan balasan cepat.' });
        }
        // Fallback memori hanya saat database offline (mock unit test)
        initMemoryDefaults(tenantId);
        const dup = Array.from(memoryQuickReplies.values()).find((r) => r.tenant_id === tenantId && r.shortcut === shortcut);
        if (dup) return reply.status(409).send({ success: false, error: `Shortcut /${shortcut} sudah digunakan.` });
        const id = `mem_qr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const now = new Date();
        const item: MemoryQuickReply = {
          id,
          tenant_id: tenantId,
          shortcut,
          title: title!.trim(),
          content: content!.trim(),
          category: category?.trim() || null,
          media_type: finalMediaType,
          image_url: finalImageUrl,
          created_at: now,
          updated_at: now,
        };
        memoryQuickReplies.set(id, item);
        const resolved = await resolveQuickReplyMedia(item, tenantId);
        return reply.status(201).send({ success: true, data: resolved, note: 'Fallback in-memory mode' });
      }
    }
  );

  /**
   * PUT /api/admin/quick-replies/:id
   */
  fastify.put(
    '/api/admin/quick-replies/:id',
    { bodyLimit: 12 * 1024 * 1024 },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: {
          shortcut?: string;
          title?: string;
          content?: string;
          category?: string;
          media_type?: string;
          image_url?: string;
          imageB64?: string;
          mimeType?: string;
          fileName?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
      const { id } = request.params;
      const { shortcut: rawShortcut, title, content, category, media_type, image_url, imageB64 } = request.body || {};

      try {
        const existing = await (prisma as any).quickReply.findFirst({ where: { id, tenant_id: tenantId } });
        if (!existing) return reply.status(404).send({ success: false, error: 'Balasan cepat tidak ditemukan.' });

        const updateData: any = {};
        if (rawShortcut !== undefined) {
          const shortcut = normalizeShortcut(rawShortcut);
          const err = isValidShortcut(shortcut);
          if (err) return reply.status(400).send({ success: false, error: err });
          if (shortcut !== existing.shortcut) {
            const dup = await (prisma as any).quickReply.findFirst({ where: { tenant_id: tenantId, shortcut } });
            if (dup) return reply.status(409).send({ success: false, error: `Shortcut /${shortcut} sudah digunakan.` });
          }
          updateData.shortcut = shortcut;
        }
        if (title !== undefined) {
          if (!title.trim()) return reply.status(400).send({ success: false, error: 'Judul tidak boleh kosong.' });
          updateData.title = title.trim();
        }
        if (content !== undefined) {
          if (!content.trim()) return reply.status(400).send({ success: false, error: 'Isi template tidak boleh kosong.' });
          updateData.content = content.trim();
        }
        if (category !== undefined) updateData.category = category?.trim() || null;

        if (media_type !== undefined) {
          if (media_type && !['NONE', 'CUSTOM_IMAGE', 'QRIS', 'PRICELIST'].includes(media_type)) {
            return reply.status(400).send({ success: false, error: 'media_type tidak valid. Harus NONE, CUSTOM_IMAGE, QRIS, atau PRICELIST.' });
          }
          updateData.media_type = media_type || 'NONE';
          if (updateData.media_type === 'QRIS' || updateData.media_type === 'PRICELIST' || updateData.media_type === 'NONE') {
            updateData.image_url = null;
          }
        }

        if (imageB64) {
          const { mediaService } = await import('../../services/media.service');
          const rawB64 = imageB64.replace(/^data:image\/[^;]+;base64,/, '');
          const saved = await mediaService.saveOutboundMedia({
            tenantId,
            imageB64: rawB64,
            mimeType: (request.body as any)?.mimeType || 'image/png',
            fileName: (request.body as any)?.fileName || 'quick-reply-media.png',
          });
          updateData.image_url = saved.hdUrl;
          updateData.media_type = 'CUSTOM_IMAGE';
        } else if (updateData.media_type === 'CUSTOM_IMAGE' || (updateData.media_type === undefined && existing.media_type === 'CUSTOM_IMAGE')) {
          const isChangingToCustom = updateData.media_type === 'CUSTOM_IMAGE' && existing.media_type !== 'CUSTOM_IMAGE';
          const isExplicitlyUpdatingUrl = image_url !== undefined;

          // D-4: Hanya tolak jika beralih ke CUSTOM_IMAGE tanpa gambar, atau jika secara eksplisit mengirimkan URL gambar baru yang rusak.
          // Jika hanya mengedit title/content pada baris eksisting CUSTOM_IMAGE, pertahankan existing.image_url.
          if (isChangingToCustom || isExplicitlyUpdatingUrl) {
            const candidateUrl = image_url !== undefined ? image_url?.trim() || null : existing.image_url;
            if (!candidateUrl || !isDeliverableMediaRef(candidateUrl)) {
              return reply.status(400).send({
                success: false,
                error: 'Lampiran gambar kustom wajib diunggah atau memiliki URL media yang valid.',
              });
            }
            updateData.image_url = candidateUrl;
          }
        }

        const updated = await (prisma as any).quickReply.update({ where: { id }, data: updateData });
        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UPDATE_QUICK_REPLY',
          targetId: id,
          payload: updateData,
          ipAddress: request.ip,
          tenantId,
        } as any);
        const resolved = await resolveQuickReplyMedia(updated, tenantId);
        return reply.status(200).send({ success: true, data: resolved });
      } catch (err: any) {
        if (!isDatabaseOfflineError(err)) {
          request.log.error({ err, tenantId, id }, '[QUICK_REPLIES] Gagal memperbarui quick reply di database');
          if (err?.code === 'P2002') {
            return reply.status(409).send({ success: false, error: 'Shortcut sudah digunakan.' });
          }
          return reply.status(500).send({ success: false, error: 'Terjadi kesalahan basis data saat memperbarui balasan cepat.' });
        }
        const mem = memoryQuickReplies.get(id);
        if (!mem || mem.tenant_id !== tenantId) {
          return reply.status(404).send({ success: false, error: 'Balasan cepat tidak ditemukan.' });
        }
        if (rawShortcut !== undefined) {
          const shortcut = normalizeShortcut(rawShortcut);
          const e = isValidShortcut(shortcut);
          if (e) return reply.status(400).send({ success: false, error: e });
          const dup = Array.from(memoryQuickReplies.values()).find((r) => r.tenant_id === tenantId && r.shortcut === shortcut && r.id !== id);
          if (dup) return reply.status(409).send({ success: false, error: `Shortcut /${shortcut} sudah digunakan.` });
          mem.shortcut = shortcut;
        }
        if (title !== undefined) mem.title = title.trim();
        if (content !== undefined) mem.content = content.trim();
        if (category !== undefined) mem.category = category?.trim() || null;
        if (media_type !== undefined) {
          if (media_type && !['NONE', 'CUSTOM_IMAGE', 'QRIS', 'PRICELIST'].includes(media_type)) {
            return reply.status(400).send({ success: false, error: 'media_type tidak valid. Harus NONE, CUSTOM_IMAGE, QRIS, atau PRICELIST.' });
          }
          mem.media_type = media_type || 'NONE';
          if (mem.media_type === 'QRIS' || mem.media_type === 'PRICELIST' || mem.media_type === 'NONE') {
            mem.image_url = null;
          }
        }
        if (imageB64) {
          const { mediaService } = await import('../../services/media.service');
          const rawB64 = imageB64.replace(/^data:image\/[^;]+;base64,/, '');
          const saved = await mediaService.saveOutboundMedia({
            tenantId,
            imageB64: rawB64,
            mimeType: (request.body as any)?.mimeType || 'image/png',
            fileName: (request.body as any)?.fileName || 'quick-reply-media.png',
          });
          mem.image_url = saved.hdUrl;
          mem.media_type = 'CUSTOM_IMAGE';
        } else if (image_url !== undefined && mem.media_type !== 'QRIS' && mem.media_type !== 'PRICELIST' && mem.media_type !== 'NONE') {
          mem.image_url = image_url?.trim() || null;
        }
        mem.updated_at = new Date();
        const resolved = await resolveQuickReplyMedia(mem, tenantId);
        return reply.status(200).send({ success: true, data: resolved, note: 'Fallback in-memory mode' });
      }
    }
  );

  /**
   * DELETE /api/admin/quick-replies/:id
   */
  fastify.delete(
    '/api/admin/quick-replies/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
      const { id } = request.params;
      try {
        const existing = await (prisma as any).quickReply.findFirst({ where: { id, tenant_id: tenantId } });
        if (!existing) return reply.status(404).send({ success: false, error: 'Balasan cepat tidak ditemukan.' });
        await (prisma as any).quickReply.delete({ where: { id } });
        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'DELETE_QUICK_REPLY',
          targetId: id,
          payload: { shortcut: existing.shortcut },
          ipAddress: request.ip,
          tenantId,
        } as any);
        return reply.status(200).send({ success: true, message: `Balasan /${existing.shortcut} dihapus.` });
      } catch (err: any) {
        if (!isDatabaseOfflineError(err)) {
          request.log.error({ err, tenantId, id }, '[QUICK_REPLIES] Gagal menghapus quick reply di database');
          return reply.status(500).send({ success: false, error: 'Gagal menghapus balasan cepat.' });
        }
        if (memoryQuickReplies.has(id)) {
          const mem = memoryQuickReplies.get(id)!;
          if (mem.tenant_id !== tenantId) return reply.status(404).send({ success: false, error: 'Balasan cepat tidak ditemukan.' });
          memoryQuickReplies.delete(id);
          return reply.status(200).send({ success: true, message: `Balasan /${mem.shortcut} dihapus.`, note: 'Fallback in-memory mode' });
        }
        return reply.status(404).send({ success: false, error: 'Balasan cepat tidak ditemukan.' });
      }
    }
  );

  /**
   * POST /api/admin/quick-replies/seed-defaults
   */
  fastify.post('/api/admin/quick-replies/seed-defaults', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
    try {
      for (const item of DEFAULT_QUICK_REPLIES) {
        await (prisma as any).quickReply.upsert({
          where: { tenant_id_shortcut: { tenant_id: tenantId, shortcut: item.shortcut } },
          update: {
            title: item.title,
            content: item.content,
            category: item.category,
            media_type: item.media_type || 'NONE',
            image_url: item.image_url || null,
          },
          create: {
            tenant_id: tenantId,
            shortcut: item.shortcut,
            title: item.title,
            content: item.content,
            category: item.category,
            media_type: item.media_type || 'NONE',
            image_url: item.image_url || null,
          },
        });
      }
      const rows = await (prisma as any).quickReply.findMany({
        where: { tenant_id: tenantId },
        orderBy: [{ category: 'asc' }, { shortcut: 'asc' }],
      });
      let paymentInfo: any = null;
      try {
        const { StaffReservationService } = await import('../../services/staff-reservation.service');
        paymentInfo = await StaffReservationService.getPaymentInfo(tenantId);
      } catch {}
      const resolved = await Promise.all(rows.map((r: any) => resolveQuickReplyMedia(r, tenantId, paymentInfo)));
      return reply.status(200).send({ success: true, data: resolved });
    } catch (err: any) {
      if (!isDatabaseOfflineError(err)) {
        request.log.error({ err, tenantId }, '[QUICK_REPLIES] Gagal seed defaults di database');
        return reply.status(500).send({ success: false, error: 'Gagal melakukan seed template bawaan.' });
      }
      memoryInitializedTenants.delete(tenantId);
      initMemoryDefaults(tenantId);
      const list = Array.from(memoryQuickReplies.values()).filter((r) => r.tenant_id === tenantId);
      let paymentInfo: any = null;
      try {
        const { StaffReservationService } = await import('../../services/staff-reservation.service');
        paymentInfo = await StaffReservationService.getPaymentInfo(tenantId);
      } catch {}
      const resolvedList = await Promise.all(list.map((r: any) => resolveQuickReplyMedia(r, tenantId, paymentInfo)));
      return reply.status(200).send({ success: true, data: resolvedList, note: 'Fallback in-memory mode' });
    }
  });
}
