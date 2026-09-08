import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoalTracker } from '../../src/v3/state/goal-tracker';
import { treatmentCatalogService } from '../../src/services/treatment-catalog.service';
import { PersonaPromptBuilder } from '../../src/v3/agent/persona';

/**
 * Pre-grounding deterministik: rekomendasi katalog disuntik ke status prompt
 * bahkan bila LLM tidak memanggil tool.
 */
describe('V3 pre-grounding katalog (deterministik, Zero-Code)', () => {
  const baseSession: any = {
    genderGreeting: 'Bunda',
    location: { kelurahan: 'Pradah Kali Kendal', kecamatan: 'Dukuh Pakis', kota: 'Kota Surabaya', distanceKm: 17, rawText: 'Pradah Kali Kendal', ongkirPromo: 20000, ongkirNormal: 25000 },
    ongkirStatus: 'QUOTED',
  };

  it('Skenario 1: "anak saya susah makan" → grounding Lahap Juara', () => {
    const text = GoalTracker.formatGoalSessionForPrompt({
      ...baseSession,
      childProfile: { ageMonths: 6, symptoms: ['susah makan', 'makan'] },
      children: [{ ageMonths: 6, symptoms: ['susah makan', 'makan'], roleLabel: 'Si Kecil' }],
    } as any);
    expect(text).toContain('Lahap Juara');
    expect(text).toContain('MANDAT WAJIB');
  });

  it('Skenario 2: "anak batuk pilek" → grounding Pulih Ceria', () => {
    const text = GoalTracker.formatGoalSessionForPrompt({
      ...baseSession,
      childProfile: { ageMonths: 3, symptoms: ['batuk', 'pilek'] },
      children: [{ ageMonths: 3, symptoms: ['batuk', 'pilek'], roleLabel: 'Si Kecil' }],
    } as any);
    expect(text).toContain('Pulih Ceria');
  });

  it('Skenario 3: layanan kustom Nasal Care (mock) → grounding Nasal Care', () => {
    const nasalCare: any = {
      id: 'mock-nasal-care',
      name: 'Nasal Care',
      category: 'BABY',
      isActive: true,
      durationMinutes: 15,
      originalPrice: 50000,
      promoPrice: 35000,
      description: 'Pembersihan rongga hidung dan terapi uap untuk bayi flu/pilek mampet.',
      ageTier: { minAgeMonths: 0, maxAgeMonths: 12 },
    };
    const spy = vi.spyOn(treatmentCatalogService, 'getAllServices').mockReturnValue([...treatmentCatalogService.getAllServices(true), nasalCare]);
    try {
      const text = GoalTracker.formatGoalSessionForPrompt({
        ...baseSession,
        childProfile: { ageMonths: 2, symptoms: ['cuci hidung'] },
        children: [{ ageMonths: 2, symptoms: ['cuci hidung'], roleLabel: 'Si Kecil' }],
      } as any);
      expect(text).toContain('Nasal Care');
    } finally { spy.mockRestore(); }
  });

  it('Skenario 4: tanpa keluhan "pijat bayi 1 bulan" → grounding paket relaksasi Ceria', () => {
    const text = GoalTracker.formatGoalSessionForPrompt({
      ...baseSession,
      childProfile: undefined,
      children: undefined,
      selectedTreatment: undefined,
    } as any);
    // tanpa keluhan dan tanpa treatment terpilih → fallback paket dasar
    expect(text).toContain('Ceria');
    expect(text).toContain('Bayi Sehat Tanpa Keluhan');
  });

  it('Persona prompt cleanliness: tidak ada hardcode Pulih Ceria sebagai default instruksi', async () => {
    const prompt = PersonaPromptBuilder.buildSystemPrompt({ genderGreeting: 'Bunda' } as any, true);
    // Dilarang instruksi generik "selalu sebut Pulih Ceria" — harus dinamis
    // Munculnya Pulih Ceria hanya boleh di contoh spesifik bapil, bukan di aturan KONDISI A.1
    const a1Idx = prompt.indexOf('KONDISI A.1');
    const a1Slice = prompt.slice(a1Idx, a1Idx + 800);
    expect(a1Slice).not.toContain('Pulih Ceria');
    expect(a1Slice).toContain('Pijat Bayi Ceria (Relaksasi)');
  });
});
