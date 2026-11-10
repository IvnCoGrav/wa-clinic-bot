import { describe, it, expect } from 'vitest';
import { POPULAR_LANDMARKS, findPopularLandmark } from '../../src/config/landmarks';

describe('CFG-09: Landmarks Dynamic JSON Loader', () => {
  it('loads 61 landmarks from landmarks.data.json', () => {
    expect(POPULAR_LANDMARKS.length).toBe(61);
  });

  it('matches known landmark pattern correctly', () => {
    const found = findPopularLandmark('saya tinggal di apartemen puncak permai');
    expect(found).not.toBeNull();
    expect(found?.name).toBe('Puncak Permai Apartment');
    expect(found?.kelurahan).toBe('Tanjungsari');
    expect(found?.kecamatan).toBe('Sukomanunggal');
  });

  it('returns null for unknown landmark', () => {
    const found = findPopularLandmark('di dekat pohon kelapa');
    expect(found).toBeNull();
  });
});
