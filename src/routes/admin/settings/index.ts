import { FastifyInstance } from 'fastify';
import { registerClinicProfileRoutes } from './clinic-profile.route';
import { registerAiConfigRoutes } from './ai-config.route';
import { registerIntegrationsRoutes } from './integrations.route';
import { registerTreatmentsCrudRoutes } from './treatments-crud.route';
import { registerSystemSecurityRoutes } from './system-security.route';

export { buildProvidersStatus, resolveTenantId, inMemoryConversationBehavior } from './shared';

/**
 * Settings Admin Routes Modular
 * Mengelompokkan seluruh sub-rute konfigurasi klinik, AI, integrasi, katalog layanan, dan health system.
 */
export async function settingsAdminRoutes(fastify: FastifyInstance): Promise<void> {
  await registerClinicProfileRoutes(fastify);
  await registerAiConfigRoutes(fastify);
  await registerIntegrationsRoutes(fastify);
  await registerTreatmentsCrudRoutes(fastify);
  await registerSystemSecurityRoutes(fastify);
}

export default settingsAdminRoutes;
