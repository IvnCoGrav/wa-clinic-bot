import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../../src/db/client';
import { isReservationFormMessage, isPotentialReservationForm } from '../../src/utils/reservation-text-parser';
import { conversationService } from '../../src/services/conversation.service';
import { commandService } from '../../src/services/command.service';
import { burstCoalesceService } from '../../src/services/burst-coalesce.service';

const TENANT = 'default-tenant';

describe('State Machine & Message Flow Hardening (SM-02, SM-04, SM-06, SM-07, SM-08)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Form Detection Semantics (SM-02)', () => {
    it('isPotentialReservationForm identifies structured booking forms without overfitting string phrases', () => {
      const form1 = `Format Booking:
Nama: Bunda Siti
Alamat: Jl. Melati 10
Treatment: Pijat Bayi`;
      expect(isPotentialReservationForm(form1)).toBe(true);

      const form2 = `Berikut rincian order kami:
Nama anak: Adik Budi
Keluhan: batuk pilek
Jadwal: Besok pagi`;
      expect(isPotentialReservationForm(form2)).toBe(true);

      const casualChat = 'Halo kak, besok ada slot kosong jam 10 pagi gak ya?';
      expect(isPotentialReservationForm(casualChat)).toBe(false);
    });
  });

  describe('2. Atomic Conversation Reset (SM-04)', () => {
    it('conversationService.resetConversationToInitial cleans pending location, state, and episodic session atomically', async () => {
      const convId = 'conv-reset-1';
      const custId = 'cust-reset-1';

      vi.spyOn(conversationService, 'updateConversationState').mockResolvedValue({ id: convId } as any);
      vi.spyOn(conversationService, 'updateLastDiscussedTreatment').mockResolvedValue({ id: convId } as any);

      await expect(
        conversationService.resetConversationToInitial(convId, custId, TENANT)
      ).resolves.not.toThrow();

      expect(conversationService.updateConversationState).toHaveBeenCalledWith(
        convId,
        expect.objectContaining({
          currentState: 'INITIAL',
          locationAttempts: 0,
        }),
        TENANT
      );
    });
  });

  describe('3. Dynamic Persona Salutation (SM-06)', () => {
    it('commandService getResetConfirmationReply uses tenant/customer salutation', () => {
      const replyBunda = commandService.getResetConfirmReply('Bunda');
      expect(replyBunda).toContain('Bunda,');

      const replyMom = commandService.getResetConfirmReply('Mom');
      expect(replyMom).toContain('Mom,');
      expect(replyMom).not.toContain('Bunda,');
    });
  });

  describe('4. Canonical isCommandText seam (SM-08)', () => {
    it('commandService.isCommandText is the single authority across command and burst-coalesce', () => {
      expect(commandService.isCommandText('/reset')).toBe(true);
      expect(commandService.isCommandText('/batal')).toBe(true);
      expect(commandService.isCommandText('halo bidan')).toBe(false);
      expect(commandService.isCommandText('/123')).toBe(false);
    });
  });
});
