import { describe, it, expect } from 'vitest';
import { extractAudio, toDisplayMediaUrl } from '../../packages/admin-dashboard/src/utils/mediaExtractor';

describe('mediaExtractor — extractAudio & toDisplayMediaUrl', () => {
  describe('toDisplayMediaUrl', () => {
    it('mempertahankan path relatif tanpa modifikasi', () => {
      expect(toDisplayMediaUrl('/media/inbound/default-tenant/voice.oga')).toBe(
        '/media/inbound/default-tenant/voice.oga'
      );
    });

    it('memotong loopback URL ke path relatif', () => {
      expect(toDisplayMediaUrl('http://localhost:3000/media/inbound/tenant1/sample.ogg')).toBe(
        '/media/inbound/tenant1/sample.ogg'
      );
      expect(toDisplayMediaUrl('http://127.0.0.1:3000/media/outbound/tenant1/audio.mp3')).toBe(
        '/media/outbound/tenant1/audio.mp3'
      );
    });

    it('mempertahankan URL eksternal (WhatsApp CDN / Cloudinary)', () => {
      const cdnUrl = 'https://mmg.whatsapp.net/v/t62.7114-24/test.opus?token=xyz';
      expect(toDisplayMediaUrl(cdnUrl)).toBe(cdnUrl);
    });

    it('mengembalikan undefined untuk nilai kosong atau falsy', () => {
      expect(toDisplayMediaUrl('')).toBeUndefined();
      expect(toDisplayMediaUrl(null)).toBeUndefined();
      expect(toDisplayMediaUrl(undefined)).toBeUndefined();
    });
  });

  describe('extractAudio — deteksi Voice Note / PTT', () => {
    it('mengenali placeholder [VOICE_NOTE] dan menetapkan codec opus', () => {
      const msg = {
        content: '[VOICE_NOTE]',
        media: { url: '/media/inbound/default-tenant/voice_1.oga' },
      };
      const result = extractAudio(msg);
      expect(result).not.toBeNull();
      expect(result?.isPtt).toBe(true);
      expect(result?.fileName).toBe('Voice Note');
      expect(result?.mimeType).toBe('audio/ogg; codecs=opus');
      expect(result?.url).toBe('/media/inbound/default-tenant/voice_1.oga');
    });

    it('mengenali payload_raw dengan type ptt', () => {
      const msg = {
        content: '',
        payload_raw: {
          type: 'ptt',
          media: { url: '/media/inbound/default-tenant/rec.ogg' },
        },
      };
      const result = extractAudio(msg);
      expect(result).not.toBeNull();
      expect(result?.isPtt).toBe(true);
      expect(result?.mimeType).toBe('audio/ogg; codecs=opus');
    });

    it('mengenali payloadRaw (camelCase) dari serialisasi Prisma', () => {
      const msg = {
        content: '',
        payloadRaw: {
          isPtt: true,
          media: { url: '/media/inbound/default-tenant/rec2.oga' },
        },
      };
      const result = extractAudio(msg);
      expect(result).not.toBeNull();
      expect(result?.isPtt).toBe(true);
      expect(result?.mimeType).toBe('audio/ogg; codecs=opus');
    });
  });

  describe('extractAudio — deteksi Audio umum (.oga, .ogg, .opus, .mp3)', () => {
    it('mengenali URL dengan ekstensi .oga dan fallback MIME audio/ogg; codecs=opus', () => {
      const msg = {
        content: '',
        media: { url: '/media/outbound/default-tenant/voice_note_123.oga' },
      };
      const result = extractAudio(msg);
      expect(result).not.toBeNull();
      expect(result?.isPtt).toBe(false);
      expect(result?.mimeType).toBe('audio/ogg; codecs=opus');
      expect(result?.fileName).toBe('Audio');
    });

    it('mengenali URL .oga dengan query parameter', () => {
      const msg = {
        content: '',
        media: { url: '/media/outbound/default-tenant/recording.oga?v=123' },
      };
      const result = extractAudio(msg);
      expect(result).not.toBeNull();
      expect(result?.mimeType).toBe('audio/ogg; codecs=opus');
    });

    it('mengenali audio .mp3 dan menetapkan audio/mpeg', () => {
      const msg = {
        content: '[AUDIO: laguku.mp3]',
        media: { url: '/media/inbound/default-tenant/laguku.mp3' },
      };
      const result = extractAudio(msg);
      expect(result).not.toBeNull();
      expect(result?.fileName).toBe('laguku.mp3');
      expect(result?.mimeType).toBe('audio/mpeg');
    });

    it('mengembalikan MIME spesifik dari metadata jika sudah ada', () => {
      const msg = {
        content: '',
        payload_raw: {
          media_mime_type: 'audio/aac',
          media: { url: '/media/inbound/default-tenant/sound.aac' },
        },
      };
      const result = extractAudio(msg);
      expect(result).not.toBeNull();
      expect(result?.mimeType).toBe('audio/aac');
    });
  });

  describe('extractAudio — non-audio messages', () => {
    it('mengembalikan null untuk pesan teks biasa', () => {
      const msg = { content: 'Halo admin, apakah ada jadwal hari ini?' };
      expect(extractAudio(msg)).toBeNull();
    });

    it('mengembalikan null untuk pesan gambar murni', () => {
      const msg = {
        content: '[IMAGE]',
        media: { url: '/media/inbound/default-tenant/photo.jpg', mimeType: 'image/jpeg' },
      };
      expect(extractAudio(msg)).toBeNull();
    });

    it('mengembalikan null jika pesan null atau undefined', () => {
      expect(extractAudio(null)).toBeNull();
      expect(extractAudio(undefined)).toBeNull();
    });
  });
});
