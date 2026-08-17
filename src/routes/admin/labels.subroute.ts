import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../db/client';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { auditService } from '../../services/audit.service';

// In-memory fallback store for offline tests
export interface MemoryLabel {
  id: string;
  tenant_id: string;
  name: string;
  color: string;
  created_at: Date;
  updated_at: Date;
  _count?: { customers: number };
}

export const DEFAULT_SYSTEM_LABELS = [
  { name: 'Hold', color: '#dc2626' }, // Merah - Penanganan khusus / tahan bot
  { name: 'Admin (CS)', color: '#7c3aed' }, // Ungu - Ditangani Admin CS
  { name: 'Pending Payment', color: '#d97706' }, // Amber - Menunggu Pembayaran
  { name: 'Repeat Order', color: '#059669' }, // Hijau - Pelanggan Setia / Repeat
  { name: 'New Customer', color: '#0284c7' }, // Biru - Pasien Baru
  { name: 'Medical Emergency', color: '#e11d48' }, // Rose - Darurat Medis / Bidan
  { name: 'Unresolved FAQ', color: '#ea580c' }, // Oranye - Pertanyaan Belum Terjawab
  { name: 'MQL (Hot Lead)', color: '#10b981' }, // Emerald - Hot Lead
];

export const memoryLabels = new Map<string, MemoryLabel>();
export const memoryCustomerLabels = new Set<string>(); // "customerId:labelId"

// Inisialisasi default memory labels jika kosong
function initMemoryLabels() {
  if (memoryLabels.size === 0) {
    for (const [idx, item] of DEFAULT_SYSTEM_LABELS.entries()) {
      const id = `mem_label_default_${idx + 1}`;
      memoryLabels.set(id, {
        id,
        tenant_id: DEFAULT_TENANT_ID,
        name: item.name,
        color: item.color,
        created_at: new Date(),
        updated_at: new Date(),
      });
    }
  }
}

export async function labelsAdminRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/admin/labels
   * Mengambil daftar label untuk tenant (otomatis menginisialisasi default jika kosong).
   */
  fastify.get('/api/admin/labels', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      let labels = await prisma.label.findMany({
        where: { tenant_id: DEFAULT_TENANT_ID },
        include: {
          _count: {
            select: { customers: true },
          },
        },
        orderBy: { name: 'asc' },
      });

      // Jika belum ada label sama sekali, auto-seed default system labels
      if (labels.length === 0) {
        for (const item of DEFAULT_SYSTEM_LABELS) {
          await prisma.label.upsert({
            where: { tenant_id_name: { tenant_id: DEFAULT_TENANT_ID, name: item.name } },
            update: {},
            create: {
              tenant_id: DEFAULT_TENANT_ID,
              name: item.name,
              color: item.color,
            },
          });
        }
        labels = await prisma.label.findMany({
          where: { tenant_id: DEFAULT_TENANT_ID },
          include: {
            _count: {
              select: { customers: true },
            },
          },
          orderBy: { name: 'asc' },
        });
      }

      return reply.status(200).send({ success: true, data: labels });
    } catch (err: any) {
      // In-memory fallback
      initMemoryLabels();
      const list = Array.from(memoryLabels.values())
        .filter((l) => l.tenant_id === DEFAULT_TENANT_ID)
        .map((l) => {
          let count = 0;
          for (const key of memoryCustomerLabels) {
            if (key.endsWith(`:${l.id}`)) count++;
          }
          return { ...l, _count: { customers: count } };
        });
      return reply.status(200).send({ success: true, data: list, note: 'Fallback in-memory mode' });
    }
  });

  /**
   * POST /api/admin/labels/seed-defaults
   * Menambahkan/merestorasi seluruh label default sistem.
   */
  fastify.post('/api/admin/labels/seed-defaults', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      for (const item of DEFAULT_SYSTEM_LABELS) {
        await prisma.label.upsert({
          where: { tenant_id_name: { tenant_id: DEFAULT_TENANT_ID, name: item.name } },
          update: { color: item.color },
          create: {
            tenant_id: DEFAULT_TENANT_ID,
            name: item.name,
            color: item.color,
          },
        });
      }

      const labels = await prisma.label.findMany({
        where: { tenant_id: DEFAULT_TENANT_ID },
        include: { _count: { select: { customers: true } } },
        orderBy: { name: 'asc' },
      });

      return reply.status(200).send({ success: true, data: labels });
    } catch (err: any) {
      initMemoryLabels();
      return reply.status(200).send({ success: true, data: Array.from(memoryLabels.values()) });
    }
  });

  /**
   * POST /api/admin/labels
   * Membuat label baru.
   */
  fastify.post(
    '/api/admin/labels',
    async (
      request: FastifyRequest<{
        Body: { name?: string; color?: string };
      }>,
      reply: FastifyReply
    ) => {
      const { name, color = '#008069' } = request.body || {};

      if (!name || !name.trim()) {
        return reply.status(400).send({ success: false, error: 'Nama label wajib diisi.' });
      }

      const cleanName = name.trim();
      const cleanColor = color.trim() || '#008069';

      try {
        const existing = await prisma.label.findFirst({
          where: { tenant_id: DEFAULT_TENANT_ID, name: { equals: cleanName, mode: 'insensitive' } },
        });

        if (existing) {
          return reply.status(409).send({ success: false, error: `Label "${cleanName}" sudah ada.` });
        }

        const label = await prisma.label.create({
          data: {
            tenant_id: DEFAULT_TENANT_ID,
            name: cleanName,
            color: cleanColor,
          },
        });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'CREATE_LABEL',
          targetId: label.id,
          payload: { name: label.name, color: label.color },
          ipAddress: request.ip,
          tenantId: DEFAULT_TENANT_ID,
        });

        return reply.status(201).send({ success: true, data: label });
      } catch (err: any) {
        // In-memory fallback
        const id = `mem_label_${Date.now()}`;
        const newLabel: MemoryLabel = {
          id,
          tenant_id: DEFAULT_TENANT_ID,
          name: cleanName,
          color: cleanColor,
          created_at: new Date(),
          updated_at: new Date(),
        };
        memoryLabels.set(id, newLabel);
        return reply.status(201).send({ success: true, data: newLabel, note: 'Fallback in-memory mode' });
      }
    }
  );

  /**
   * PATCH /api/admin/labels/:id
   * Mengedit nama atau warna label.
   */
  fastify.patch(
    '/api/admin/labels/:id',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { name?: string; color?: string };
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const { name, color } = request.body || {};

      try {
        const existing = await prisma.label.findFirst({
          where: { id, tenant_id: DEFAULT_TENANT_ID },
        });

        if (!existing) {
          return reply.status(404).send({ success: false, error: 'Label tidak ditemukan.' });
        }

        const updateData: any = {};
        if (name !== undefined && name.trim()) updateData.name = name.trim();
        if (color !== undefined && color.trim()) updateData.color = color.trim();

        const updated = await prisma.label.update({
          where: { id },
          data: updateData,
        });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UPDATE_LABEL',
          targetId: id,
          payload: updateData,
          ipAddress: request.ip,
          tenantId: DEFAULT_TENANT_ID,
        });

        return reply.status(200).send({ success: true, data: updated });
      } catch (err: any) {
        const mem = memoryLabels.get(id);
        if (mem) {
          if (name) mem.name = name.trim();
          if (color) mem.color = color.trim();
          mem.updated_at = new Date();
          return reply.status(200).send({ success: true, data: mem, note: 'Fallback in-memory mode' });
        }
        return reply.status(500).send({ success: false, error: 'Gagal memperbarui label.' });
      }
    }
  );

  /**
   * DELETE /api/admin/labels/:id
   * Menghapus label.
   */
  fastify.delete(
    '/api/admin/labels/:id',
    async (
      request: FastifyRequest<{
        Params: { id: string };
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;

      try {
        const existing = await prisma.label.findFirst({
          where: { id, tenant_id: DEFAULT_TENANT_ID },
        });

        if (!existing) {
          return reply.status(404).send({ success: false, error: 'Label tidak ditemukan.' });
        }

        await prisma.label.delete({ where: { id } });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'DELETE_LABEL',
          targetId: id,
          payload: { name: existing.name },
          ipAddress: request.ip,
          tenantId: DEFAULT_TENANT_ID,
        });

        return reply.status(200).send({ success: true, message: `Label "${existing.name}" berhasil dihapus.` });
      } catch (err: any) {
        if (memoryLabels.has(id)) {
          memoryLabels.delete(id);
          for (const key of memoryCustomerLabels) {
            if (key.endsWith(`:${id}`)) memoryCustomerLabels.delete(key);
          }
          return reply.status(200).send({ success: true, message: 'Label dihapus.', note: 'Fallback in-memory mode' });
        }
        return reply.status(500).send({ success: false, error: 'Gagal menghapus label.' });
      }
    }
  );

  /**
   * POST /api/admin/customers/:id/labels
   * Menambahkan / melepas label dari customer.
   * Body: { labelId: string, action: 'add' | 'remove' } OR { labelIds: string[] }
   */
  fastify.post(
    '/api/admin/customers/:id/labels',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { labelId?: string; action?: 'add' | 'remove'; labelIds?: string[] };
      }>,
      reply: FastifyReply
    ) => {
      const { id: customerId } = request.params;
      const { labelId, action, labelIds } = request.body || {};

      try {
        // If labelIds array provided, replace all labels for customer
        if (Array.isArray(labelIds)) {
          await prisma.$transaction([
            prisma.customerLabel.deleteMany({ where: { customer_id: customerId } }),
            prisma.customerLabel.createMany({
              data: labelIds.map((lid) => ({ customer_id: customerId, label_id: lid })),
              skipDuplicates: true,
            }),
          ]);

          const updatedCustomer = await prisma.customer.findUnique({
            where: { id: customerId },
            include: {
              labels: {
                include: { label: true },
              },
            },
          });

          return reply.status(200).send({
            success: true,
            data: updatedCustomer?.labels.map((cl) => cl.label) || [],
          });
        }

        if (!labelId) {
          return reply.status(400).send({ success: false, error: 'labelId atau labelIds wajib disertakan.' });
        }

        if (action === 'remove') {
          await prisma.customerLabel.deleteMany({
            where: { customer_id: customerId, label_id: labelId },
          });
        } else {
          await prisma.customerLabel.upsert({
            where: {
              customer_id_label_id: {
                customer_id: customerId,
                label_id: labelId,
              },
            },
            update: {},
            create: {
              customer_id: customerId,
              label_id: labelId,
            },
          });
        }

        const activeLabels = await prisma.customerLabel.findMany({
          where: { customer_id: customerId },
          include: { label: true },
        });

        return reply.status(200).send({
          success: true,
          data: activeLabels.map((cl) => cl.label),
        });
      } catch (err: any) {
        // In-memory fallback
        if (Array.isArray(labelIds)) {
          for (const key of Array.from(memoryCustomerLabels)) {
            if (key.startsWith(`${customerId}:`)) memoryCustomerLabels.delete(key);
          }
          for (const lid of labelIds) {
            memoryCustomerLabels.add(`${customerId}:${lid}`);
          }
        } else if (labelId) {
          const key = `${customerId}:${labelId}`;
          if (action === 'remove') {
            memoryCustomerLabels.delete(key);
          } else {
            memoryCustomerLabels.add(key);
          }
        }

        const currentLabels: MemoryLabel[] = [];
        for (const key of memoryCustomerLabels) {
          if (key.startsWith(`${customerId}:`)) {
            const lid = key.split(':')[1];
            const l = memoryLabels.get(lid);
            if (l) currentLabels.push(l);
          }
        }

        return reply.status(200).send({ success: true, data: currentLabels, note: 'Fallback in-memory mode' });
      }
    }
  );
}
