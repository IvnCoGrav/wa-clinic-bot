import { describe, it, expect } from 'vitest';
import { GoalTracker } from '../../../src/v3/state/goal-tracker';
import { treatmentCatalogService } from '../../../src/services/treatment-catalog.service';

/**
 * Sesi 887216: LLM mengarang durasi "30 menit" (padahal katalog 40 menit) dan
 * merekomendasikan paket Kids untuk usia 16 bulan. Akar: grounding keranjang
 * TIDAK menyuntik durasi resmi & batasan usia untuk item tunggal. Fase 2:
 * metadata katalog (durationMinutes + ageTier.label) mengalir dinamis dari DB
 * ke grounding SETIAP item — tanpa hardcode di TypeScript.
 */
describe('Grounding Metadata Katalog Dinamis (sesi 887216)', () => {
  it('item tunggal menampilkan Durasi Resmi & Batasan Usia dari katalog DB', () => {
    const text = GoalTracker.formatGoalSessionForPrompt({
      genderGreeting: 'Bunda',
      targetAudience: 'BABY',
      children: [{ roleLabel: 'Si Kecil', ageMonths: 16, symptoms: ['pilek'] }],
      childProfile: { ageMonths: 16, symptoms: ['pilek'] },
      cartItems: [
        { name: 'Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung)', price: 90000, promoPrice: 75000, type: 'PRIMARY', recipientScope: 'CHILD_1' },
      ],
    } as any);
    expect(text).toContain('Durasi Resmi: 40 menit');
    // Nilai rentang usia WAJIB berasal dari DB (bukan hardcode test) — ambil
    // langsung dari katalog aktif agar test tetap valid bila admin mengubahnya.
    const svc = treatmentCatalogService
      .getAllServices(true)
      .find((s) => s.name === 'Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung)') as any;
    expect(svc?.ageTier?.label).toBeTruthy();
    expect(text).toContain(`Batasan Usia: ${svc.ageTier.label}`);
  });

  it('durasi & usia diambil per-item (bukan hafalan) — Kids tier punya labelnya sendiri', () => {
    const text = GoalTracker.formatGoalSessionForPrompt({
      genderGreeting: 'Bunda',
      targetAudience: 'KIDS',
      cartItems: [
        { name: 'Pijat Kids Pulih Ceria (2 - 4 Tahun)', price: 100000, promoPrice: 85000, type: 'PRIMARY', recipientScope: 'CHILD_1' },
      ],
    } as any);
    expect(text).toContain('Durasi Resmi: 45 menit');
    expect(text).toContain('Batasan Usia: 2 - 4 Tahun');
  });
});
