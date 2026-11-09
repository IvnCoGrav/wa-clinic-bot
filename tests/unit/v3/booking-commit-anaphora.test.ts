import { describe, it, expect } from 'vitest';
import { hasBookingCommitSignal } from '../../../src/utils/date-confirmation';

describe('hasBookingCommitSignal - Anaphora Patterns (F2)', () => {
  it('detects anaphora "yang tadi" with affirmative verbs', () => {
    expect(hasBookingCommitSignal('mau yang tadi')).toBe(true);
    expect(hasBookingCommitSignal('boleh yang tadi')).toBe(true);
    expect(hasBookingCommitSignal('ambil yang tadi')).toBe(true);
    expect(hasBookingCommitSignal('pesan yang tadi')).toBe(true);
    expect(hasBookingCommitSignal('yang tadi aja')).toBe(true);
    expect(hasBookingCommitSignal('yang tadi deh')).toBe(true);
  });

  it('detects anaphora "yang barusan" with affirmative verbs', () => {
    expect(hasBookingCommitSignal('mau yang barusan')).toBe(true);
    expect(hasBookingCommitSignal('boleh yang barusan')).toBe(true);
    expect(hasBookingCommitSignal('ambil yang barusan')).toBe(true);
    expect(hasBookingCommitSignal('pesan yang barusan')).toBe(true);
    expect(hasBookingCommitSignal('yang barusan aja')).toBe(true);
    expect(hasBookingCommitSignal('yang barusan deh')).toBe(true);
  });

  it('detects recommendation-following patterns', () => {
    expect(hasBookingCommitSignal('sesuai rekomendasi')).toBe(true);
    expect(hasBookingCommitSignal('sesuai saran')).toBe(true);
    expect(hasBookingCommitSignal('ikut rekomendasi')).toBe(true);
    expect(hasBookingCommitSignal('ikut saran')).toBe(true);
  });

  it('patterns match even with question mark (guards applied by callers)', () => {
    // hasBookingCommitSignal is a simple pattern matcher; callers check for ? separately
    expect(hasBookingCommitSignal('yang tadi aja?')).toBe(true);
    expect(hasBookingCommitSignal('sesuai rekomendasi?')).toBe(true);
    expect(hasBookingCommitSignal('mau yang tadi?')).toBe(true);
  });

  it('negation words before pattern do not match (DEIXIS_STOP)', () => {
    expect(hasBookingCommitSignal('tidak mau yang tadi')).toBe(false);
    expect(hasBookingCommitSignal('batal yang tadi')).toBe(false);
    expect(hasBookingCommitSignal('jangan yang tadi')).toBe(false);
  });

  it('deferral words after pattern do not match (DEIXIS_STOP)', () => {
    expect(hasBookingCommitSignal('mau yang tadi nanti')).toBe(false);
    expect(hasBookingCommitSignal('pikir dulu yang tadi')).toBe(false);
  });

  it('bare anaphora without particle/verb does not match (consistent with "yang itu" patterns)', () => {
    // Original "yang itu" patterns require "yang itu aja" or "yang itu deh" or verb + "yang itu"
    expect(hasBookingCommitSignal('yang tadi')).toBe(false);
    expect(hasBookingCommitSignal('yang itu')).toBe(false);
    // But "sesuai rekomendasi ya" matches the "sesuai rekomendasi" pattern
    expect(hasBookingCommitSignal('sesuai rekomendasi ya')).toBe(true);
  });

  it('preserves existing "yang itu" patterns', () => {
    expect(hasBookingCommitSignal('mau yang itu')).toBe(true);
    expect(hasBookingCommitSignal('boleh yang itu')).toBe(true);
    expect(hasBookingCommitSignal('yang itu aja')).toBe(true);
    expect(hasBookingCommitSignal('yang itu deh')).toBe(true);
  });

  it('preserves existing single tokens', () => {
    expect(hasBookingCommitSignal('jadwalkan')).toBe(true);
    expect(hasBookingCommitSignal('ambil')).toBe(true);
    expect(hasBookingCommitSignal('deal')).toBe(true);
    expect(hasBookingCommitSignal('fix')).toBe(true);
    expect(hasBookingCommitSignal('pesan')).toBe(true);
    expect(hasBookingCommitSignal('booking')).toBe(true);
  });

  it('rejects non-commitment tokens (oke/siap not in single tokens)', () => {
    expect(hasBookingCommitSignal('oke')).toBe(false);
    expect(hasBookingCommitSignal('siap')).toBe(false);
    expect(hasBookingCommitSignal('baik')).toBe(false);
    expect(hasBookingCommitSignal('makasih')).toBe(false);
  });
});