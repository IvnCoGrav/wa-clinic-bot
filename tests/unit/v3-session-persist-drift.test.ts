import { describe, it, expect, vi, afterEach } from 'vitest';
import { GoalTracker } from '../../src/v3/state/goal-tracker';
import { prisma } from '../../src/db/client';

/**
 * Audit #199 / P0-2 — Round-trip sesi WAJIB lestari 3 field episodik:
 * discussedTreatments, isMultiChildUnconfirmed, feverContraindication.
 * Sebelumnya getGoalSession() membuang ketiganya → amnesia lintas-reload DB.
 */
describe('GoalTracker — round-trip lestari field episodik (anti-amnesia)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const CONV_ID = 'conv-persist-1';

  function mockConversation(sessionData: any) {
    vi.mocked(prisma.conversation.findFirst).mockResolvedValue({
      id: CONV_ID,
      tenant_id: 'default-tenant',
      customer_id: 'cust-1',
      session_data: sessionData,
      customer: { preferences: {}, kelurahan: null, kecamatan: null, kota: null, distance_km: null, ongkir: null, is_out_of_coverage: false, name: null },
    } as any);
    vi.mocked(prisma.customer.findFirst).mockResolvedValue({ preferences: {} } as any);
    vi.mocked(prisma.conversation.updateMany).mockResolvedValue({ count: 1 } as any);
    vi.mocked(prisma.customer.updateMany).mockResolvedValue({ count: 1 } as any);
  }

  it('getGoalSession memulihkan discussedTreatments + isMultiChildUnconfirmed + feverContraindication', async () => {
    mockConversation({
      genderGreeting: 'Bunda',
      location: { kelurahan: 'Sedati', kecamatan: 'Sedati', kota: 'Kabupaten Sidoarjo' },
      cartItems: [{ name: 'Pijat Bayi Ceria', price: 60000, type: 'PRIMARY' }],
      discussedTreatments: ['Pijat Lahap Juara'],
      isMultiChildUnconfirmed: true,
      feverContraindication: true,
    });

    const s = await GoalTracker.getGoalSession(CONV_ID, 'default-tenant');
    expect(s.discussedTreatments).toEqual(['Pijat Lahap Juara']);
    expect(s.isMultiChildUnconfirmed).toBe(true);
    expect(s.feverContraindication).toBe(true);
  });

  it('updateGoalSession parsial (update lokasi) TIDAK menghapus 3 field episodik', async () => {
    mockConversation({
      genderGreeting: 'Bunda',
      location: { kelurahan: 'Sedati', kecamatan: 'Sedati' },
      cartItems: [{ name: 'Pijat Bayi Ceria', price: 60000, type: 'PRIMARY' }],
      discussedTreatments: ['Pijat Lahap Juara'],
      isMultiChildUnconfirmed: true,
      feverContraindication: true,
    });

    const merged = await GoalTracker.updateGoalSession(
      CONV_ID,
      { location: { kelurahan: 'Rungkut', kecamatan: 'Rungkut' } },
      'default-tenant'
    );

    expect(merged.discussedTreatments).toEqual(['Pijat Lahap Juara']);
    expect(merged.isMultiChildUnconfirmed).toBe(true);
    expect(merged.feverContraindication).toBe(true);
    expect(merged.location?.kelurahan).toBe('Rungkut');
  });
});
