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
  created_at: Date;
  updated_at: Date;
}

export const memoryQuickReplies = new Map<string, MemoryQuickReply>();

export const DEFAULT_QUICK_REPLIES: Array<{ shortcut: string; title: string; content: string; category: string }> = [
  {
    shortcut: 'rek',
    title: 'Rekening Pembayaran Klinik',
    category: 'Pembayaran',
    content:
      'Pembayaran dapat ditransfer ke rekening resmi kami:\n🏦 BCA: 1234567890 a.n Klinik\n🏦 Mandiri: 9876543210 a.n Klinik\nMohon kirimkan bukti transfer setelah transaksi ya Bunda {name} ✨',
  },
  {
    shortcut: 'lokasi',
    title: 'Alamat & Patokan Klinik',
    category: 'Lokasi',
    content:
      'Alamat lengkap klinik kami:\n📍 Jl. Raya Rungkut No. 45, Surabaya.\nPatokan: Sebelah Apotek K-24.\nJam operasional: 08.00 - 17.00 WIB.\nDitunggu kedatangannya Bunda {name} 🙏',
  },
  {
    shortcut: 'ongkir',
    title: 'Ketentuan & Tarif Ongkir',
    category: 'Lokasi',
    content:
      'Tarif transport homecare dihitung berdasarkan jarak dari klinik kami ya Bunda {name}.\nJarak 0-5 km bebas ongkir, selebihnya Rp 3.000/km.\nContoh: jarak 8 km → ongkir Rp 9.000.',
  },
  {
    shortcut: 'jadwal',
    title: 'Jam Operasional & Layanan',
    category: 'Umum',
    content:
      'Layanan kami tersedia setiap hari Senin - Minggu pukul 08.00 - 17.00 WIB.\nTersedia home-treatment dan kunjungan klinik.\nSilakan pilih hari & jam yang nyaman untuk Bunda {name} ya ✨',
  },
  {
    shortcut: 'format_reservasi',
    title: 'Format Data Reservasi',
    category: 'Reservasi',
    content:
      'Untuk reservasi homecare/klinik, mohon melengkapi data berikut ya Bunda {name}:\n• Nama Bunda: {name}\n• Nama & Usia Anak:\n• Alamat Lengkap & Shareloc:\n• Layanan yang dipilih:\n• Pilihan Hari & Jam:',
  },
  {
    shortcut: 'terimakasih',
    title: 'Ucapan Terima Kasih',
    category: 'Umum',
    content:
      'Terima kasih banyak Bunda {name} telah mempercayakan layanan kesehatan keluarga kepada {clinic_name} 🙏\nSemoga lekas pulih dan sehat selalu! ✨',
  },
  {
    shortcut: 'batal',
    title: 'Konfirmasi Pembatalan Reservasi',
    category: 'Reservasi',
    content:
      'Baik Bunda {name}, reservasi Anda telah kami batalkan sesuai permintaan.\nJika ingin reschedule di lain waktu, silakan hubungi kami kembali ya. Terima kasih 🙏',
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

export function interpolateQuickReply(
  content: string,
  vars: { name?: string; phone?: string; clinic_name?: string; admin_name?: string }
): string {
  let out = content;
  out = out.replace(/\{name\}/g, vars.name || 'Bunda');
  out = out.replace(/\{phone\}/g, vars.phone || '-');
  out = out.replace(/\{clinic_name\}/g, vars.clinic_name || 'Klinik Kami');
  out = out.replace(/\{admin_name\}/g, vars.admin_name || 'Admin');
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
            },
          });
        }
        rows = await (prisma as any).quickReply.findMany({
          where: { tenant_id: tenantId },
          orderBy: [{ category: 'asc' }, { shortcut: 'asc' }],
        });
      }
      return reply.status(200).send({ success: true, data: rows });
    } catch (err: any) {
      initMemoryDefaults(tenantId);
      const list = Array.from(memoryQuickReplies.values())
        .filter((r) => r.tenant_id === tenantId)
        .sort((a, b) => (a.category || '').localeCompare(b.category || '') || a.shortcut.localeCompare(b.shortcut));
      return reply.status(200).send({ success: true, data: list, note: 'Fallback in-memory mode' });
    }
  });

  /**
   * POST /api/admin/quick-replies
   * Create quick reply baru.
   */
  fastify.post(
    '/api/admin/quick-replies',
    async (
      request: FastifyRequest<{ Body: { shortcut?: string; title?: string; content?: string; category?: string } }>,
      reply: FastifyReply
    ) => {
      const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
      const { shortcut: rawShortcut, title, content, category } = request.body || {};
      const shortcut = normalizeShortcut(rawShortcut || '');
      const err = isValidShortcut(shortcut);
      if (err) return reply.status(400).send({ success: false, error: err });
      if (!title || !title.trim()) return reply.status(400).send({ success: false, error: 'Judul wajib diisi.' });
      if (!content || !content.trim()) return reply.status(400).send({ success: false, error: 'Isi template wajib diisi.' });

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
          },
        });
        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'CREATE_QUICK_REPLY',
          targetId: created.id,
          payload: { shortcut, title },
          ipAddress: request.ip,
          tenantId,
        } as any);
        return reply.status(201).send({ success: true, data: created });
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
          created_at: now,
          updated_at: now,
        };
        memoryQuickReplies.set(id, item);
        return reply.status(201).send({ success: true, data: item, note: 'Fallback in-memory mode' });
      }
    }
  );

  /**
   * PUT /api/admin/quick-replies/:id
   */
  fastify.put(
    '/api/admin/quick-replies/:id',
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: { shortcut?: string; title?: string; content?: string; category?: string } }>,
      reply: FastifyReply
    ) => {
      const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
      const { id } = request.params;
      const { shortcut: rawShortcut, title, content, category } = request.body || {};

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
        return reply.status(200).send({ success: true, data: updated });
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
        mem.updated_at = new Date();
        return reply.status(200).send({ success: true, data: mem, note: 'Fallback in-memory mode' });
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
          update: { title: item.title, content: item.content, category: item.category },
          create: {
            tenant_id: tenantId,
            shortcut: item.shortcut,
            title: item.title,
            content: item.content,
            category: item.category,
          },
        });
      }
      const rows = await (prisma as any).quickReply.findMany({
        where: { tenant_id: tenantId },
        orderBy: [{ category: 'asc' }, { shortcut: 'asc' }],
      });
      return reply.status(200).send({ success: true, data: rows });
    } catch (err: any) {
      initMemoryDefaults(tenantId);
      const list = Array.from(memoryQuickReplies.values()).filter((r) => r.tenant_id === tenantId);
      return reply.status(200).send({ success: true, data: list, note: 'Fallback in-memory mode' });
    }
  });
}
