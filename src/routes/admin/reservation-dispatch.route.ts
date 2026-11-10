import { FastifyInstance } from 'fastify';
import { reservationDispatchTripRoutes } from './reservation-dispatch-trip.subroute';
import { reservationDispatchStatusRoutes } from './reservation-dispatch-status.subroute';
import { reservationDispatchCrudRoutes } from './reservation-dispatch-crud.subroute';
import { reservationDispatchPaymentProofRoutes } from './reservation-dispatch-payment-proof.subroute';

export {
  CompleteOutcome,
  completeReservationById,
  runCompletionSideEffects,
  BULK_COMPLETE_MAX_IDS,
} from './reservation-dispatch-status.subroute';

export async function reservationDispatchRoutes(fastify: FastifyInstance) {
  await reservationDispatchTripRoutes(fastify);
  await reservationDispatchStatusRoutes(fastify);
  await reservationDispatchCrudRoutes(fastify);
  await reservationDispatchPaymentProofRoutes(fastify);
}

export default reservationDispatchRoutes;
