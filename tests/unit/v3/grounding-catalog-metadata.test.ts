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
    // Tahan rebrand Kala: nama cart WAJIB dari katalog via ID kanonis agar lookup metadata cocok.
    const svc0 = treatmentCatalogService.getServiceById('baby-massage-pulih-ceria') as any;
    const text = GoalTracker.formatGoalSessionForPrompt({
      genderGreeting: 'Bunda',
      targetAudience: 'BABY',
      children: [{ roleLabel: 'Si Kecil', ageMonths: 16, symptoms: ['pilek'] }],
      childProfile: { ageMonths: 16, symptoms: ['pilek'] },
      cartItems: [
        { name: svc0.name, price: svc0.originalPrice, promoPrice: svc0.promoPrice, type: 'PRIMARY', recipientScope: 'CHILD_1' },
      ],
    } as any);
    expect(text).toContain(`Durasi Resmi: ${svc0.durationMinutes} menit`);
    // Nilai rentang usia WAJIB berasal dari DB (bukan hardcode test) — ambil
    // langsung dari katalog aktif agar test tetap valid bila admin mengubahnya.
    const svc = treatmentCatalogService.getServiceById('baby-massage-pulih-ceria') as any;
    expect(svc?.ageTier?.label).toBeTruthy();
    expect(text).toContain(`Batasan Usia: ${svc.ageTier.label}`);
  });

  it('durasi & usia diambil per-item (bukan hafalan) — Kids tier punya labelnya sendiri', () => {
    // Durasi/usia 100% dari DB (rebrand 45→40 menit ikut tercakup otomatis).
    const svc0 = treatmentCatalogService.getServiceById('kids-pulih-2-4th') as any;
    const text = GoalTracker.formatGoalSessionForPrompt({
      genderGreeting: 'Bunda',
      targetAudience: 'KIDS',
      cartItems: [
        { name: svc0.name, price: svc0.originalPrice, promoPrice: svc0.promoPrice, type: 'PRIMARY', recipientScope: 'CHILD_1' },
      ],
    } as any);
    expect(text).toContain(`Durasi Resmi: ${svc0.durationMinutes} menit`);
    expect(text).toContain(`Batasan Usia: ${svc0.ageTier.label}`);
  });
});
