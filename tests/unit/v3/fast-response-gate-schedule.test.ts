import { describe, it, expect } from 'vitest';
import {
  FastResponseGate,
  isShortAcknowledgement,
  resolvePostReservationAck,
  POST_SCHEDULE_CHECK_CLOSING,
} from '../../../src/v3/agent/pipeline/context-grounder';
import { CustomerGoalSession } from '../../../src/v3/state/goal-tracker';
import { ConversationState } from '@prisma/client';

describe('FastResponseGate — Schedule Verification Handoff (Plan 7)', () => {
  it('isShortAcknowledgement: mendeteksi variasi ack dan konfirmasi menunggu', () => {
    expect(isShortAcknowledgement('oke min..')).toBe(true);
    expect(isShortAcknowledgement('baik bunda saya tunggu')).toBe(true);
    expect(isShortAcknowledgement('okey bund, nanti kabari ya')).toBe(true);
    expect(isShortAcknowledgement('siap kak')).toBe(true);
    expect(isShortAcknowledgement('saya tunggu ya')).toBe(true);
    expect(isShortAcknowledgement('kabari ya min')).toBe(true);
    expect(isShortAcknowledgement('👍')).toBe(true);

    // Pertanyaan bukan short ack
    expect(isShortAcknowledgement('jam berapa ya?')).toBe(false);
    expect(isShortAcknowledgement('bisa hari apa saja?')).toBe(false);
  });

  it('resolvePostReservationAck: memicu saat pendingScheduleCheck === true', () => {
    const session: CustomerGoalSession = {
      genderGreeting: 'Bunda',
      booking: {
        isConfirmed: false,
        pendingScheduleCheck: true,
        handoffClosingSent: false,
      },
    };

    expect(resolvePostReservationAck(session, 'oke min..')).toBe('closing');
    
    // Setelah closing terkirim -> silent skip
    session.booking!.handoffClosingSent = true;
    expect(resolvePostReservationAck(session, 'baik bunda saya tunggu')).toBe('silent');
    expect(resolvePostReservationAck(session, 'okey bund, nanti kabari ya')).toBe('silent');
  });

  it('FastResponseGate.check: putaran 1 kirim closing resmi + eskalasi pending_schedule_check', async () => {
    const session: CustomerGoalSession = {
      genderGreeting: 'Bunda',
      booking: {
        isConfirmed: false,
        pendingScheduleCheck: true,
        handoffClosingSent: false,
      },
    };

    const res = await FastResponseGate.check({
      tenantId: 'default-tenant',
      conversationId: 'conv-test-sched-1',
      phone: '628111222333',
      incomingText: 'oke min..',
      cleanIncomingText: 'oke min..',
      skipDbLogging: true,
      isFollowUp: true,
      session,
      currentSystemPrompt: '',
      fewShotExemplars: [],
    });

    expect(res.handled).toBe(true);
    if (res.handled) {
      expect(res.output.shouldSendReply).toBe(true);
      expect(res.output.replyText).toBe(POST_SCHEDULE_CHECK_CLOSING);
      expect(res.output.isEscalated).toBe(true);
      expect(res.output.escalationReason).toBe('pending_schedule_check');
      expect(res.output.nextState).toBe(ConversationState.HUMAN_HANDLING);
      expect(res.session.booking?.handoffClosingSent).toBe(true);
    }
  });

  it('FastResponseGate.check: putaran 2 dan 3 senyap (silent skip, shouldSendReply: false)', async () => {
    const session: CustomerGoalSession = {
      genderGreeting: 'Bunda',
      booking: {
        isConfirmed: false,
        pendingScheduleCheck: true,
        handoffClosingSent: true,
      },
    };

    const res2 = await FastResponseGate.check({
      tenantId: 'default-tenant',
      conversationId: 'conv-test-sched-2',
      phone: '628111222333',
      incomingText: 'baik bunda saya tunggu',
      cleanIncomingText: 'baik bunda saya tunggu',
      skipDbLogging: true,
      isFollowUp: true,
      session,
      currentSystemPrompt: '',
      fewShotExemplars: [],
    });

    expect(res2.handled).toBe(true);
    if (res2.handled) {
      expect(res2.output.shouldSendReply).toBe(false);
      expect(res2.output.replyText).toBe('');
      expect(res2.output.isEscalated).toBe(true);
      expect(res2.output.escalationReason).toBe('pending_schedule_check');
    }

    const res3 = await FastResponseGate.check({
      tenantId: 'default-tenant',
      conversationId: 'conv-test-sched-2',
      phone: '628111222333',
      incomingText: 'okey bund, nanti kabari ya',
      cleanIncomingText: 'okey bund, nanti kabari ya',
      skipDbLogging: true,
      isFollowUp: true,
      session,
      currentSystemPrompt: '',
      fewShotExemplars: [],
    });

    expect(res3.handled).toBe(true);
    if (res3.handled) {
      expect(res3.output.shouldSendReply).toBe(false);
      expect(res3.output.replyText).toBe('');
      expect(res3.output.isEscalated).toBe(true);
    }
  });
});
