import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import {
  isAllowedGoogleMapsHost,
  resolveGoogleMapsUrl,
} from '../../src/utils/google-maps-url-resolver';

vi.mock('axios');

describe('UTL-04 / CCL-03: Google Maps URL Resolver SSRF Protection', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('isAllowedGoogleMapsHost', () => {
    it('mengizinkan domain Google Maps yang sah', () => {
      expect(isAllowedGoogleMapsHost('https://maps.app.goo.gl/DGusQAqJDvPWznBV6')).toBe(true);
      expect(isAllowedGoogleMapsHost('https://goo.gl/maps/abc123xyz')).toBe(true);
      expect(isAllowedGoogleMapsHost('https://share.google/Ef30htzIpVPKEwdWP')).toBe(true);
      expect(isAllowedGoogleMapsHost('https://maps.google.com/maps?q=-7.3,112.7')).toBe(true);
      expect(isAllowedGoogleMapsHost('https://maps.google.co.id/maps?q=-7.3,112.7')).toBe(true);
      expect(isAllowedGoogleMapsHost('https://www.google.com/maps/place/Surabaya')).toBe(true);
      expect(isAllowedGoogleMapsHost('https://google.com/maps/search/Klinik')).toBe(true);
    });

    it('menolak localhost, loopback, private IP, dan AWS metadata', () => {
      expect(isAllowedGoogleMapsHost('http://localhost:3000/api/admin')).toBe(false);
      expect(isAllowedGoogleMapsHost('http://127.0.0.1:8080')).toBe(false);
      expect(isAllowedGoogleMapsHost('http://169.254.169.254/latest/meta-data')).toBe(false);
      expect(isAllowedGoogleMapsHost('http://10.0.0.5:8000')).toBe(false);
      expect(isAllowedGoogleMapsHost('http://192.168.1.1/admin')).toBe(false);
      expect(isAllowedGoogleMapsHost('http://172.16.1.10')).toBe(false);
      expect(isAllowedGoogleMapsHost('http://172.31.255.255')).toBe(false);
      expect(isAllowedGoogleMapsHost('http://0.0.0.0:3000')).toBe(false);
      expect(isAllowedGoogleMapsHost('http://backend.internal/secret')).toBe(false);
    });

    it('menolak domain jahat / phishing yang menyerupai Google', () => {
      expect(isAllowedGoogleMapsHost('https://attacker.com/steal')).toBe(false);
      expect(isAllowedGoogleMapsHost('https://evil-google.com/maps')).toBe(false);
      expect(isAllowedGoogleMapsHost('https://maps.google.com.attacker.com')).toBe(false);
      expect(isAllowedGoogleMapsHost('https://goo.gl.attacker.org')).toBe(false);
      expect(isAllowedGoogleMapsHost('ftp://maps.google.com')).toBe(false);
      expect(isAllowedGoogleMapsHost('javascript:alert(1)')).toBe(false);
    });
  });

  describe('resolveGoogleMapsUrl SSRF blocking', () => {
    it('menolak URL private IP sebelum melakukan network request', async () => {
      const result = await resolveGoogleMapsUrl('http://169.254.169.254/latest/meta-data');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/ssrf|not allowed|host/i);
      expect(axios.get).not.toHaveBeenCalled();
    });

    it('menolak URL localhost sebelum network request', async () => {
      const result = await resolveGoogleMapsUrl('http://localhost:3000/api/admin/users');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/ssrf|not allowed|host/i);
      expect(axios.get).not.toHaveBeenCalled();
    });

    it('menolak shortlink yang me-redirect ke internal IP (SSRF redirect protection)', async () => {
      // Mock request awal ke shortlink maps.app.goo.gl mengembalikan redirect ke metadata AWS
      vi.mocked(axios.get).mockResolvedValueOnce({
        status: 302,
        headers: { location: 'http://169.254.169.254/latest/meta-data' },
        request: { res: { responseUrl: 'http://169.254.169.254/latest/meta-data' } },
        config: { url: 'http://169.254.169.254/latest/meta-data' },
        data: 'redirecting...',
      } as any);

      const result = await resolveGoogleMapsUrl('https://maps.app.goo.gl/fakeEvilRedirect');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/ssrf|not allowed|host/i);
    });

    it('mengizinkan shortlink sah yang me-redirect ke Google Maps URL dengan koordinat', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({
        status: 200,
        headers: {},
        request: { res: { responseUrl: 'https://www.google.com/maps/place/@-7.3488600,112.7516770,17z' } },
        config: { url: 'https://www.google.com/maps/place/@-7.3488600,112.7516770,17z' },
        data: '<html>ok</html>',
      } as any);

      const result = await resolveGoogleMapsUrl('https://maps.app.goo.gl/validLink');
      expect(result.success).toBe(true);
      expect(result.lat).toBeCloseTo(-7.34886, 5);
      expect(result.lng).toBeCloseTo(112.751677, 5);
    });
  });
});
