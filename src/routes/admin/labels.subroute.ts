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
  description?: string | null;
  created_at: Date;
  updated_at: Date;
  _count?: { customers: number };
}

import { isSystemLabelName, isBypassLabelName } from '../../utils/customer-bypass';

export const DEFAULT_SYSTEM_LABELS = [
  { name: 'Hold', color: '#dc2626', description: 'Penanganan khusus / tahan balasan bot otomatis' },
  { name: 'Admin (CS)', color: '#7c3aed', description: 'Percakapan ditangani manual oleh Admin CS' },
  { name: 'Skip', color: '#64748b', description: 'Bypass semua mekanisme sistem (bukan customer)' },
  { name: 'Pending Payment', color: '#d97706', description: 'Pasien dalam tahap menunggu pembayaran / transfer' },
  { name: 'Repeat Order', color: '#059669', description: 'Pelanggan setia yang pernah melakukan reservasi' },
  { name: 'New Customer', color: '#0284c7', description: 'Pasien baru yang baru pertama kali kontak' },
  { name: 'Medical Emergency', color: '#e11d48', description: 'Kebutuhan darurat medis atau konsultasi bidan khusus' },
  { name: 'Unresolved FAQ', color: '#ea580c', description: 'Pertanyaan kompleks yang belum terjawab otomatis' },
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
        description: item.description,
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
            update: { description: item.description },
            create: {
              tenant_id: DEFAULT_TENANT_ID,
              name: item.name,
              color: item.color,
              description: item.description,
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

      const enriched = labels.map((l) => ({
        ...l,
        is_system: isSystemLabelName(l.name),
      }));

      return reply.status(200).send({ success: true, data: enriched });
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
          return { ...l, _count: { customers: count }, is_system: isSystemLabelName(l.name) };
        });
      return reply.status(200).send({ success: true, data: list, note: 'Fallback in-memory mode' });
    }
  });

  /**
   * POST /api/admin/labels/seed-defaults
   * Memastikan seluruh default system label ter-seed ke DB jika belum ada.
   */
  fastify.post('/api/admin/labels/seed-defaults', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      for (const item of DEFAULT_SYSTEM_LABELS) {
        await prisma.label.upsert({
          where: { tenant_id_name: { tenant_id: DEFAULT_TENANT_ID, name: item.name } },
          update: { description: item.description },
          create: {
            tenant_id: DEFAULT_TENANT_ID,
            name: item.name,
            color: item.color,
            description: item.description,
          },
        });
      }

      const labels = await prisma.label.findMany({
        where: { tenant_id: DEFAULT_TENANT_ID },
        include: { _count: { select: { customers: true } } },
        orderBy: { name: 'asc' },
      });

      const enriched = labels.map((l) => ({ ...l, is_system: isSystemLabelName(l.name) }));
      return reply.status(200).send({ success: true, data: enriched });
    } catch (err: any) {
      initMemoryLabels();
      const enriched = Array.from(memoryLabels.values()).map((l) => ({ ...l, is_system: isSystemLabelName(l.name) }));
      return reply.status(200).send({ success: true, data: enriched });
    }
  });

  /**
   * POST /api/admin/labels
   * Membuat label kustom baru.
   */
  fastify.post(
    '/api/admin/labels',
    async (
      request: FastifyRequest<{
        Body: { name: string; color?: string; description?: string };
      }>,
      reply: FastifyReply
    ) => {
      const { name, color = '#008069', description } = request.body || {};

      if (!name || !name.trim()) {
        return reply.status(400).send({ success: false, error: 'Nama label wajib diisi.' });
      }

      const trimmedName = name.trim();

      try {
        const existing = await prisma.label.findFirst({
          where: {
            tenant_id: DEFAULT_TENANT_ID,
            name: { equals: trimmedName, mode: 'insensitive' },
          },
        });

        if (existing) {
          return reply.status(409).send({ success: false, error: `Label "${trimmedName}" sudah ada.` });
        }

        const newLabel = await prisma.label.create({
          data: {
            tenant_id: DEFAULT_TENANT_ID,
            name: trimmedName,
            color: color.trim(),
            description: description?.trim() || null,
          },
        });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'CREATE_LABEL',
          targetId: newLabel.id,
          payload: { name: trimmedName, color },
          ipAddress: request.ip,
          tenantId: DEFAULT_TENANT_ID,
        });

        return reply.status(201).send({ success: true, data: { ...newLabel, is_system: isSystemLabelName(newLabel.name) } });
      } catch (err: any) {
        // In-memory fallback
        const id = `mem_label_${Date.now()}`;
        const newLabel: MemoryLabel = {
          id,
          tenant_id: DEFAULT_TENANT_ID,
          name: trimmedName,
          color: color.trim(),
          description: description?.trim() || null,
          created_at: new Date(),
          updated_at: new Date(),
        };
        memoryLabels.set(id, newLabel);
        return reply.status(201).send({ success: true, data: { ...newLabel, is_system: isSystemLabelName(newLabel.name) }, note: 'Fallback in-memory mode' });
      }
    }
  );

  /**
   * PATCH /api/admin/labels/:id
   * Memperbarui label kustom (nama, warna, deskripsi).
   */
  fastify.patch(
    '/api/admin/labels/:id',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { name?: string; color?: string; description?: string };
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const { name, color, description } = request.body || {};

      try {
        const existing = await prisma.label.findFirst({
          where: { id, tenant_id: DEFAULT_TENANT_ID },
        });

        if (!existing) {
          return reply.status(404).send({ success: false, error: 'Label tidak ditemukan.' });
        }

        const data: any = {};
        if (name && name.trim()) data.name = name.trim();
        if (color && color.trim()) data.color = color.trim();
        if (description !== undefined) data.description = description ? description.trim() : null;

        const updated = await prisma.label.update({
          where: { id },
          data,
        });

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UPDATE_LABEL',
          targetId: id,
          payload: data,
          ipAddress: request.ip,
          tenantId: DEFAULT_TENANT_ID,
        });

        return reply.status(200).send({ success: true, data: { ...updated, is_system: isSystemLabelName(updated.name) } });
      } catch (err: any) {
        const mem = memoryLabels.get(id);
        if (mem) {
          if (name && name.trim()) mem.name = name.trim();
          if (color && color.trim()) mem.color = color.trim();
          if (description !== undefined) mem.description = description ? description.trim() : null;
          mem.updated_at = new Date();
          return reply.status(200).send({ success: true, data: { ...mem, is_system: isSystemLabelName(mem.name) }, note: 'Fallback in-memory mode' });
        }
        return reply.status(500).send({ success: false, error: 'Gagal memperbarui label.' });
      }
    }
  );

  /**
   * DELETE /api/admin/labels/:id
   * Menghapus label (dilindungi: label bawaan sistem TIDAK boleh dihapus).
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

        // GUARD: Label bawaan sistem dilindungi dari penghapusan
        if (isSystemLabelName(existing.name)) {
          return reply.status(400).send({
            success: false,
            error: `Label "${existing.name}" merupakan label bawaan sistem dan tidak dapat dihapus demi stabilitas fitur bot.`,
          });
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
          const mem = memoryLabels.get(id);
          if (mem && isSystemLabelName(mem.name)) {
            return reply.status(400).send({
              success: false,
              error: `Label "${mem.name}" merupakan label bawaan sistem dan tidak dapat dihapus demi stabilitas fitur bot.`,
            });
          }
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
        Body: { labelId?: string; action?: 'add' | 'remove' | 'unassign' | 'delete'; labelIds?: string[] };
      }>,
      reply: FastifyReply
    ) => {
      const { id: customerId } = request.params;
      const { labelId, action, labelIds } = request.body || {};

      try {
        // Resolve customer from DB
        let customer = await prisma.customer.findFirst({
          where: {
            OR: [{ id: customerId }, { phone: customerId }],
          },
        });
        if (!customer) {
          throw new Error(`Customer ${customerId} tidak ditemukan di database.`);
        }
        const resolvedCustomerId = customer.id;

        // If labelIds array provided, replace all labels for customer
        if (Array.isArray(labelIds)) {
          // Resolve all valid label IDs
          const validLabels = await prisma.label.findMany({
            where: { tenant_id: DEFAULT_TENANT_ID, id: { in: labelIds } },
          });
          const validLabelIds = validLabels.map((l) => l.id);

          await prisma.$transaction([
            prisma.customerLabel.deleteMany({ where: { customer_id: resolvedCustomerId } }),
            prisma.customerLabel.createMany({
              data: validLabelIds.map((lid) => ({ customer_id: resolvedCustomerId, label_id: lid })),
              skipDuplicates: true,
            }),
          ]);

          // Sinkronisasi flags boolean
          const hasHold = validLabels.some((l) => l.name.toLowerCase() === 'hold');
          const hasAdmin = validLabels.some((l) => l.name.toLowerCase().includes('admin'));
          const hasBypass = validLabels.some((l) => isBypassLabelName(l.name));

          await prisma.customer.update({
            where: { id: resolvedCustomerId },
            data: {
              is_hold_labeled: hasHold,
              is_admin_labeled: hasAdmin || hasBypass,
              labels_synced_at: new Date(),
            },
          }).catch(() => {});

          // Jika terdapat label bypass/admin, batalkan seluruh follow-up aktif — SKIPPED kanonis, tenant-isolated
          if (hasBypass || hasAdmin) {
            try {
              const { followUpService } = await import('../../services/follow-up.service');
              await followUpService.skipFollowUpsForBypassCustomer(resolvedCustomerId, DEFAULT_TENANT_ID);
            } catch {}
          }

          const updatedCustomer = await prisma.customer.findUnique({
            where: { id: resolvedCustomerId },
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

        // Resolve label from DB (with fallback to default label auto-creation)
        let targetLabel = await prisma.label.findUnique({ where: { id: labelId } });
        if (!targetLabel) {
          const memLbl = memoryLabels.get(labelId);
          const lookupName = memLbl?.name || labelId;
          targetLabel = await prisma.label.findFirst({
            where: { tenant_id: DEFAULT_TENANT_ID, name: { equals: lookupName, mode: 'insensitive' } },
          });
          if (!targetLabel) {
            const defItem = DEFAULT_SYSTEM_LABELS.find((d) => d.name.toLowerCase() === lookupName.toLowerCase());
            if (defItem) {
              targetLabel = await prisma.label.upsert({
                where: { tenant_id_name: { tenant_id: DEFAULT_TENANT_ID, name: defItem.name } },
                update: { description: defItem.description },
                create: {
                  tenant_id: DEFAULT_TENANT_ID,
                  name: defItem.name,
                  color: defItem.color,
                  description: defItem.description,
                },
              });
            }
          }
        }

        if (!targetLabel) {
          throw new Error(`Label ${labelId} tidak ditemukan di database.`);
        }
        const resolvedLabelId = targetLabel.id;

        const isRemove = action === 'remove' || action === 'unassign' || action === 'delete';
        if (isRemove) {
          await prisma.customerLabel.deleteMany({
            where: { customer_id: resolvedCustomerId, label_id: resolvedLabelId },
          });
        } else {
          await prisma.customerLabel.upsert({
            where: {
              customer_id_label_id: {
                customer_id: resolvedCustomerId,
                label_id: resolvedLabelId,
              },
            },
            update: {},
            create: {
              customer_id: resolvedCustomerId,
              label_id: resolvedLabelId,
            },
          });
        }

        // Auto-sync customer boolean flags (is_hold_labeled, is_admin_labeled)
        try {
          const normName = targetLabel.name.toLowerCase();
          const isAssigned = !isRemove;
          const isBypass = isBypassLabelName(targetLabel.name);
          const flagUpdates: Record<string, boolean> = {};

          if (normName === 'hold') {
            flagUpdates.is_hold_labeled = isAssigned;
          } else if (normName.includes('admin') || isBypass) {
            flagUpdates.is_admin_labeled = isAssigned;
          }

          if (Object.keys(flagUpdates).length > 0) {
            await prisma.customer.updateMany({
              where: { id: resolvedCustomerId },
              data: {
                ...flagUpdates,
                labels_synced_at: new Date(),
              },
            });
          }

          // Jika label bypass/admin di-assign, batalkan follow-up aktif seketika — SKIPPED kanonis
          if (isAssigned && (isBypass || normName.includes('admin'))) {
            try {
              const { followUpService } = await import('../../services/follow-up.service');
              await followUpService.skipFollowUpsForBypassCustomer(resolvedCustomerId, DEFAULT_TENANT_ID);
            } catch {}
          }
        } catch {
          // Best-effort flag sync
        }

        const activeLabels = await prisma.customerLabel.findMany({
          where: { customer_id: resolvedCustomerId },
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
          const isRemoveMem = action === 'remove' || action === 'unassign' || action === 'delete';
          const key = `${customerId}:${labelId}`;
          if (isRemoveMem) {
            memoryCustomerLabels.delete(key);
          } else {
            memoryCustomerLabels.add(key);
          }

          const memLbl = memoryLabels.get(labelId);
          if (memLbl) {
            const normName = memLbl.name.toLowerCase();
            const isAssigned = !isRemoveMem;
            const { customerService } = await import('../../services/customer.service');
            for (const cust of customerService.getMemoryCustomers().values()) {
              if (cust?.id === customerId || cust?.phone === customerId) {
                if (normName === 'hold') cust.is_hold_labeled = isAssigned;
                if (normName.includes('admin')) cust.is_admin_labeled = isAssigned;
              }
            }
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
