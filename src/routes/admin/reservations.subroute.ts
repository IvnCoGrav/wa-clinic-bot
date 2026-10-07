import { FastifyInstance } from 'fastify';
import { responseCacheService } from '../../services/response-cache.service';

export async function reservationAdminRoutes(fastify: FastifyInstance) {
  // Invalidate cache saat ada create/update/delete reservasi (termasuk series)
  fastify.addHook('onResponse', async (request) => {
    const method = request.method;
    if (
      ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method) &&
      (request.url.includes('/reservations') ||
        request.url.includes('/reservation-series') ||
        request.url.includes('/reservation/'))
    ) {
      responseCacheService.invalidatePrefix('reservations:');
    }
  });
}

export default reservationAdminRoutes;