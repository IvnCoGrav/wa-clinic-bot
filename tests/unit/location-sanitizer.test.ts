import { describe, it, expect } from 'vitest';
import { sanitizeLocationTextForGeocoding } from '../../src/utils/location-sanitizer';

describe('Location Sanitizer Unit Tests', () => {
  it('should clean "Food junction tandes sby berapa ongkir bubid"', () => {
    const raw = 'Food junction tandes sby berapa ongkir bubid';
    const cleaned = sanitizeLocationTextForGeocoding(raw);
    expect(cleaned.toLowerCase()).toBe('food junction tandes sby');
  });

  it('should clean "di Kalijudan V berapa ongkirnya kak"', () => {
    const raw = 'di Kalijudan V berapa ongkirnya kak';
    const cleaned = sanitizeLocationTextForGeocoding(raw);
    expect(cleaned.toLowerCase()).toBe('kalijudan v');
  });

  it('should clean "Rumah saya di Manukan kulon tanyakan ongkir"', () => {
    const raw = 'Rumah saya di Manukan kulon tanyakan ongkir';
    const cleaned = sanitizeLocationTextForGeocoding(raw);
    expect(cleaned.toLowerCase()).toBe('manukan kulon');
  });
});
