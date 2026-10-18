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

export const DEFAULT_QUICK_REPLIES: Array<{
  shortcut: string;
  title: string;
  content: string;
  category: string;
  media_type?: string | null;
  image_url?: string | null;
}> = [
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
export async function resolveQuickReplyMedia(row: any, tenantId: string): Promise<any> {
  if (!row) return row;
  if (row.media_type !== 'QRIS') {
    return {
      ...row,
      mime_type: row.image_url ? extToMime(row.image_url) : undefined,
    };
  }
  try {
    const { StaffReservationService } = await import('../../services/staff-reservation.service');
    const paymentInfo = await StaffReservationService.getPaymentInfo(tenantId);
    return {
      ...row,
      image_url: paymentInfo.qrisImageUrl ?? null,
      mime_type: extToMime(paymentInfo.qrisImageUrl),
      content: (row.content || '')
        .replace(/\{bank_accounts\}/g, renderBankAccounts(paymentInfo))
        .replace(/\{petunjuk\}/g, paymentInfo.instructions?.trim() || '-'),
    };
  } catch (err) {
    return {
      ...row,
      image_url: null,
      mime_type: 'image/jpeg',
      content: (row.content || '')
        .replace(/\{bank_accounts\}/g, '-')
        .replace(/\{petunjuk\}/g, '-'),
    };
  }
}

export function interpolateQuickReply(
  content: string,
  vars: {
    name?: string;
    nama?: string;
    nama_bunda?: string;
    phone?: string;
    hp?: string;
    no_hp?: string;
    kec?: string;
    kecamatan?: string;
    kota?: string;
    alamat?: string;
    address?: string;
    clinic_name?: string;
    admin_name?: string;
    [key: string]: string | undefined;
  }
): string {
  let out = content;
  const nameVal = vars.name || vars.nama || vars.nama_bunda || 'Bunda';
  const phoneVal = vars.phone || vars.hp || vars.no_hp || '-';
  const kecVal = vars.kec || vars.kecamatan || '';
  const kotaVal = vars.kota || '';
  const alamatVal = vars.alamat || vars.address || '';
  const clinicNameVal = vars.clinic_name || 'Klinik Kami';
  const adminNameVal = vars.admin_name || 'Admin';

  out = out.replace(/\{(?:name|nama|nama_bunda)\}/gi, nameVal);
  out = out.replace(/\{(?:phone|hp|no_hp)\}/gi, phoneVal);
  out = out.replace(/\{(?:kec|kecamatan)\}/gi, kecVal);
  out = out.replace(/\{kota\}/gi, kotaVal);
  out = out.replace(/\{(?:alamat|address)\}/gi, alamatVal);
  out = out.replace(/\{clinic_name\}/gi, clinicNameVal);
  out = out.replace(/\{admin_name\}/gi, adminNameVal);
  return out;
}

function initMemoryDefaults(tenantId: string) {
  const existingShortcuts = new Set(
    Array.from(memoryQuickReplies.values())
      .filter((r) => r.tenant_id === tenantId)
      .map((r) => r.shortcut)
  );
  for (const item of DEFAULT_QUICK_REPLIES) {
    if (!existingShortcuts.has(item.shortcut)) {
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
        rows = await (prisma as any).quickReply.findMany({
          where: { tenant_id: tenantId },
          orderBy: [{ category: 'asc' }, { shortcut: 'asc' }],
        });
      }
      const resolved = await Promise.all(rows.map((r: any) => resolveQuickReplyMedia(r, tenantId)));
      return reply.status(200).send({ success: true, data: resolved });
    } catch (err: any) {
      initMemoryDefaults(tenantId);
      const list = Array.from(memoryQuickReplies.values())
        .filter((r) => r.tenant_id === tenantId)
        .sort((a, b) => (a.category || '').localeCompare(b.category || '') || a.shortcut.localeCompare(b.shortcut));
      const resolvedList = await Promise.all(list.map((r: any) => resolveQuickReplyMedia(r, tenantId)));
      return reply.status(200).send({ success: true, data: resolvedList, note: 'Fallback in-memory mode' });
    }
  });

  /**
   * POST /api/admin/quick-replies
   * Create quick reply baru.
   */
  fastify.post(
    '/api/admin/quick-replies',
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

      if (media_type && !['NONE', 'CUSTOM_IMAGE', 'QRIS'].includes(media_type)) {
        return reply.status(400).send({ success: false, error: 'media_type tidak valid. Harus NONE, CUSTOM_IMAGE, atau QRIS.' });
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
        finalImageUrl = image_url?.trim() || null;
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
        // Check duplicate in memory
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
          if (media_type && !['NONE', 'CUSTOM_IMAGE', 'QRIS'].includes(media_type)) {
            return reply.status(400).send({ success: false, error: 'media_type tidak valid. Harus NONE, CUSTOM_IMAGE, atau QRIS.' });
          }
          updateData.media_type = media_type || 'NONE';
          if (updateData.media_type === 'QRIS' || updateData.media_type === 'NONE') {
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
        } else if (image_url !== undefined && updateData.media_type !== 'QRIS' && updateData.media_type !== 'NONE') {
          updateData.image_url = image_url?.trim() || null;
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
          if (media_type && !['NONE', 'CUSTOM_IMAGE', 'QRIS'].includes(media_type)) {
            return reply.status(400).send({ success: false, error: 'media_type tidak valid. Harus NONE, CUSTOM_IMAGE, atau QRIS.' });
          }
          mem.media_type = media_type || 'NONE';
          if (mem.media_type === 'QRIS' || mem.media_type === 'NONE') {
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
        } else if (image_url !== undefined && mem.media_type !== 'QRIS' && mem.media_type !== 'NONE') {
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
        if (memoryQuickReplies.has(id)) {
          const mem = memoryQuickReplies.get(id)!;
          if (mem.tenant_id !== tenantId) return reply.status(404).send({ success: false, error: 'Balasan cepat tidak ditemukan.' });
          memoryQuickReplies.delete(id);
          return reply.status(200).send({ success: true, message: `Balasan /${mem.shortcut} dihapus.`, note: 'Fallback in-memory mode' });
        }
        return reply.status(500).send({ success: false, error: 'Gagal menghapus balasan cepat.' });
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
      const resolved = await Promise.all(rows.map((r: any) => resolveQuickReplyMedia(r, tenantId)));
      return reply.status(200).send({ success: true, data: resolved });
    } catch (err: any) {
      initMemoryDefaults(tenantId);
      const list = Array.from(memoryQuickReplies.values()).filter((r) => r.tenant_id === tenantId);
      const resolvedList = await Promise.all(list.map((r: any) => resolveQuickReplyMedia(r, tenantId)));
      return reply.status(200).send({ success: true, data: resolvedList, note: 'Fallback in-memory mode' });
    }
  });
}
