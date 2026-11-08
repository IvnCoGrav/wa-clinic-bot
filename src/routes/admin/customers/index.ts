import { FastifyInstance } from 'fastify';
import { responseCacheService } from '../../../services/response-cache.service';
import { registerCustomerExportStatsRoutes } from './customers-export-stats.route';
import { registerCustomerListDetailRoutes } from './customers-list-detail.route';
import { registerCustomerAddressRoutes } from './customers-address.route';
import { registerCustomerActionsRoutes } from './customers-actions.route';
import { registerCustomerLocationRoutes } from './customers-location.route';

export async function customerAdminRoutes(fastify: FastifyInstance) {
  // Invalidate cache saat ada create/update/delete customer
  fastify.addHook('onResponse', async (request) => {
    const method = request.method;
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method) && request.url.includes('/customers')) {
      // Phase 3: only invalidate list cache, preserve stats cache (60s)
      if (!request.url.includes('/stats')) {
        responseCacheService.invalidatePrefix('customers:list:');
      }
    }
  });

  await registerCustomerExportStatsRoutes(fastify);
  await registerCustomerListDetailRoutes(fastify);
  await registerCustomerAddressRoutes(fastify);
  await registerCustomerActionsRoutes(fastify);
  await registerCustomerLocationRoutes(fastify);
}

export default customerAdminRoutes;
export * from './shared';
export * from './customers-export-stats.route';
export * from './customers-list-detail.route';
export * from './customers-address.route';
export * from './customers-actions.route';
export * from './customers-location.route';
