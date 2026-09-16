import { describe, it, expect } from 'vitest';
import { parseCanonicalInboundMessage } from '../../src/utils/canonical-message-normalizer';

describe('Canonical Message Normalizer', () => {
  it('harus menormalisasi teks biasa dengan benar', () => {
    const payload = {
      body: 'Halo Bidan Yusi, mau tanya jadwal treatment',
      _data: { notifyName: 'Bunda Ani' },
    };
    const result = parseCanonicalInboundMessage(payload);
    expect(result.type).toBe('text');
    expect(result.content).toBe('Halo Bidan Yusi, mau tanya jadwal treatment');
    expect(result.location).toBeUndefined();
    expect(result.media).toBeUndefined();
  });

  it('harus menormalisasi GPS Pin WAHA NOWEB (Baileys degreesLatitude) dan menghasilkan format kanonis', () => {
    const payload = {
      id: 'false_6281358343158@c.us_3EB0123',
      from: '6281358343158@c.us',
      _data: {
        message: {
          locationMessage: {
            degreesLatitude: -7.278920650482178,
            degreesLongitude: 112.6921157836914,
          },
        },
      },
    };
    const result = parseCanonicalInboundMessage(payload);
    expect(result.type).toBe('location');
    expect(result.location).toBeDefined();
    expect(result.location?.latitude).toBeCloseTo(-7.27892065, 5);
    expect(result.location?.longitude).toBeCloseTo(112.69211578, 5);
    expect(result.content).toBe('[LOCATION: Lat -7.278920650482178, Lng 112.6921157836914]');
  });

  it('harus menormalisasi Live Location WAHA NOWEB', () => {
    const payload = {
      _data: {
        message: {
          liveLocationMessage: {
            degreesLatitude: -7.3100,
            degreesLongitude: 112.7500,
          },
        },
      },
    };
    const result = parseCanonicalInboundMessage(payload);
    expect(result.type).toBe('live_location');
    expect(result.location?.isLive).toBe(true);
    expect(result.content).toContain('[LIVE_LOCATION: Lat -7.31, Lng 112.75]');
  });

  it('harus membuang koordinat 0,0 (EXIF/WA Web) dan tidak menganggapnya sebagai lokasi', () => {
    const payload = {
      location: { latitude: 0, longitude: 0 },
      body: 'Foto rumah',
    };
    const result = parseCanonicalInboundMessage(payload);
    expect(result.type).toBe('text');
    expect(result.location).toBeUndefined();
    expect(result.content).toBe('Foto rumah');
  });

  it('harus menormalisasi Voice Note (PTT audio)', () => {
    const payload = {
      type: 'ptt',
      message: {
        audioMessage: {
          mimetype: 'audio/ogg; codecs=opus',
          ptt: true,
          url: 'https://waha.test/audio.ogg',
        },
      },
    };
    const result = parseCanonicalInboundMessage(payload);
    expect(result.type).toBe('voice_note');
    expect(result.content).toBe('[VOICE_NOTE]');
    expect(result.media?.isPtt).toBe(true);
    expect(result.media?.mimeType).toBe('audio/ogg; codecs=opus');
  });

  it('harus menormalisasi Dokumen PDF beserta nama filenya', () => {
    const payload = {
      type: 'document',
      message: {
        documentMessage: {
          fileName: 'Buku_KIA_Bunda.pdf',
          mimetype: 'application/pdf',
          url: 'https://waha.test/doc.pdf',
        },
      },
    };
    const result = parseCanonicalInboundMessage(payload);
    expect(result.type).toBe('document');
    expect(result.content).toBe('[DOCUMENT: Buku_KIA_Bunda.pdf]');
    expect(result.media?.fileName).toBe('Buku_KIA_Bunda.pdf');
    expect(result.media?.mimeType).toBe('application/pdf');
  });

  it('harus menormalisasi Video beserta caption jika ada', () => {
    const payload = {
      type: 'video',
      message: {
        videoMessage: {
          caption: 'Kondisi anak demam',
          mimetype: 'video/mp4',
        },
      },
    };
    const result = parseCanonicalInboundMessage(payload);
    expect(result.type).toBe('video');
    expect(result.content).toBe('[VIDEO: Kondisi anak demam]');
    expect(result.media?.caption).toBe('Kondisi anak demam');
  });

  it('harus menormalisasi Stiker', () => {
    const payload = {
      type: 'sticker',
      message: {
        stickerMessage: {
          mimetype: 'image/webp',
        },
      },
    };
    const result = parseCanonicalInboundMessage(payload);
    expect(result.type).toBe('sticker');
    expect(result.content).toBe('[STICKER]');
    expect(result.media?.isSticker).toBe(true);
  });

  it('harus menormalisasi Kontak (vCard)', () => {
    const payload = {
      type: 'contact',
      message: {
        contactMessage: {
          displayName: 'Bidan Rina Sidoarjo',
          vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN:Bidan Rina Sidoarjo\nTEL;waid=62812345678:+62 812-345-678\nEND:VCARD',
        },
      },
    };
    const result = parseCanonicalInboundMessage(payload);
    expect(result.type).toBe('contact');
    expect(result.content).toBe('[CONTACT: Bidan Rina Sidoarjo | 62812345678]');
    expect(result.contact?.name).toBe('Bidan Rina Sidoarjo');
    expect(result.contact?.phone).toBe('62812345678');
  });
});
