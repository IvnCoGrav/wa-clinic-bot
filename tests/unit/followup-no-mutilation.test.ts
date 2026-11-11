import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { getRollingFollowUpMessage } from '../../src/config/followup-templates';

/** CFG-16: tidak ada mutilasi kata pasca-render; brand tenant dipakai. */
describe('Follow-up template tanpa mutilasi (CFG-16)', () => {
  it('render normal tidak menghasilkan "Bunda Bunda" atau spasi ganda', () => {
    const { text } = getRollingFollowUpMessage('NEXT_TREATMENT', {
      name: 'Sari',
      babyName: 'si kecil',
      businessName: 'Klinik Sehat',
      index: 0,
    });
    expect(text).not.toMatch(/Bunda\s+Bunda/i);
    expect(text).not.toMatch(/ {2,}/);
  });

  it('sumber tidak lagi memakai regex mutilasi kata (guard regresi)', () => {
    const files = [
      'src/config/followup-templates.ts',
      'src/services/follow-up-engine.service.ts',
    ];
    for (const f of files) {
      const src = fs.readFileSync(path.join(process.cwd(), f), 'utf8');
      expect(src).not.toContain('.replace(/Bunda\\s+Bunda/gi');
      expect(src).not.toContain('.replace(/dek\\s+dek');
      expect(src).not.toContain('.replace(/dek\\s+si kecil');
    }
  });
});
