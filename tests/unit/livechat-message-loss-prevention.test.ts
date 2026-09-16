import { describe, it, expect } from 'vitest';
import { parseCanonicalInboundMessage } from '../../src/utils/canonical-message-normalizer';
import { extractLocationFromPayload, sanitizePayloadForSse } from '../../src/services/message.service';

describe('LiveChat Message Loss Prevention & Canonical Pipeline', () => {
  describe('Layer 1: Canonical Normalizer Parsing', () => {
    it('harus mengekstrak GPS Pin Baileys NOWEB dengan presisi tinggi', () => {
      const payload = {
        id: 'false_6281358343158@c.us_3EB0123',
        from: '6281358343158@c.us',
        _data: {
          message: {
            locationMessage: {
              degreesLatitude: -7.278920650482178,
              degreesLongitude: 112.6921157836914,
              address: 'Jl. Mayjen HR. Muhammad No.371, Pradahkalikendal, Kec. Dukuhpakis, Surabaya',
              name: 'Lokasi Bunda',
            },
          },
        },
      };

      const parsed = parseCanonicalInboundMessage(payload);
      expect(parsed.type).toBe('location');
      expect(parsed.location).toBeDefined();
      expect(parsed.location?.latitude).toBeCloseTo(-7.27892065, 6);
      expect(parsed.location?.longitude).toBeCloseTo(112.69211578, 6);
      expect(parsed.location?.address).toContain('Mayjen HR. Muhammad');
      expect(parsed.location?.name).toBe('Lokasi Bunda');
      expect(parsed.content).toContain('[LOCATION: Lat -7.278920650482178, Lng 112.6921157836914');
    });

    it('harus mengekstrak Live Location Baileys NOWEB', () => {
      const payload = {
        _data: {
          message: {
            liveLocationMessage: {
              degreesLatitude: -7.3000,
              degreesLongitude: 112.7400,
              caption: 'Sedang otw klinik',
            },
          },
        },
      };

      const parsed = parseCanonicalInboundMessage(payload);
      expect(parsed.type).toBe('live_location');
      expect(parsed.location?.isLive).toBe(true);
      expect(parsed.location?.latitude).toBe(-7.3);
      expect(parsed.location?.longitude).toBe(112.74);
      expect(parsed.content).toContain('[LIVE_LOCATION: Lat -7.3, Lng 112.74]');
    });

    it('harus mengekstrak Voice Note PTT WhatsApp', () => {
      const payload = {
        type: 'ptt',
        media: {
          url: 'http://localhost:3000/api/files/ptt-12345.ogg',
          mimetype: 'audio/ogg; codecs=opus',
        },
      };

      const parsed = parseCanonicalInboundMessage(payload);
      expect(parsed.type).toBe('voice_note');
      expect(parsed.media?.mimeType).toContain('audio/ogg');
      expect(parsed.content).toBe('[VOICE_NOTE]');
    });

    it('harus mengekstrak Dokumen PDF WhatsApp', () => {
      const payload = {
        type: 'document',
        media: {
          url: 'http://localhost:3000/api/files/hasil-lab.pdf',
          mimetype: 'application/pdf',
          filename: 'Hasil_Lab_Bayi.pdf',
        },
      };

      const parsed = parseCanonicalInboundMessage(payload);
      expect(parsed.type).toBe('document');
      expect(parsed.media?.fileName).toBe('Hasil_Lab_Bayi.pdf');
      expect(parsed.content).toBe('[DOCUMENT: Hasil_Lab_Bayi.pdf]');
    });

    it('harus mengekstrak Kontak vCard WhatsApp', () => {
      const payload = {
        type: 'vcard',
        vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN:Bunda Siti\nTEL;type=CELL;type=VOICE;waid=628123456789:+62 812-3456-789\nEND:VCARD',
      };

      const parsed = parseCanonicalInboundMessage(payload);
      expect(parsed.type).toBe('contact');
      expect(parsed.contact?.name).toBe('Bunda Siti');
      expect(parsed.contact?.phone).toContain('628123456789');
      expect(parsed.content).toBe('[CONTACT: Bunda Siti | 628123456789]');
    });

    it('harus mengekstrak Video WhatsApp beserta caption', () => {
      const payload = {
        type: 'video',
        caption: 'Video keluhan dedek bayi demam',
        media: {
          url: 'http://localhost:3000/api/files/video-baby.mp4',
          mimetype: 'video/mp4',
        },
      };

      const parsed = parseCanonicalInboundMessage(payload);
      expect(parsed.type).toBe('video');
      expect(parsed.media?.mimeType).toBe('video/mp4');
      expect(parsed.content).toBe('[VIDEO: Video keluhan dedek bayi demam]');
    });
  });

  describe('Layer 2: Message Service Location Extraction & SSE Sanitization', () => {
    it('extractLocationFromPayload harus mengekstrak koordinat valid dan menolak 0,0', () => {
      const validPayload = {
        location: {
          latitude: -7.27892,
          longitude: 112.69211,
          address: 'Surabaya',
        },
      };
      const loc = extractLocationFromPayload(validPayload);
      expect(loc).toBeDefined();
      expect(loc?.latitude).toBeCloseTo(-7.27892, 5);
      expect(loc?.longitude).toBeCloseTo(112.69211, 5);

      const zeroPayload = {
        location: {
          latitude: 0,
          longitude: 0,
        },
      };
      expect(extractLocationFromPayload(zeroPayload)).toBeNull();

      const nullPayload = {};
      expect(extractLocationFromPayload(nullPayload)).toBeNull();
    });

    it('sanitizePayloadForSse harus membersihkan binary buffer besar tetapi mempertahankan struktur lokasi dan media', () => {
      const bloatedPayload = {
        id: 'msg_123',
        location: { latitude: -7.28, longitude: 112.69 },
        media: { url: '/media/test.jpg' },
        _data: {
          mediaData: 'LARGE_BASE64_BLOB_SHOULD_BE_PRUNED',
          quotedMsg: { body: 'pesan asal' },
        },
      };

      const sanitized = sanitizePayloadForSse(bloatedPayload);
      expect(sanitized.location).toBeDefined();
      expect(sanitized.media).toBeDefined();
      expect(sanitized._data?.mediaData).toBeUndefined();
      expect(sanitized._data?.quotedMsg?.body).toBe('pesan asal');
    });
  });

  describe('Layer 3: Anti-Hollow Bubble Verification', () => {
    it('semua tipe pesan harus memiliki representasi visual atau teks kanonis yang tidak kosong', () => {
      const testCases = [
        { type: 'text', payload: { body: 'Halo' } },
        { type: 'location', payload: { location: { latitude: -7.25, longitude: 112.75 } } },
        { type: 'audio', payload: { type: 'ptt', media: { url: 'http://a.com/1.ogg' } } },
        { type: 'document', payload: { type: 'document', media: { url: 'http://a.com/doc.pdf', filename: 'sop.pdf' } } },
        { type: 'video', payload: { type: 'video', media: { url: 'http://a.com/v.mp4' } } },
        { type: 'sticker', payload: { type: 'sticker', media: { url: 'http://a.com/s.webp' } } },
      ];

      for (const tc of testCases) {
        const parsed = parseCanonicalInboundMessage(tc.payload);
        expect(parsed.content).toBeTruthy();
        expect(parsed.content.trim().length).toBeGreaterThan(0);
        // Memastikan tidak ada yang menghasilkan string kosong atau undefined
        expect(typeof parsed.content).toBe('string');
      }
    });
  });
});
