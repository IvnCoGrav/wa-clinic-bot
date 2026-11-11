import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { auditService } from '../../services/audit.service';
import { requireTenantId, resolveTenantId } from './settings-helpers';

export async function settingsCatalogRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/admin/services
   */
  fastify.get('/api/admin/services', async (request, reply) => {
    const { treatmentCatalogService } = await import('../../services/treatment-catalog.service');
    const services = treatmentCatalogService.getAllServices(false);
    return reply.status(200).send({ success: true, count: services.length, data: services });
  });

  /**
   * POST /api/admin/services
   */
  fastify.post('/api/admin/services', async (request: FastifyRequest<{ Body: any }>, reply: FastifyReply) => {
    const { treatmentCatalogService } = await import('../../services/treatment-catalog.service');
    const serviceData = request.body as any;

    if (!serviceData || !serviceData.id || !serviceData.name || serviceData.originalPrice === undefined) {
      return reply.status(400).send({
        error:
          'Data layanan tidak lengkap. Required fields: id, name, originalPrice, promoPrice, durationMinutes, ageTier, category',
      });
    }

    const isBundle = 
      serviceData.category === 'BUNDLE' || 
      serviceData.serviceType === 'BUNDLE' || 
      (Array.isArray(serviceData.bundleItemIds) && serviceData.bundleItemIds.length > 0);

    if (isBundle) {
      const bundleValidation = treatmentCatalogService.validateBundle({
        id: serviceData.id,
        name: serviceData.name,
        bundleItemIds: serviceData.bundleItemIds,
        originalPrice: Number(serviceData.originalPrice),
        promoPrice: Number(serviceData.promoPrice),
      });

      if (!bundleValidation.valid) {
        return reply.status(400).send({
          error: bundleValidation.error,
        });
      }
    }

    const isAddon = 
      serviceData.category === 'ADD_ON' || 
      serviceData.serviceType === 'ADD_ON' || 
      serviceData.isAddon === true;

    // Cfg-010: validasi harga/durasi sebelum menulis.
    if (Number(serviceData.promoPrice) > Number(serviceData.originalPrice)) {
      return reply.status(400).send({ error: 'promoPrice tidak boleh lebih besar dari originalPrice.' });
    }
    const durationCheck = Number(serviceData.durationMinutes);
    if (Number.isFinite(durationCheck) && (durationCheck < 15 || durationCheck > 480)) {
      return reply.status(400).send({ error: 'durationMinutes harus 15–480 menit.' });
    }

    const servicePayload = {
      id: serviceData.id,
      name: serviceData.name,
      category: serviceData.category || 'BABY',
      serviceType: isBundle ? 'BUNDLE' : isAddon ? 'ADD_ON' : (serviceData.serviceType || 'STANDARD'),
      bundleItemIds: isBundle ? serviceData.bundleItemIds : undefined,
      isAddon: isAddon,
      ageTier: serviceData.ageTier || { minAgeMonths: 0, maxAgeMonths: null, label: 'Umum' },
      durationMinutes: Number(serviceData.durationMinutes) || 45,
      originalPrice: Number(serviceData.originalPrice) || 0,
      promoPrice: Number(serviceData.promoPrice) || 0,
      description: serviceData.description || '',
      isActive: serviceData.isActive ?? true,
      eligibleLifeStages: Array.isArray(serviceData.eligibleLifeStages) ? serviceData.eligibleLifeStages : [],
      contraindications: Array.isArray(serviceData.contraindications) ? serviceData.contraindications : [],
      requiresScreening: serviceData.requiresScreening === true,
      minGestationalWeeks: serviceData.minGestationalWeeks == null ? null : Number(serviceData.minGestationalWeeks),
      maxGestationalWeeks: serviceData.maxGestationalWeeks == null ? null : Number(serviceData.maxGestationalWeeks),
      clinicalFamily: serviceData.clinicalFamily || null,
    };

    // Cfg-010: produksi wajib menunggu commit DB.
    let updated: any;
    if (process.env.NODE_ENV === 'production') {
      try {
        updated = await treatmentCatalogService.upsertServicePersisted(servicePayload, resolveTenantId(request));
      } catch {
        return reply.status(503).send({ success: false, code: 'DATABASE_UNAVAILABLE', error: 'Layanan gagal disimpan ke database.' });
      }
    } else {
      updated = treatmentCatalogService.upsertService(servicePayload, resolveTenantId(request));
    }

    await auditService.logAdminAction({
      apiKey: (request as any).adminKeyUsed,
      adminIdentity: (request as any).adminIdentity,
      action: 'UPSERT_SERVICE',
      targetId: serviceData.id,
      payload: serviceData,
      ipAddress: request.ip,
      tenantId: resolveTenantId(request),
    });

    return reply.status(200).send({ success: true, message: 'Service saved successfully', data: updated });
  });

  /**
   * PUT /api/admin/services/:id
   */
  fastify.put(
    '/api/admin/services/:id',
    async (request: FastifyRequest<{ Params: { id: string }; Body: any }>, reply: FastifyReply) => {
      const { id } = request.params;
      const body = request.body || {};
      const { treatmentCatalogService } = await import('../../services/treatment-catalog.service');
      const existing = treatmentCatalogService.getServiceById(id);
      if (!existing) {
        return reply.status(404).send({ error: 'Service not found' });
      }

      const merged = {
        ...existing,
        ...body,
        id,
      };

      const isBundle = 
        merged.category === 'BUNDLE' || 
        merged.serviceType === 'BUNDLE' || 
        (Array.isArray(merged.bundleItemIds) && merged.bundleItemIds.length > 0);

      if (isBundle) {
        const bundleValidation = treatmentCatalogService.validateBundle({
          id: merged.id,
          name: merged.name,
          bundleItemIds: merged.bundleItemIds,
          originalPrice: Number(merged.originalPrice),
          promoPrice: Number(merged.promoPrice),
        });

        if (!bundleValidation.valid) {
          return reply.status(400).send({
            error: bundleValidation.error,
          });
        }
      }

      const isAddon = 
        merged.category === 'ADD_ON' || 
        merged.serviceType === 'ADD_ON' || 
        merged.isAddon === true;

      // Cfg-010: validasi harga/durasi.
      if (Number(merged.promoPrice) > Number(merged.originalPrice)) {
        return reply.status(400).send({ error: 'promoPrice tidak boleh lebih besar dari originalPrice.' });
      }
      const dur = Number(merged.durationMinutes);
      if (Number.isFinite(dur) && (dur < 15 || dur > 480)) {
        return reply.status(400).send({ error: 'durationMinutes harus 15–480 menit.' });
      }

      const servicePayload = {
        ...merged,
        serviceType: isBundle ? 'BUNDLE' : isAddon ? 'ADD_ON' : (merged.serviceType || 'STANDARD'),
        bundleItemIds: isBundle ? merged.bundleItemIds : undefined,
        isAddon: isAddon,
        durationMinutes: Number(merged.durationMinutes),
        originalPrice: Number(merged.originalPrice),
        promoPrice: Number(merged.promoPrice),
        eligibleLifeStages: Array.isArray(merged.eligibleLifeStages)
          ? merged.eligibleLifeStages
          : (existing.eligibleLifeStages || []),
        contraindications: Array.isArray(merged.contraindications)
          ? merged.contraindications
          : (existing.contraindications || []),
        requiresScreening: merged.requiresScreening === true,
        minGestationalWeeks: merged.minGestationalWeeks == null ? null : Number(merged.minGestationalWeeks),
        maxGestationalWeeks: merged.maxGestationalWeeks == null ? null : Number(merged.maxGestationalWeeks),
        clinicalFamily: merged.clinicalFamily || null,
      };

      let updated: any;
      if (process.env.NODE_ENV === 'production') {
        try {
          updated = await treatmentCatalogService.upsertServicePersisted(servicePayload, resolveTenantId(request));
        } catch {
          return reply.status(503).send({ success: false, code: 'DATABASE_UNAVAILABLE', error: 'Layanan gagal disimpan ke database.' });
        }
      } else {
        updated = treatmentCatalogService.upsertService(servicePayload, resolveTenantId(request));
      }

      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'UPDATE_CLINIC_SERVICE',
        targetId: id,
        payload: { name: updated.name },
        ipAddress: request.ip,
        tenantId: resolveTenantId(request),
      });
      return reply.status(200).send({ success: true, data: updated });
    }
  );

  /**
   * DELETE /api/admin/services/:id
   */
  fastify.delete(
    '/api/admin/services/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const { treatmentCatalogService } = await import('../../services/treatment-catalog.service');
      let deleted: boolean;
      if (process.env.NODE_ENV === 'production') {
        try {
          deleted = await treatmentCatalogService.deleteServicePersisted(id, resolveTenantId(request));
        } catch {
          return reply.status(503).send({ success: false, code: 'DATABASE_UNAVAILABLE', error: 'Layanan gagal dihapus dari database.' });
        }
      } else {
        deleted = treatmentCatalogService.deleteService(id);
      }
      if (!deleted) {
        return reply.status(404).send({ error: 'Service not found' });
      }
      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'DELETE_CLINIC_SERVICE',
        targetId: id,
        ipAddress: request.ip,
        tenantId: resolveTenantId(request),
      });
      return reply.status(200).send({ success: true, message: 'Service deleted successfully' });
    }
  );

  /**
   * GET /api/admin/delivery-tiers
   */
  fastify.get('/api/admin/delivery-tiers', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { getDeliveryTiersFromDb } = await import('../../services/delivery.service');
      const tenantId = resolveTenantId(request);
      const tiers = await getDeliveryTiersFromDb(tenantId);
      return reply.status(200).send({
        success: true,
        data: tiers,
      });
    } catch (err: any) {
      const { activeDeliveryTiers } = await import('../../services/delivery.service');
      return reply.status(200).send({
        success: true,
        data: activeDeliveryTiers,
        note: 'Fallback file mode',
      });
    }
  });

  /**
   * POST /api/admin/delivery-tiers
   */
  fastify.post(
    '/api/admin/delivery-tiers',
    async (request: FastifyRequest<{ Body: { tiers: any[] } }>, reply: FastifyReply) => {
      const { tiers } = request.body || {};
      if (!tiers || !Array.isArray(tiers)) {
        return reply.status(400).send({ error: 'Body must contain tiers array' });
      }
      const { saveDeliveryTiersToDb } = await import('../../services/delivery.service');
      const tenantId = requireTenantId(request);
      const success = await saveDeliveryTiersToDb(tiers, tenantId);
      if (!success) {
        return reply.status(500).send({ error: 'Failed to save delivery tiers' });
      }
      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'UPDATE_DELIVERY_TIERS',
        targetId: 'SYSTEM',
        ipAddress: request.ip,
        tenantId,
      });
      return reply.status(200).send({ success: true, message: 'Delivery tiers updated successfully' });
    }
  );
}
