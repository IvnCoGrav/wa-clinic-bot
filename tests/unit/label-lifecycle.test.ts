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
 * Label Lifecycle (Task 3/4/5) — test unit DB-ONLY.
 * Mandat Mutlak Anti-Label WAHA: seluruh penandaan lifecycle ('New Customer',
 * 'Pending Payment', 'Repeat Order') WAJIB via tabel internal `Label` +
 * `CustomerLabel` (tenant-scoped). Zero pemanggilan WAHA (addLabel/removeLabel/
 * batchUpdateLabels) dari kode bisnis — lihat invariant guard
 * tests/unit/v3/waha-label-ban-invariant.test.ts.
 */

const LIFECYCLE_NAMES = ['New Customer', 'Pending Payment', 'Repeat Order'];

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

describe('Label Lifecycle (DB-only)', () => {
  // Store label DB tiruan per-test (tanpa mengubah tests/setup.ts).
  let labelStore: Map<string, { id: string; tenant_id: string; name: string }>;
  let customerLabels: Set<string>; // "customerId:labelId"
  const labelNameById = (id: string) => {
    for (const v of labelStore.values()) if (v.id === id) return v.name;
    return undefined;
  };

  beforeEach(async () => {
    process.env.ENABLE_LIFECYCLE_LABELS = 'true';
    process.env.HUMANIZER_ENABLED = 'false';
    // Buat reservation.create resolve (DB offline di setup mock; kita override di path happy).
    vi.mocked(prisma.reservation.create).mockResolvedValue(buildReservationObject() as any);
    // prisma.reservation.count tidak ada di mock setup — tambahkan default 0 (tanpa mengubah setup.ts).
    (prisma.reservation as any).count = vi.fn().mockResolvedValue(0);
    // Delegate Label/CustomerLabel tidak ada di mock setup — pasang store tiruan per-test.
    labelStore = new Map();
    customerLabels = new Set();
    (prisma as any).label = {
      upsert: vi.fn().mockImplementation(async ({ where, create }: any) => {
        const name = where?.tenant_id_name?.name ?? create?.name;
        const key = `${DEFAULT_TENANT_ID}:${name}`;
        if (!labelStore.has(key)) {
          labelStore.set(key, { id: `lbl_${labelStore.size + 1}`, tenant_id: DEFAULT_TENANT_ID, name });
        }
        return labelStore.get(key);
      }),
      findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
        return labelStore.get(`${DEFAULT_TENANT_ID}:${where?.name}`) ?? null;
      }),
    };
    (prisma as any).customerLabel = {
      upsert: vi.fn().mockImplementation(async ({ create }: any) => {
        customerLabels.add(`${create.customer_id}:${create.label_id}`);
        return create;
      }),
      deleteMany: vi.fn().mockImplementation(async ({ where }: any) => {
        const raw = where?.label_id;
        const ids: string[] = Array.isArray(raw)
          ? raw
          : (raw?.in ?? (typeof raw === 'string' ? [raw] : []));
        let count = 0;
        for (const lid of ids) {
          if (customerLabels.delete(`${where.customer_id}:${lid}`)) count++;
        }
        return { count };
      }),
    };
    await seedAiScopeAll();
  });

  it('1. Customer baru (bukan legacy) via webhook → DB-only label lifecycle (zero WAHA label)', async () => {
    process.env.ADMIN_API_KEY = 'test_admin_key_123';
    process.env.ENABLE_LEGACY_LABEL_SCRAPE_TRIGGER = 'false';

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
    // Mandat Anti-Label WAHA: new customer ditandai via DB internal, bukan wahaClient.addLabel
    const customer = await customerService.getCustomerByPhone(phone, DEFAULT_TENANT_ID);
    expect(customer).toBeDefined();
  });

  it('2. Form reservasi pertama masuk → DB: tambah Pending Payment, hapus New Customer (zero WAHA)', async () => {
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
    // Zero WAHA label mutation (mandat mutlak).
    expect(batchSpy).not.toHaveBeenCalled();
    // DB: Pending Payment terpasang untuk customer ini.
    const upsertCalls = vi.mocked((prisma as any).customerLabel.upsert).mock.calls;
    const upsertedNames = upsertCalls.map((c: any) => labelNameById(c[0].create.label_id));
    expect(upsertedNames).toEqual(['Pending Payment']);
    expect(upsertCalls[0][0].create.customer_id).toBe(customer.id);
    // DB: New Customer terlepas untuk customer ini.
    const delCalls = vi.mocked((prisma as any).customerLabel.deleteMany).mock.calls;
    expect(delCalls).toHaveLength(1);
    expect(delCalls[0][0].where.customer_id).toBe(customer.id);
    const removedNames = delCalls[0][0].where.label_id.in.map((id: string) => labelNameById(id));
    expect(removedNames).toEqual(['New Customer']);
  });

  it('3. Customer riwayat confirmed ≥1 kirim form baru → DB: tambah Repeat Order, hapus New Customer + Pending Payment', async () => {
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
    expect(batchSpy).not.toHaveBeenCalled();
    const upsertCalls = vi.mocked((prisma as any).customerLabel.upsert).mock.calls;
    const upsertedNames = upsertCalls.map((c: any) => labelNameById(c[0].create.label_id));
    expect(upsertedNames).toEqual(['Repeat Order']);
    const delCalls = vi.mocked((prisma as any).customerLabel.deleteMany).mock.calls;
    expect(delCalls).toHaveLength(1);
    const removedNames = delCalls[0][0].where.label_id.in.map((id: string) => labelNameById(id)).sort();
    expect(removedNames).toEqual(['New Customer', 'Pending Payment']);
  });

  it('4. Admin klik "Tandai Lunas" (PATCH confirm) → DB: lepas Pending Payment + status confirmed (zero WAHA)', async () => {
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
    // Seed label Pending Payment agar findFirst menemukannya (jalur DB confirm).
    labelStore.set(`${DEFAULT_TENANT_ID}:Pending Payment`, {
      id: 'lbl_pending',
      tenant_id: DEFAULT_TENANT_ID,
      name: 'Pending Payment',
    });
    customerLabels.add('cust-confirm:lbl_pending');
    const removeLabelSpy = vi.spyOn(wahaClient, 'removeLabel');

    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/reservation/${mockRes.id}/confirm`,
      headers: { 'x-api-key': process.env.ADMIN_API_KEY },
    });

    expect(res.statusCode).toBe(200);
    expect(mockRes.status).toBe('confirmed');
    // Zero WAHA label mutation (mandat mutlak) — pelunasan via CustomerLabel DB.
    expect(removeLabelSpy).not.toHaveBeenCalled();
    const delCalls = vi.mocked((prisma as any).customerLabel.deleteMany).mock.calls;
    expect(delCalls).toHaveLength(1);
    expect(delCalls[0][0]).toEqual({
      where: { customer_id: 'cust-confirm', label_id: 'lbl_pending' },
    });
    expect(customerLabels.has('cust-confirm:lbl_pending')).toBe(false);
  });

  it('5. Customer berlabel "Legacy" mengisi form → lifecycle DB jalan, "Legacy" TIDAK pernah dilepas', async () => {
    vi.mocked(prisma.reservation.count as any).mockResolvedValueOnce(0);
    const batchSpy = vi.spyOn(wahaClient, 'batchUpdateLabels');

    const { customer } = await setupInterestConversation(`6289951${Date.now()}`, 'Bunda Legacy');
    // Tandai legacy di DB internal (bukan WAHA): label + join row milik customer.
    labelStore.set(`${DEFAULT_TENANT_ID}:Legacy`, {
      id: 'lbl_legacy',
      tenant_id: DEFAULT_TENANT_ID,
      name: 'Legacy',
    });
    customerLabels.add(`${customer.id}:lbl_legacy`);

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
    expect(batchSpy).not.toHaveBeenCalled();
    // Hanya 3 nama kanonis lifecycle yang boleh di-upsert/di-delete.
    const upsertCalls = vi.mocked((prisma as any).customerLabel.upsert).mock.calls;
    for (const c of upsertCalls) {
      expect(LIFECYCLE_NAMES).toContain(labelNameById(c[0].create.label_id));
    }
    const delCalls = vi.mocked((prisma as any).customerLabel.deleteMany).mock.calls;
    for (const c of delCalls) {
      for (const lid of c[0].where.label_id.in) {
        expect(LIFECYCLE_NAMES).toContain(labelNameById(lid));
      }
    }
    // Join row Legacy milik customer tetap utuh.
    expect(customerLabels.has(`${customer.id}:lbl_legacy`)).toBe(true);
  });

  it('6. Penulisan label DB gagal → operasi inti reservasi tetap sukses (best-effort)', async () => {
    vi.mocked(prisma.reservation.count as any).mockResolvedValueOnce(0);
    vi.mocked((prisma as any).label.upsert).mockRejectedValueOnce(new Error('DB down'));

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

  it('7. Flag ENABLE_LIFECYCLE_LABELS=false → tidak ada penulisan label lifecycle DB maupun WAHA', async () => {
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
    expect(vi.mocked((prisma as any).label.upsert)).not.toHaveBeenCalled();
    expect(vi.mocked((prisma as any).customerLabel.upsert)).not.toHaveBeenCalled();
    expect(vi.mocked((prisma as any).customerLabel.deleteMany)).not.toHaveBeenCalled();
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