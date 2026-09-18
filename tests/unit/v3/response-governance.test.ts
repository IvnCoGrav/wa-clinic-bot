import { describe, it, expect } from 'vitest';

/**
 * Fondasi 4 — Response Governance & Guardrails.
 * Test 3 aspek:
 * 1. Distance opener: ≤5km "Wah dekat ya", >5km neutral "Jika dilihat dari jaraknya..."
 * 2. Visit time solicitation: Negative Constraint 20 — tidak menodong jam kunjungan
 * 3. Semantic day evidence: "besok" di history bypass validasi ISO
 */

// ─── 1. Distance Matrix Openers ───

function distanceOpener(distanceKm: number): string {
  if (distanceKm <= 5) return 'Wah dekat ya Bunda';
  return 'Jika dilihat dari jaraknya';
}

describe('Distance Matrix Openers (Fondasi 4)', () => {
  it('≤5km → "Wah dekat ya"', () => {
    expect(distanceOpener(0)).toContain('Wah dekat');
    expect(distanceOpener(3.5)).toContain('Wah dekat');
    expect(distanceOpener(5)).toContain('Wah dekat');
  });

  it('>5km → netral', () => {
    expect(distanceOpener(6)).toContain('Jika dilihat');
    expect(distanceOpener(23)).toContain('Jika dilihat');
    expect(distanceOpener(100)).toContain('Jika dilihat');
  });

  it('boundary 5.0 → "Wah dekat"', () => {
    expect(distanceOpener(5.0)).toContain('Wah dekat');
  });

  it('boundary 5.01 → netral', () => {
    expect(distanceOpener(5.01)).toContain('Jika dilihat');
  });
});

// ─── 2. Visit Time Solicitation Detector ───

const VISIT_TIME_SOLICITATION_RE = /\b(?:konfirmasi|mau|ingin|minta)\s+jam\s+kunjungan\b/i;
function hasVisitTimeSolicitation(text: string): boolean {
  const lower = (text || '').toLowerCase();
  return VISIT_TIME_SOLICITATION_RE.test(text)
    || lower.includes('jam berapa yang diinginkan')
    || lower.includes('mau pagi/siang/sore');
}

describe('Visit Time Solicitation Detector (Negative Constraint 20)', () => {
  it('mendeteksi pola terlarang', () => {
    expect(hasVisitTimeSolicitation('konfirmasi jam kunjungan ya Bunda')).toBe(true);
    expect(hasVisitTimeSolicitation('mau jam kunjungan berapa')).toBe(true);
    expect(hasVisitTimeSolicitation('ingin jam kunjungan kapan')).toBe(true);
    expect(hasVisitTimeSolicitation('minta jam kunjungan')).toBe(true);
    expect(hasVisitTimeSolicitation('jam berapa yang diinginkan')).toBe(true);
    expect(hasVisitTimeSolicitation('mau pagi/siang/sore')).toBe(true);
  });

  it('bukan todongan jam: pertanyaan hari, harga, atau kalimat normal', () => {
    expect(hasVisitTimeSolicitation('jadwalnya kapan ya Bunda')).toBe(false);
    expect(hasVisitTimeSolicitation('kami bantu jadwalkan di hari apa')).toBe(false);
    expect(hasVisitTimeSolicitation('jam berapa buka kak')).toBe(false);
    expect(hasVisitTimeSolicitation('untuk jam 10 bisa kak')).toBe(false);
    expect(hasVisitTimeSolicitation('')).toBe(false);
  });

  it('case-insensitive', () => {
    expect(hasVisitTimeSolicitation('KONFIRMASI JAM KUNJUNGAN')).toBe(true);
    expect(hasVisitTimeSolicitation('Mau Jam Kunjungan')).toBe(true);
  });
});

// ─── 3. Anti-Amnesia Day Evidence ───

const DAY_EVIDENCE_WORDS = [
  'besok', 'lusa', 'senin', 'selasa', 'rabu', 'kamis',
  'jumat', 'jum\'at', 'sabtu', 'minggu',
];

function hasDayEvidenceInHistory(history: string[]): boolean {
  return DAY_EVIDENCE_WORDS.some((w) =>
    history.some((h) => h.toLowerCase().includes(w))
  );
}

describe('Anti-Amnesia Day Evidence (Fondasi 4)', () => {
  it('"besok" di history → bypass validasi ISO', () => {
    expect(hasDayEvidenceInHistory(['mau besok ya bund'])).toBe(true);
    expect(hasDayEvidenceInHistory(['hai', 'jadwal besok dong'])).toBe(true);
  });

  it('tanpa kata hari → tidak bypass', () => {
    expect(hasDayEvidenceInHistory(['oke ya bund'])).toBe(false);
    expect(hasDayEvidenceInHistory([])).toBe(false);
  });

  it('case-insensitive', () => {
    expect(hasDayEvidenceInHistory(['BESOK ya'])).toBe(true);
    expect(hasDayEvidenceInHistory(['SENIN pagi'])).toBe(true);
  });
});

// ─── 4. Combined: Distance + Day Evidence (SES 446090 regression) ───

describe('Combined Distance + Day Evidence (SES 446090 regression)', () => {
  it('23km + "besok" → netral opener, bukan "Wah dekat"', () => {
    const distance = 23;
    const opener = distanceOpener(distance);
    const dayEvidence = hasDayEvidenceInHistory(['mau besok ya bund']);

    expect(opener).toContain('Jika dilihat');
    expect(opener).not.toContain('Wah dekat');
    expect(dayEvidence).toBe(true); // bypass ISO validation
  });

  it('4km + "besok" → "Wah dekat" + bypass', () => {
    const distance = 4;
    const opener = distanceOpener(distance);
    const dayEvidence = hasDayEvidenceInHistory(['besok dong']);

    expect(opener).toContain('Wah dekat');
    expect(dayEvidence).toBe(true);
  });
});
