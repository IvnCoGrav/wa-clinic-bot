import { describe, it, expect } from 'vitest';
import { PatientProfileExtractor } from '../../src/v3/state/patient-extractor';

function symptomsOf(text: string): string[] {
  const session: any = { children: [] };
  const children = PatientProfileExtractor.syncChildrenProfiles(session, text);
  return (children[0]?.symptoms || []) as string[];
}

describe('Fase A — alias gejala kanonis (I3)', () => {
  it('"hidung mampet, bersin-bersin" → pilek (bukan [])', () => {
    const s = symptomsOf('Anak hidung mampet, bersin-bersin terus');
    expect(s).toContain('pilek');
    expect(s).not.toContain('mampet');
  });

  it('"meler" → pilek; "mencret" → diare', () => {
    expect(symptomsOf('Ingusnya meler terus')).toContain('pilek');
    expect(symptomsOf('Anak mencret 3x hari ini')).toContain('diare');
  });

  it('"muntah" tercatat mentah; "sembelit" tetap (sudah CORE)', () => {
    expect(symptomsOf('Si kecil muntah-muntah')).toContain('muntah');
    expect(symptomsOf('Anak sembelit GTM susah makan')).toContain('sembelit');
  });

  it('nama orang murni tak tersentuh alias', () => {
    expect(symptomsOf('Bunda Sari')).toEqual([]);
    expect(symptomsOf('Desy')).toEqual([]);
  });

  it('usia tetap diekstrak dari teks asli (alias tak merusak)', () => {
    const session: any = { children: [] };
    const children = PatientProfileExtractor.syncChildrenProfiles(session, 'Anak 2 tahun hidung mampet');
    expect(children[0]?.ageMonths).toBe(24);
    expect(children[0]?.symptoms).toContain('pilek');
  });
});
