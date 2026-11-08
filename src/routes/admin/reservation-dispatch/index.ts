import { FastifyInstance } from 'fastify';
import { registerTripRoutes } from './trip.route';
import { registerHoldArchiveRoutes } from './hold-archive.route';
import { registerDetailRoutes } from './detail.route';
import { registerLifecycleRoutes } from './lifecycle.route';
import { registerUpdateRoutes } from './update.route';
import { registerStatusRoutes } from './status.route';
import { registerProofAssignRoutes } from './proof-assign.route';
import { registerDeleteRoutes } from './delete.route';
import { registerPurchaseRoutes } from './purchase.route';
import { registerCapiQueueRoutes } from './capi-queue.route';

/**
 * Reservation Dispatch Routes Modular
 * Mengelompokkan seluruh sub-rute dispatch, lifecycle, manajemen reservasi, dan antrean CAPI.
 */
export async function reservationDispatchRoutes(fastify: FastifyInstance): Promise<void> {
  await registerTripRoutes(fastify);
  await registerHoldArchiveRoutes(fastify);
  await registerDetailRoutes(fastify);
  await registerLifecycleRoutes(fastify);
  await registerUpdateRoutes(fastify);
  await registerStatusRoutes(fastify);
  await registerProofAssignRoutes(fastify);
  await registerDeleteRoutes(fastify);
  await registerPurchaseRoutes(fastify);
  await registerCapiQueueRoutes(fastify);
}

export default reservationDispatchRoutes;
