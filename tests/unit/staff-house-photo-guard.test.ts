import { describe, it, expect } from 'vitest';
import {
  needsHousePhoto,
  resolveLocModalMode,
} from '../../packages/admin-dashboard/src/pages/staff/housePhotoGuard';

describe('Staff House Photo Guard (Fase 2)', () => {
  describe('needsHousePhoto', () => {
    it('mengembalikan true jika task null/undefined', () => {
      expect(needsHousePhoto(null)).toBe(true);
      expect(needsHousePhoto(undefined)).toBe(true);
    });

    it('mengembalikan true jika address tidak memiliki housePhotoUrl', () => {
      expect(needsHousePhoto({})).toBe(true);
      expect(needsHousePhoto({ address: {} })).toBe(true);
      expect(needsHousePhoto({ address: { housePhotoUrl: null } })).toBe(true);
      expect(needsHousePhoto({ address: { housePhotoUrl: '' } })).toBe(true);
    });

    it('mengembalikan false jika housePhotoUrl sudah ada dan valid', () => {
      expect(
        needsHousePhoto({
          address: {
            housePhotoUrl: 'https://example.com/photos/house123.jpg',
          },
        })
      ).toBe(false);
      expect(
        needsHousePhoto({
          address: {
            housePhotoUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...',
          },
        })
      ).toBe(false);
    });
  });

  describe('resolveLocModalMode', () => {
    it('mengembalikan "edit" jika belum ada foto rumah (meskipun lat/lng/landmark sudah ada)', () => {
      expect(
        resolveLocModalMode({
          address: {
            lat: -7.345,
            lng: 112.789,
            landmark: 'Pagar hitam depan pos satpam',
            housePhotoUrl: null,
          },
        })
      ).toBe('edit');

      expect(
        resolveLocModalMode({
          address: {
            lat: -7.345,
            lng: 112.789,
          },
        })
      ).toBe('edit');
    });

    it('mengembalikan "view" jika foto rumah sudah terisi', () => {
      expect(
        resolveLocModalMode({
          address: {
            lat: -7.345,
            lng: 112.789,
            landmark: 'Pagar hitam',
            housePhotoUrl: 'https://example.com/photo.jpg',
          },
        })
      ).toBe('view');
    });
  });
});
