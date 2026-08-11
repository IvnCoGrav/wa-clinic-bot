import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConversationState } from '@prisma/client';
import { buildApp } from '../../src/app';
import { stateMachine } from '../../src/state-machine/machine';
import { conversationService } from '../../src/services/conversation.service';
import { customerService } from '../../src/services/customer.service';
import { wahaClient } from '../../src/integrations/waha/client';
import { prisma } from '../../src/db/client';
import { memoryReservations } from '../../src/routes/admin.route';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { seedAiScopeAll } from '../helpers/seed-ai-scope';

/**
 * WhatsApp Label Lifecycle (Task 3/4/5) — test unit.
 * Cover: 'new customer', 'pending payment', 'repeat', 'legacy' tidak pernah dihapus,
 * failure-toleran label, & flag off.
 */

const RESERVATION_FORM = `Berikut list untuk reservasi :
Hari dan tanggal : Sabtu/1-8-2026
Nama Bunda: Bunda Sari
Alamat & Shareloc : Jl. Melati No. 1
Kec : Waru
Kota : Sidoarjo
No. Hp : 081234567812
Pilihan treatment (Baby & Kids)
Nama Bayi : Zayn
Usia Bayi/Anak : 6 bulan
Treatment : Pijat Bayi Ceria`;

function buildReservationObject(overrides: any = {}) {
  return {
    id: `res_test_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    tenant_id: DEFAULT_TENANT_ID,
    customer_id: 'cust-test',
    treatment_category: 'BABY',
    treatment_detail: 'Baby: Pijat Bayi Ceria',
    booking_date: null,
    raw_text: RESERVATION_FORM,
    status: 'pending',
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

async function setupInterestConversation(phone: string, name: string) {
  const customer = await customerService.getOrCreateCustomer(phone, name, DEFAULT_TENANT_ID);
  const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
  await conversationService.updateConversationState(
    conversation.id,
    { currentState: ConversationState.AWAITING_INTEREST, isHumanHandling: false, previousState: null },
    DEFAULT_TENANT_ID
  );
  return { customer, conversation };
}

describe('WhatsApp Label Lifecycle', () => {
  beforeEach(async () => {
    process.env.ENABLE_LIFECYCLE_LABELS = 'true';
    process.env.HUMANIZER_ENABLED = 'false';
    // Buat reservation.create resolve (DB offline di setup mock; kita override di path happy).
    vi.mocked(prisma.reservation.create).mockResolvedValue(buildReservationObject() as any);
    // prisma.reservation.count tidak ada di mock setup — tambahkan default 0 (tanpa mengubah setup.ts).
    (prisma.reservation as any).count = vi.fn().mockResolvedValue(0);
    await seedAiScopeAll();
  });

  it('1. Customer baru (bukan legacy) via webhook → addLabel("new customer") dipanggil', async () => {
    process.env.ADMIN_API_KEY = 'test_admin_key_123';
    process.env.ENABLE_LEGACY_LABEL_SCRAPE_TRIGGER = 'false';
    const addLabelSpy = vi.spyOn(wahaClient, 'addLabel');

    const phone = `628991${Date.now()}`;
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: {
        event: 'message',
        session: 'default',
        payload: {
          id: `msg_nc_${Date.now()}`,
          from: `${phone}@c.us`,
          fromMe: false,
          timestamp: Math.floor(Date.now() / 1000),
          body: 'halo bunda',
        },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(addLabelSpy).toHaveBeenCalledWith(`${phone}@c.us`, 'new customer');
  });

  it('2. Form reservasi pertama masuk → batchUpdateLabels(add: pending payment, remove: new customer)', async () => {
    vi.mocked(prisma.reservation.count as any).mockResolvedValueOnce(0);
    const batchSpy = vi.spyOn(wahaClient, 'batchUpdateLabels');

    const { customer } = await setupInterestConversation(`6289921${Date.now()}`, 'Bunda NC');
    const res = await stateMachine.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer,
      conversation: await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID),
      incomingMessage: {
        id: `msg_form1_${Date.now()}`,
        from: customer.phone,
        timestamp: '1700000000',
        type: 'text',
        text: { body: RESERVATION_FORM },
      },
    });

    expect(res.nextState).toBe(ConversationState.HUMAN_HANDLING);
    expect(batchSpy).toHaveBeenCalledWith(`${customer.phone}@c.us`, {
      add: ['pending payment'],
      remove: ['new customer'],
    });
    expect(batchSpy).not.toHaveBeenCalledWith(`${customer.phone}@c.us`, expect.objectContaining({ add: ['repeat'] }));
  });

  it('3. Customer riwayat confirmed ≥1 kirim form baru → batchUpdateLabels(add: repeat, remove: new customer + pending payment)', async () => {
    vi.mocked(prisma.reservation.count as any).mockResolvedValueOnce(1);
    const batchSpy = vi.spyOn(wahaClient, 'batchUpdateLabels');

    const { customer } = await setupInterestConversation(`6289931${Date.now()}`, 'Bunda Repeat');
    const res = await stateMachine.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer,
      conversation: await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID),
      incomingMessage: {
        id: `msg_form2_${Date.now()}`,
        from: customer.phone,
        timestamp: '1700000000',
        type: 'text',
        text: { body: RESERVATION_FORM },
      },
    });

    expect(res.nextState).toBe(ConversationState.HUMAN_HANDLING);
    expect(batchSpy).toHaveBeenCalledWith(`${customer.phone}@c.us`, {
      add: ['repeat'],
      remove: ['new customer', 'pending payment'],
    });
    expect(batchSpy).not.toHaveBeenCalledWith(`${customer.phone}@c.us`, expect.objectContaining({ add: ['pending payment'] }));
  });

  it('4. Admin klik "Tandai Lunas" (PATCH confirm) → removeLabel("pending payment") + status confirmed', async () => {
    process.env.ADMIN_API_KEY = 'test_admin_key_123';
    process.env.ENABLE_LEGACY_LABEL_SCRAPE_TRIGGER = 'false';
    const phone = `628994${Date.now()}`;
    const mockRes = {
      id: `res_confirm_${Date.now()}`,
      tenant_id: DEFAULT_TENANT_ID,
      customer_id: 'cust-confirm',
      status: 'pending',
      google_calendar_event_id: null,
      customer: { phone, name: 'Bunda Confirm' },
    };
    memoryReservations.set(mockRes.id, mockRes);
    const removeLabelSpy = vi.spyOn(wahaClient, 'removeLabel');

    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/reservation/${mockRes.id}/confirm`,
      headers: { 'x-api-key': process.env.ADMIN_API_KEY },
    });

    expect(res.statusCode).toBe(200);
    expect(mockRes.status).toBe('confirmed');
    // Memory fallback mengeksekusi removeLabel 'pending payment'
    expect(removeLabelSpy).toHaveBeenCalledWith(`${phone}@c.us`, 'pending payment');
  });

  it('5. Customer berlabel "legacy" mengisi form → label lifecycle jalan, "legacy" TIDAK pernah di-remove', async () => {
    vi.mocked(prisma.reservation.count as any).mockResolvedValueOnce(0);
    const batchSpy = vi.spyOn(wahaClient, 'batchUpdateLabels');

    const { customer } = await setupInterestConversation(`6289951${Date.now()}`, 'Bunda Legacy');
    // Tandai sebagai legacy source + beri label 'legacy' di WA
    wahaClient.mockLabels.set(`${customer.phone}@c.us`, ['legacy']);

    const res = await stateMachine.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer,
      conversation: await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID),
      incomingMessage: {
        id: `msg_form3_${Date.now()}`,
        from: customer.phone,
        timestamp: '1700000000',
        type: 'text',
        text: { body: RESERVATION_FORM },
      },
    });

    expect(res.nextState).toBe(ConversationState.HUMAN_HANDLING);
    // new customer tetap dihapus, pending payment ditambahkan sesuai riwayat
    expect(batchSpy).toHaveBeenCalledWith(`${customer.phone}@c.us`, {
      add: ['pending payment'],
      remove: ['new customer'],
    });
    // legacy tidak boleh muncul di daftar remove manapun
    for (const call of batchSpy.mock.calls) {
      expect(call[1].remove).not.toContain('legacy');
    }
  });

  it('6. batchUpdateLabels gagal (mock error) → operasi inti reservasi tetap sukses', async () => {
    vi.mocked(prisma.reservation.count as any).mockResolvedValueOnce(0);
    vi.spyOn(wahaClient, 'batchUpdateLabels').mockRejectedValue(new Error('WAHA timeout'));

    const { customer } = await setupInterestConversation(`6289961${Date.now()}`, 'Bunda Resilient');
    const res = await stateMachine.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer,
      conversation: await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID),
      incomingMessage: {
        id: `msg_form4_${Date.now()}`,
        from: customer.phone,
        timestamp: '1700000000',
        type: 'text',
        text: { body: RESERVATION_FORM },
      },
    });

    // Kegagalan label tidak menggagalkan flow → tetap eskalasi ke human handling
    expect(res.nextState).toBe(ConversationState.HUMAN_HANDLING);
    expect(res.isHumanHandling).toBe(true);
  });

  it('7. Flag ENABLE_LIFECYCLE_LABELS=false → tidak ada batchUpdateLabels lifecycle', async () => {
    process.env.ENABLE_LIFECYCLE_LABELS = 'false';
    const batchSpy = vi.spyOn(wahaClient, 'batchUpdateLabels');

    const { customer } = await setupInterestConversation(`6289971${Date.now()}`, 'Bunda NoFlag');
    const res = await stateMachine.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer,
      conversation: await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID),
      incomingMessage: {
        id: `msg_form5_${Date.now()}`,
        from: customer.phone,
        timestamp: '1700000000',
        type: 'text',
        text: { body: RESERVATION_FORM },
      },
    });

    expect(res.nextState).toBe(ConversationState.HUMAN_HANDLING);
    expect(batchSpy).not.toHaveBeenCalled();
  });

  it('8. resolvePrimaryJid menormalisasi JID @lid dan nomor polos ke format @c.us untuk API label', async () => {
    vi.spyOn(wahaClient, 'getPhoneNumberFromLid').mockImplementation(async (lid: string) => {
      if (lid.includes('7990399')) return '6285794210526';
      return lid.replace(/@.*$/, '');
    });

    const c1 = await wahaClient.resolvePrimaryJid('79903991054369@lid');
    expect(c1).toBe('6285794210526@c.us');

    const c2 = await wahaClient.resolvePrimaryJid('628123456789@c.us');
    expect(c2).toBe('628123456789@c.us');

    const c3 = await wahaClient.resolvePrimaryJid('628123456789');
    expect(c3).toBe('628123456789@c.us');

    const c4 = await wahaClient.resolvePrimaryJid('123456789@g.us');
    expect(c4).toBe('123456789@g.us');
  });
});