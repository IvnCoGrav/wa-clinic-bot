import { ConversationState } from '@prisma/client';
import { StateHandlerContext, StateHandlerResult } from '../types';
import { clinicConfig } from '../../config/clinic';

/**
 * Handler untuk state INITIAL:
 * Ketika pesan pertama kali masuk dari nomor baru / percakapan baru.
 */
export async function handleGreetingState(ctx: StateHandlerContext): Promise<StateHandlerResult> {
  const customerName = ctx.customer.name ? ` ${ctx.customer.name}` : '';
  const greetingText = `Halo${customerName}! Selamat datang di ${clinicConfig.name} ✨\n\nUntuk informasi layanan dan kalkulasi ongkir treatment ke lokasi Anda, boleh tolong informasikan **nama kelurahan/desa** Anda? Atau Anda bisa kirimkan **Share Location** via WhatsApp ya! 😊`;

  return {
    nextState: ConversationState.AWAITING_LOCATION,
    replyText: greetingText,
    shouldSendReply: true,
  };
}
