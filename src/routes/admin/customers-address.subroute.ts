import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../db/client';
import { customerService } from '../../services/customer.service';
import { tenantOf } from './route-helpers';
import { MAX_ADDRESS_LABEL_LENGTH } from '../../domain/customer-address';

/**
 * Relink jadwal AKTIF yang memakai kartu alamat tertentu + selaraskan ongkir.
 * Seam tunggal agar semua jalur penulisan lokasi memakai gerbang yang sama.
 */
export async function relinkActiveReservationsForCard(params: {
  tenantId: string;
  customerId: string;
  cardId: string;
  fee?: number | null;
}): Promise<void> {
  const { tenantId, customerId, cardId, fee } = params;
  try {
    const { isActiveReservation, ACTIVE_RESERVATION_STATUSES } = await import('../../domain/reservation-status');
    const activeRows = await prisma.reservation.findMany({
      where: {
        tenant_id: tenantId,
        customer_id: customerId,
        customer_address_id: cardId,
        status: { in: ACTIVE_RESERVATION_STATUSES },
      },
    }).catch(() => []);
    for (const r of ((activeRows || []) as any[]).filter((row) => isActiveReservation(row))) {
      await prisma.reservation.update({
        where: { id: r.id },
        data: {
          customer_address_id: cardId,
          ...(typeof fee === 'number' ? { delivery_fee: fee } : {}),
        },
      }).catch(() => {});
    }
  } catch (syncErr: any) {
    console.warn('[ADMIN][addresses] relink active reservation skipped:', syncErr?.message);
  }
}

export async function customersAddressRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/admin/customers/:id/addresses
   */
  fastify.get(
    '/api/admin/customers/:id/addresses',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const tenantId = tenantOf(request);
      try {
        const addresses = await customerService.getSavedAddresses(id, tenantId);
        return reply.status(200).send({ success: true, addresses });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );

  /**
   * POST /api/admin/customers/:id/addresses
   */
  fastify.post(
    '/api/admin/customers/:id/addresses',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: {
          label?: string;
          address?: string;
          kelurahan?: string;
          kecamatan?: string;
          kota?: string;
          lat?: number | null;
          lng?: number | null;
          landmark?: string | null;
          isPrimary?: boolean;
        };
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const tenantId = tenantOf(request);
      const label = String(request.body?.label ?? '').trim();
      if (!label) {
        return reply.status(400).send({ success: false, error: 'Label wajib diisi.' });
      }
      if (label.length > MAX_ADDRESS_LABEL_LENGTH) {
        return reply
          .status(400)
          .send({ success: false, error: `Label maksimal ${MAX_ADDRESS_LABEL_LENGTH} karakter.` });
      }

      const body = request.body || {};
      const lat = typeof body.lat === 'number' && Number.isFinite(body.lat) ? body.lat : null;
      const lng = typeof body.lng === 'number' && Number.isFinite(body.lng) ? body.lng : null;

      try {
        const customer = await customerService.getCustomerById(id, tenantId);
        if (!customer) {
          return reply.status(404).send({ success: false, error: 'Customer tidak ditemukan.' });
        }

        const entry = await customerService.addSavedAddress(
          id,
          {
            label,
            address: body.address ? String(body.address).trim() : '',
            kelurahan: body.kelurahan ? String(body.kelurahan).trim() : null,
            kecamatan: body.kecamatan ? String(body.kecamatan).trim() : null,
            kota: body.kota ? String(body.kota).trim() : null,
            lat,
            lng,
            landmark: body.landmark ? String(body.landmark).trim() : null,
            isPrimary: Boolean(body.isPrimary),
          },
          tenantId
        );
        return reply.status(201).send({ success: true, entry });
      } catch (err: any) {
        console.error('[ADMIN][addresses] gagal menambah alamat:', id, err?.message);
        return reply
          .status(500)
          .send({ success: false, error: 'Gagal menambahkan alamat. Silakan coba lagi.' });
      }
    }
  );

  /**
   * PATCH /api/admin/customers/:id/addresses/:addressId/default
   */
  fastify.patch(
    '/api/admin/customers/:id/addresses/:addressId/default',
    async (
      request: FastifyRequest<{ Params: { id: string; addressId: string } }>,
      reply: FastifyReply
    ) => {
      const { id, addressId } = request.params;
      const tenantId = tenantOf(request);
      const list = await customerService.getSavedAddresses(id, tenantId).catch(() => []);
      if (!list.some((a) => a.id === addressId)) {
        return reply.status(404).send({ success: false, error: 'Alamat tidak ditemukan pada buku alamat customer.' });
      }
      try {
        await customerService.setDefaultAddress(id, addressId, tenantId);
        return reply.status(200).send({ success: true });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );

  /**
   * PATCH /api/admin/customers/:id/addresses/:addressId/label
   */
  fastify.patch(
    '/api/admin/customers/:id/addresses/:addressId/label',
    async (
      request: FastifyRequest<{ Params: { id: string; addressId: string }; Body: { label?: string } }>,
      reply: FastifyReply
    ) => {
      const { id, addressId } = request.params;
      const tenantId = tenantOf(request);
      const label = String(request.body?.label ?? '').trim();
      if (!label) {
        return reply.status(400).send({ success: false, error: 'Label wajib diisi.' });
      }
      if (label.length > MAX_ADDRESS_LABEL_LENGTH) {
        return reply
          .status(400)
          .send({ success: false, error: `Label maksimal ${MAX_ADDRESS_LABEL_LENGTH} karakter.` });
      }
      const list = await customerService.getSavedAddresses(id, tenantId).catch(() => []);
      const card = list.find((a) => a.id === addressId);
      if (!card) {
        return reply.status(404).send({ success: false, error: 'Alamat tidak ditemukan pada buku alamat customer.' });
      }
      try {
        const entry = await customerService.upsertSavedAddress(
          id,
          {
            id: card.id,
            address: card.address,
            kelurahan: card.kelurahan,
            kecamatan: card.kecamatan,
            kota: card.kota,
            lat: card.lat,
            lng: card.lng,
            distanceKm: card.distanceKm,
            ongkir: card.ongkir,
            landmark: card.landmark,
            locationSource: card.locationSource,
            label,
          },
          tenantId
        );
        if (!entry) return reply.status(404).send({ success: false, error: 'Customer tidak ditemukan.' });
        return reply.status(200).send({ success: true, entry });
      } catch (err: any) {
        console.error('[ADMIN][addresses] gagal mengubah label alamat:', id, addressId, err?.message);
        return reply
          .status(500)
          .send({ success: false, error: 'Gagal mengubah label alamat. Silakan coba lagi.' });
      }
    }
  );

  /**
   * PUT /api/admin/customers/:id/addresses/:addressId
   */
  fastify.put(
    '/api/admin/customers/:id/addresses/:addressId',
    async (
      request: FastifyRequest<{
        Params: { id: string; addressId: string };
        Body: {
          label?: string;
          address?: string;
          kelurahan?: string;
          kecamatan?: string;
          kota?: string;
          lat?: number | null;
          lng?: number | null;
          landmark?: string | null;
          distanceKm?: number | null;
          ongkir?: number | null;
        };
      }>,
      reply: FastifyReply
    ) => {
      const { id, addressId } = request.params;
      const tenantId = tenantOf(request);

      const customer = await customerService.getCustomerById(id, tenantId);
      if (!customer) {
        return reply.status(404).send({ success: false, error: 'Customer tidak ditemukan.' });
      }

      const body = request.body || {};
      const label = body.label !== undefined ? String(body.label).trim() : undefined;
      if (label !== undefined && label.length > MAX_ADDRESS_LABEL_LENGTH) {
        return reply
          .status(400)
          .send({ success: false, error: `Label maksimal ${MAX_ADDRESS_LABEL_LENGTH} karakter.` });
      }

      const list = await customerService.getSavedAddresses(id, tenantId).catch(() => []);
      const card = list.find((a) => a.id === addressId);
      if (!card) {
        return reply.status(404).send({ success: false, error: 'Alamat tidak ditemukan pada buku alamat customer.' });
      }

      try {
        const entry = await customerService.upsertSavedAddress(
          id,
          {
            id: card.id,
            address: body.address !== undefined && body.address.trim() ? body.address.trim() : card.address,
            kelurahan: body.kelurahan !== undefined ? (body.kelurahan?.trim() || null) : card.kelurahan,
            kecamatan: body.kecamatan !== undefined ? (body.kecamatan?.trim() || null) : card.kecamatan,
            kota: body.kota !== undefined ? (body.kota?.trim() || null) : card.kota,
            lat: typeof body.lat === 'number' && Number.isFinite(body.lat) ? body.lat : card.lat,
            lng: typeof body.lng === 'number' && Number.isFinite(body.lng) ? body.lng : card.lng,
            distanceKm: body.distanceKm !== undefined ? body.distanceKm : card.distanceKm,
            ongkir: body.ongkir !== undefined ? body.ongkir : card.ongkir,
            landmark: body.landmark !== undefined ? (body.landmark?.trim() || null) : card.landmark,
            locationSource: (card as any).locationSource ?? (card as any).location_source ?? null,
            label: label !== undefined && label.length > 0 ? label : card.label,
          },
          tenantId
        );

        if (!entry) {
          return reply.status(404).send({ success: false, error: 'Customer tidak ditemukan.' });
        }

        const coordsChanged =
          (typeof body.lat === 'number' && Number.isFinite(body.lat) && body.lat !== card.lat) ||
          (typeof body.lng === 'number' && Number.isFinite(body.lng) && body.lng !== card.lng);

        if (coordsChanged) {
          await relinkActiveReservationsForCard({
            tenantId,
            customerId: id,
            cardId: card.id,
            fee: entry.ongkir,
          });
        }

        return reply.status(200).send({ success: true, entry });
      } catch (err: any) {
        console.error('[ADMIN][addresses] gagal memperbarui alamat:', id, addressId, err?.message);
        return reply
          .status(500)
          .send({ success: false, error: 'Gagal memperbarui alamat. Silakan coba lagi.' });
      }
    }
  );

  /**
   * DELETE /api/admin/customers/:id/addresses/:addressId
   */
  fastify.delete(
    '/api/admin/customers/:id/addresses/:addressId',
    async (
      request: FastifyRequest<{ Params: { id: string; addressId: string } }>,
      reply: FastifyReply
    ) => {
      const { id, addressId } = request.params;
      const tenantId = tenantOf(request);
      const list = await customerService.getSavedAddresses(id, tenantId).catch(() => []);
      if (!list.some((a) => a.id === addressId)) {
        return reply.status(404).send({ success: false, error: 'Alamat tidak ditemukan pada buku alamat customer.' });
      }
      try {
        const res = await customerService.deleteSavedAddress(id, addressId, tenantId);
        if (!res.deleted) {
          return reply.status(409).send({
            success: false,
            error: `Kartu dipakai ${res.activeCount} jadwal aktif. Alihkan jadwal ke kartu lain sebelum menghapus.`,
            activeCount: res.activeCount,
          });
        }
        return reply.status(200).send({ success: true, deleted: true });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );
}
