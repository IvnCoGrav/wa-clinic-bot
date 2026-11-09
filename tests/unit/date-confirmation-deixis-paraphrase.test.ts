import { describe, it, expect } from 'vitest';
import { hasBookingCommitSignal } from '../../src/utils/date-confirmation';

describe('UTL-06: Date confirmation deixis semantic grammar', () => {
  it('should recognize natural deictic booking commitments without hardcoded verbatim string matching', () => {
    const validCommitments = [
      'mau yang itu',
      'mau yg itu dong',
      'boleh deh yang itu',
      'ambil yg barusan ya',
      'ikut saran bu bidan',
      'sesuai rekomendasi aja',
      'yang barusan aja bund',
      'jadwalkan yg tadi ya',
      'pesan yang itu deh',
      'ambil yang tadi aja',
      'fix yang barusan ya bun',
    ];

    for (const phrase of validCommitments) {
      expect(hasBookingCommitSignal(phrase), `Expected "${phrase}" to be true`).toBe(true);
    }
  });

  it('should reject negated, postponed, procedural, or casual phrases', () => {
    const nonCommitments = [
      'tidak mau yang itu',
      'nggak mau yang tadi',
      'batal yang tadi',
      'jangan yang itu dulu',
      'pikir dulu yang tadi',
      'bagaimana cara bookingnya?',
      'syarat booking apa saja ya?',
      'prosedur booking gimana?',
      'oke makasih info nya',
      'siap nanti saya kabari lagi',
    ];

    for (const phrase of nonCommitments) {
      expect(hasBookingCommitSignal(phrase), `Expected "${phrase}" to be false`).toBe(false);
    }
  });
});
