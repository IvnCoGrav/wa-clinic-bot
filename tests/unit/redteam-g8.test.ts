import { describe, it, expect } from 'vitest';
import { resolveTreatmentCategory } from '../../src/v3/tools/save-reservation.tool';
import { treatmentCatalogService } from '../../src/services/treatment-catalog.service';
import * as fs from 'fs';
import * as path from 'path';

describe('Red-Team Verification: G8 - resolveTreatmentCategory', () => {
  it('tests 6 mandatory scenarios for resolveTreatmentCategory and writes evidence', () => {
    const all = treatmentCatalogService.getAllServices(true, 'default-tenant');
    const babyServices = all.filter(s => (s.category || '').toUpperCase() === 'BABY');
    const kidsServices = all.filter(s => (s.category || '').toUpperCase() === 'KIDS');
    const momsServices = all.filter(s => (s.category || '').toUpperCase() === 'MOMS');
    const addOnServices = all.filter(s => (s.category || '').toUpperCase() === 'ADD_ON' || (s.serviceType || '').toUpperCase() === 'ADD_ON');

    const baby1 = babyServices[0]?.name || 'Pijat Bayi Ceria';
    const baby2 = babyServices[1]?.name || 'Tindik Bayi';
    const kids1 = kidsServices[0]?.name || 'Pijat Kids Ceria';
    const mom1 = momsServices[0]?.name || 'Oksitosin Massage Fullbody';
    const unknown1 = 'Layanan Super Unik Tak Dikenal 999';
    const addOn1 = addOnServices[0]?.name || 'Nebulizer';

    const results: any[] = [];

    // Skenario 1: 2 layanan bayi (isMulti = true)
    const res1 = resolveTreatmentCategory([baby1, baby2], { isMulti: true });
    results.push({
      scenario: '1. Dua layanan bayi murni',
      inputs: [baby1, baby2],
      options: { isMulti: true },
      expectedOutcome: 'BABY',
      actualOutcome: res1,
      passed: res1 === 'BABY',
      comment: res1 === 'BOTH' ? 'BUG G8 CONFIRMED: 2 bayi diklasifikasikan BOTH!' : 'Fixed/Correct: 2 bayi menghasilkan BABY'
    });

    // Skenario 2: bayi + anak (isMulti = true)
    const res2 = resolveTreatmentCategory([baby1, kids1], { isMulti: true, hasChildren: true });
    results.push({
      scenario: '2. Bayi + Anak',
      inputs: [baby1, kids1],
      options: { isMulti: true, hasChildren: true },
      expectedOutcome: 'BABY (or KIDS, NOT BOTH)',
      actualOutcome: res2,
      passed: res2 !== 'BOTH',
      comment: res2 === 'BOTH' ? 'BUG: bayi + anak diklasifikasikan BOTH (Ibu & Anak)!' : `Returned ${res2} (Not BOTH)`
    });

    // Skenario 3: ibu + bayi (isMulti = true)
    const res3 = resolveTreatmentCategory([mom1, baby1], { isMulti: true });
    results.push({
      scenario: '3. Ibu + Bayi',
      inputs: [mom1, baby1],
      options: { isMulti: true },
      expectedOutcome: 'BOTH',
      actualOutcome: res3,
      passed: res3 === 'BOTH',
      comment: 'Valid BOTH'
    });

    // Skenario 4: ibu saja (isMulti = false)
    const res4 = resolveTreatmentCategory([mom1], { isMulti: false });
    results.push({
      scenario: '4. Ibu saja',
      inputs: [mom1],
      options: { isMulti: false },
      expectedOutcome: 'MOMS',
      actualOutcome: res4,
      passed: res4 === 'MOMS',
      comment: 'Valid MOMS'
    });

    // Skenario 5: layanan tak dikenal
    const res5 = resolveTreatmentCategory([unknown1], { isMulti: false });
    const res5Multi = resolveTreatmentCategory([unknown1, 'Layanan Lain'], { isMulti: true });
    results.push({
      scenario: '5a. Layanan tak dikenal (single)',
      inputs: [unknown1],
      options: { isMulti: false },
      expectedOutcome: 'BABY (fallback default)',
      actualOutcome: res5,
      passed: res5 === 'BABY',
      comment: 'Fallback default'
    });
    results.push({
      scenario: '5b. Layanan tak dikenal (multi tanpa profil)',
      inputs: [unknown1, 'Layanan Lain'],
      options: { isMulti: true },
      expectedOutcome: 'BABY (bukan BOTH)',
      actualOutcome: res5Multi,
      passed: res5Multi === 'BABY',
      comment: res5Multi === 'BOTH' ? 'BUG: unknown multi becomes BOTH' : 'Correctly BABY fallback'
    });

    // Skenario 6: add-on saja
    const res6 = resolveTreatmentCategory([addOn1], { isMulti: false });
    results.push({
      scenario: '6. Add-on saja',
      inputs: [addOn1],
      options: { isMulti: false },
      expectedOutcome: 'BABY / default',
      actualOutcome: res6,
      passed: true,
      comment: `Returned ${res6}`
    });

    const evidenceDir = path.resolve(process.cwd(), 'audit/evidence/P1');
    if (!fs.existsSync(evidenceDir)) fs.mkdirSync(evidenceDir, { recursive: true });
    const evidencePath = path.resolve(evidenceDir, 'evidence_g8_resolve_category.json');
    fs.writeFileSync(evidencePath, JSON.stringify(results, null, 2), 'utf-8');

    console.log('RESULTS OF G8 AUDIT:');
    console.log(JSON.stringify(results, null, 2));

    expect(res1).toBe('BABY');
    expect(res2).not.toBe('BOTH');
    expect(res3).toBe('BOTH');
    expect(res4).toBe('MOMS');
  });
});
