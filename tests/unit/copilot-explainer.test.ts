import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  customerFindMany: vi.fn(),
}));

vi.mock('../../src/db/client', () => ({
  prisma: {
    customer: { findMany: h.customerFindMany },
  },
}));

import { explainConversationState, buildConversationExplanation } from '../../src/services/copilot/copilot-tools';

/**
 * Pilar 3 (Explainability): explain_conversation_state.
 * Deterministik dari state DB — bukan pencocokan kalimat. Adversarial multi-status,
 * IDOR lintas-tenant, masking HP, saringan dummy.
 */

function customerFixture(overrides: any = {}) {
  return {
    id: 'cust-1',
    name: 'Bunda Dara',
    phone: '628111222333',
    conversations: [
      {
        id: 'conv-1',
        current_state: 'HUMAN_HANDLING',
        previous_state: 'AWAITING_INTEREST',
        is_human_handling: true,
        human_handling_since: new Date('2026-10-01T10:00:00Z'),
        escalation_reason: 'medical_query',
        last_message_at: new Date('2026-10-01T10:05:00Z'),
        session_data: { cartItems: [{ name: 'Baby Massage' }], pendingLocation: 'Waru', booking: { preferredDate: '2026-10-05' } },
        last_discussed_treatment: 'Baby Massage',
        messages: [
          { direction: 'INBOUND', sender_type: 'CUSTOMER', content: 'anak saya demam', created_at: new Date('2026-10-01T10:05:00Z') },
          { direction: 'OUTBOUND', sender_type: 'BOT', content: 'Baik Bunda', created_at: new Date('2026-10-01T10:04:00Z') },
        ],
      },
    ],
    ...overrides,
  };
}

describe('buildConversationExplanation — status deterministik', () => {
  it('is_human_handling=true → DIAMBIL_ALIH_MANUSIA dengan alasan & waktu', () => {
    const row = buildConversationExplanation(customerFixture(), customerFixture().conversations[0]);
    expect(row.statusBot).toBe('DIAMBIL_ALIH_MANUSIA');
    expect(row.isHumanHandling).toBe(true);
    expect(row.escalationReason).toBe('medical_query');
    expect(row.currentState).toBe('HUMAN_HANDLING');
    expect(row.cartItemCount).toBe(1);
    expect(row.pendingLocation).toBe('Waru');
    expect(row.lastMessages).toHaveLength(2);
  });

  it('current_state COMPLETED tanpa human handling → SELESAI', () => {
    const conv = { ...customerFixture().conversations[0], is_human_handling: false, current_state: 'COMPLETED', escalation_reason: null };
    expect(buildConversationExplanation(customerFixture(), conv).statusBot).toBe('SELESAI');
  });

  it('state normal → BOT_AKTIF', () => {
    const conv = { ...customerFixture().conversations[0], is_human_handling: false, current_state: 'AWAITING_INTEREST', escalation_reason: null };
    expect(buildConversationExplanation(customerFixture(), conv).statusBot).toBe('BOT_AKTIF');
  });

  it('nomor HP selalu disamarkan', () => {
    const row = buildConversationExplanation(customerFixture(), customerFixture().conversations[0]);
    expect(row.phone).toBe('6281****333');
    expect(row.phone).not.toContain('11222333');
  });

  it('tidak membocorkan field `metadata` fiktif / tidak ada', () => {
    const row = buildConversationExplanation(customerFixture(), customerFixture().conversations[0]);
    expect(row).not.toHaveProperty('metadata');
    expect(row).not.toHaveProperty('medicalAlert');
  });
});

describe('explainConversationState.run — tenant scope & saringan', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    h.customerFindMany.mockResolvedValue([]);
  });

  it('tanpa phone & nama → note, tanpa query DB', async () => {
    const res = await explainConversationState.run('default-tenant', {});
    expect(res.count).toBe(0);
    expect(res.note).toBeTruthy();
    expect(h.customerFindMany).not.toHaveBeenCalled();
  });

  it('query SELALU tenant-scoped + buang sandbox (anti-IDOR)', async () => {
    h.customerFindMany.mockResolvedValue([customerFixture()]);
    await explainConversationState.run('tenant-x', { phone: '0812' });
    const arg = h.customerFindMany.mock.calls[0][0];
    expect(arg.where.tenant_id).toBe('tenant-x');
    expect(arg.where.is_sandbox_test).toBe(false);
    expect(arg.where.phone).toEqual({ contains: '0812' });
    // 5 pesan terakhir + kolom riil.
    expect(arg.select.conversations.select.messages.take).toBe(5);
    expect(arg.select.conversations.select.is_human_handling).toBe(true);
    expect(arg.select.conversations.select.escalation_reason).toBe(true);
  });

  it('customer dummy/test disaring keluar', async () => {
    h.customerFindMany.mockResolvedValue([customerFixture({ phone: 'cust_test_999', name: 'Test User' })]);
    const res = await explainConversationState.run('default-tenant', { customerName: 'Test' });
    expect(res.count).toBe(0);
  });

  it('customer tanpa percakapan → tetap dijelaskan sebagai BELUM_ADA_PERCAKAPAN', async () => {
    h.customerFindMany.mockResolvedValue([customerFixture({ conversations: [] })]);
    const res = await explainConversationState.run('default-tenant', { phone: '0812' });
    expect(res.count).toBe(1);
    expect(res.rows[0].statusBot).toBe('BELUM_ADA_PERCAKAPAN');
  });

  it('nama dicocokkan case-insensitive (contains)', async () => {
    h.customerFindMany.mockResolvedValue([customerFixture()]);
    await explainConversationState.run('default-tenant', { customerName: 'dara' });
    const arg = h.customerFindMany.mock.calls[0][0];
    expect(arg.where.name).toEqual({ contains: 'dara', mode: 'insensitive' });
  });
});
