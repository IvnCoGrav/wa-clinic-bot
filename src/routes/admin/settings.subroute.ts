import { FastifyInstance } from 'fastify';
import { settingsAiRoutes } from './settings-ai.subroute';
import { settingsCatalogRoutes } from './settings-catalog.subroute';
import { settingsNotificationsRoutes } from './settings-notifications.subroute';
import { settingsGeneralRoutes } from './settings-general.subroute';
import { settingsTenantRoutes } from './settings-tenant.subroute';

export { requireTenantId, resolveTenantId } from './settings-helpers';

export async function settingsAdminRoutes(fastify: FastifyInstance) {
  await settingsAiRoutes(fastify);
  await settingsCatalogRoutes(fastify);
  await settingsNotificationsRoutes(fastify);
  await settingsGeneralRoutes(fastify);
  await settingsTenantRoutes(fastify);
}
