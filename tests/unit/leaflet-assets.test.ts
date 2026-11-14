import { describe, it, expect } from 'vitest';
import {
  resolveLeafletAssetBase,
  getLeafletAssetUrls,
} from '../../packages/admin-dashboard/src/utils/leafletLoader';

describe('leafletLoader — aset lokal same-origin (KNOWN #344)', () => {
  it('base dinormalisasi dan menunjuk folder vendor lokal', () => {
    expect(resolveLeafletAssetBase('/admin/')).toBe('/admin/vendor/leaflet/');
    expect(resolveLeafletAssetBase('/admin')).toBe('/admin/vendor/leaflet/');
    expect(resolveLeafletAssetBase('/')).toBe('/vendor/leaflet/');
    expect(resolveLeafletAssetBase('')).toBe('/vendor/leaflet/');
  });

  it('semua URL aset same-origin (tidak ada unpkg/CDN)', () => {
    const urls = getLeafletAssetUrls('/admin/');
    const all = [urls.js, urls.markerClusterJs, ...urls.css];
    for (const u of all) {
      expect(u.startsWith('/admin/vendor/leaflet/')).toBe(true);
      expect(u).not.toMatch(/unpkg|cdn|https?:\/\//i);
    }
  });

  it('aset wajib mencakup leaflet + markercluster css/js', () => {
    const urls = getLeafletAssetUrls('/admin/');
    expect(urls.css).toEqual([
      '/admin/vendor/leaflet/leaflet.css',
      '/admin/vendor/leaflet/MarkerCluster.css',
      '/admin/vendor/leaflet/MarkerCluster.Default.css',
    ]);
    expect(urls.js).toBe('/admin/vendor/leaflet/leaflet.js');
    expect(urls.markerClusterJs).toBe('/admin/vendor/leaflet/leaflet.markercluster.js');
  });
});
