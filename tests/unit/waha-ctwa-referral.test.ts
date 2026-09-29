import { describe, it, expect } from 'vitest';
import { extractWahaAdReferral } from '../../src/integrations/whatsapp/waha-ctwa-referral';

/**
 * Fixture struktural CTWA dari live server (Issue #119).
 * Token ctwaClid memakai prefix Meta asli (`Afi…`); nilainya bukan token produksi
 * valid (tidak pernah dikirim ke Meta), hanya bentuk/panjang yang representatif.
 */
const CTWA_CLID = 'AfiAndhVXv11SVsc5IxbflJRvrJOHBl2GoLULF8ZUcAyk7pBCPpmUOyoG7ttTwqKD7yX2w9TBCtAqBiHT77Hma1DafFvhNHY0lHzbF863EKfTz8ulGRtS8PYDBSQv5YQl0vc5tyimWW5b8tc_YFA7LG-acM5xRhwqS1hxgLyDaoqh0rQaa';
const AD_ID = '120250673996340235';

function fullAdReply() {
  return {
    ctwaClid: CTWA_CLID,
    sourceId: AD_ID,
    sourceApp: 'instagram',
    sourceUrl: 'https://www.instagram.com/p/Dd0LihqAEmX/',
    title: 'PROMO KHUSUS SURABAYA & SIDOARJO!',
    body: 'Booking home service sekarang',
    ctwaPayload: 'opaque-token',
    conversionSource: 'FB_Ads',
    entryPointConversionSource: 'ctwa_ad',
  };
}

describe('extractWahaAdReferral (WAHA CTWA)', () => {
  it('A. extract full CTWA metadata from _data.message.extendedTextMessage.contextInfo.externalAdReply', () => {
    const payload = {
      id: '5786ef3d-3391-4709-8a6f-6ebc37653daf',
      from: '6281235151811@c.us',
      body: 'Hallo Bu Bidan, Saya mau booking home service. Bagaimana Caranya ?',
      _data: {
        message: {
          extendedTextMessage: {
            text: 'Hallo Bu Bidan, Saya mau booking home service. Bagaimana Caranya ?',
            contextInfo: {
              externalAdReply: fullAdReply(),
            },
          },
        },
      },
    };

    const ref = extractWahaAdReferral(payload);
    expect(ref).toBeDefined();
    expect(ref?.ctwaClid).toBe(CTWA_CLID);
    expect(ref?.sourceId).toBe(AD_ID);
    expect(ref?.sourceApp).toBe('instagram');
    expect(ref?.sourceUrl).toBe('https://www.instagram.com/p/Dd0LihqAEmX/');
    expect(ref?.headline).toBe('PROMO KHUSUS SURABAYA & SIDOARJO!');
  });

  it('B. returns undefined for organic message without any ad reply (no throw)', () => {
    const payload = {
      id: '03430d6f-0000-0000-0000-000000000000',
      from: '628111222333@c.us',
      body: 'Halo, mau tanya jadwal',
      _data: {
        message: {
          extendedTextMessage: { text: 'Halo, mau tanya jadwal' },
        },
      },
    };

    expect(() => extractWahaAdReferral(payload)).not.toThrow();
    expect(extractWahaAdReferral(payload)).toBeUndefined();
  });

  it('C. resolves externalAdReply across multiple payload shapes', () => {
    // C1: contextInfo in message.extendedTextMessage
    const c1 = {
      message: { extendedTextMessage: { contextInfo: { externalAdReply: fullAdReply() } } },
    };
    expect(extractWahaAdReferral(c1)?.ctwaClid).toBe(CTWA_CLID);

    // C2: contextInfo directly at root
    const c2 = {
      contextInfo: { externalAdReply: fullAdReply() },
    };
    expect(extractWahaAdReferral(c2)?.ctwaClid).toBe(CTWA_CLID);

    // C3: contextInfo under _data directly
    const c3 = {
      _data: { contextInfo: { externalAdReply: fullAdReply() } },
    };
    expect(extractWahaAdReferral(c3)?.ctwaClid).toBe(CTWA_CLID);

    // C4: contextInfo under imageMessage (CTWA image ad)
    const c4 = {
      message: { imageMessage: { caption: 'Promo', contextInfo: { externalAdReply: fullAdReply() } } },
    };
    expect(extractWahaAdReferral(c4)?.ctwaClid).toBe(CTWA_CLID);
  });

  it('D. returns undefined when ctwaClid is missing, blank, whitespace, or non-string', () => {
    const noClid = { contextInfo: { externalAdReply: { sourceId: AD_ID, title: 'X' } } };
    expect(extractWahaAdReferral(noClid)).toBeUndefined();

    const blank = { contextInfo: { externalAdReply: { ...fullAdReply(), ctwaClid: '   ' } } };
    expect(extractWahaAdReferral(blank)).toBeUndefined();

    const numeric = { contextInfo: { externalAdReply: { ...fullAdReply(), ctwaClid: 12345 } } };
    expect(extractWahaAdReferral(numeric)).toBeUndefined();

    const empty = { contextInfo: { externalAdReply: { ...fullAdReply(), ctwaClid: '' } } };
    expect(extractWahaAdReferral(empty)).toBeUndefined();
  });

  it('E. normalizes snake_case keys and numeric sourceId from alternate encoders', () => {
    const snake = {
      contextInfo: {
        externalAdReply: {
          ctwa_clid: CTWA_CLID,
          source_id: 987654321,
          source_app: 'facebook',
          source_url: 'https://fb.me/ad',
        },
      },
    };
    const ref = extractWahaAdReferral(snake);
    expect(ref?.ctwaClid).toBe(CTWA_CLID);
    expect(ref?.sourceId).toBe('987654321');
    expect(ref?.sourceApp).toBe('facebook');
    expect(ref?.sourceUrl).toBe('https://fb.me/ad');
  });

  it('F. reads ctwaClid located on contextInfo instead of externalAdReply', () => {
    const payload = {
      _data: {
        message: {
          extendedTextMessage: {
            contextInfo: {
              ctwaClid: CTWA_CLID,
              entryPointConversionApp: 'instagram',
              externalAdReply: { sourceId: AD_ID },
            },
          },
        },
      },
    };
    const ref = extractWahaAdReferral(payload);
    expect(ref?.ctwaClid).toBe(CTWA_CLID);
    expect(ref?.sourceId).toBe(AD_ID);
    expect(ref?.sourceApp).toBe('instagram');
  });

  it('G. is fail-open on null / non-object / primitive payloads', () => {
    expect(extractWahaAdReferral(null)).toBeUndefined();
    expect(extractWahaAdReferral(undefined)).toBeUndefined();
    expect(extractWahaAdReferral('string')).toBeUndefined();
    expect(extractWahaAdReferral(42)).toBeUndefined();
    expect(extractWahaAdReferral([])).toBeUndefined();
    expect(extractWahaAdReferral({})).toBeUndefined();
  });

  it('H. decodes Base64 ctwaPayload / conversionData from Baileys contextInfo', () => {
    const rawClid = 'AfiAndhVXv11SVsc5IxbflJRvrJOHBl2GoLULF8ZUcAyk7pBCPpmUOyoG7ttTwqKD7yX2w9TBCtAqBiHT77Hma1DafFvhNHY0lHzbF863E';
    const b64Clid = Buffer.from(rawClid).toString('base64');

    const payload = {
      _data: {
        message: {
          extendedTextMessage: {
            text: 'Tes',
            contextInfo: {
              conversionSource: 'FB_Ads',
              conversionData: b64Clid,
              ctwaPayload: b64Clid,
              entryPointConversionApp: 'instagram',
              entryPointConversionSource: 'ctwa_ad',
              externalAdReply: {
                title: 'PROMO KHUSUS SURABAYA & SIDOARJO!',
                sourceUrl: 'https://www.instagram.com/p/Dd0LS7Pg8r3/',
              },
            },
          },
        },
      },
    };

    const ref = extractWahaAdReferral(payload);
    expect(ref).toBeDefined();
    expect(ref?.ctwaClid).toBe(rawClid);
    expect(ref?.sourceApp).toBe('instagram');
    expect(ref?.sourceType).toBe('ctwa_ad');
    expect(ref?.sourceUrl).toBe('https://www.instagram.com/p/Dd0LS7Pg8r3/');
    expect(ref?.headline).toBe('PROMO KHUSUS SURABAYA & SIDOARJO!');
  });

  it('I. rejects long random strings WITHOUT Meta prefix (anti false-positive organik→paid)', () => {
    // String 20+ char acak (dulu lolos fallback generik) — kini WAJIB undefined.
    const random20 = 'SYNTHETIC_ctwa_clid_A1'; // 22 char, no Afi/PA prefix
    const random48 = 'aB3xY9zQ1wE4rT6yU8iO0pL2kJ5hG7fD9sA1cV3bN6mQ8wZ0';
    const hashLike = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    for (const junk of [random20, random48, hashLike]) {
      const payload = {
        _data: { message: { extendedTextMessage: { contextInfo: { externalAdReply: { ctwaClid: junk } } } } },
      };
      expect(extractWahaAdReferral(payload), `should reject: ${junk}`).toBeUndefined();
    }
  });

  it('J. rejects Base64 whose decoded value is NOT an Afi/PA Meta token', () => {
    // Base64 valid, tapi decode-nya bukan token Meta → undefined.
    const b64OfJunk = Buffer.from('this_is_not_a_meta_token_at_all_1234567890').toString('base64');
    const payload = {
      _data: { message: { extendedTextMessage: { contextInfo: { ctwaPayload: b64OfJunk } } } },
    };
    expect(extractWahaAdReferral(payload)).toBeUndefined();
  });

  it('K. ignores stray root.ctwaPayload garbage without externalAdReply', () => {
    const payload = {
      id: 'x',
      from: '628@c.us',
      ctwaPayload: 'someRandomPayloadValue1234567890',
    };
    expect(extractWahaAdReferral(payload)).toBeUndefined();
  });

  it('L. accepts raw token with PA prefix (alternate Meta form)', () => {
    const paToken = 'PA' + 'x'.repeat(60);
    const payload = {
      contextInfo: { externalAdReply: { ctwaClid: paToken } },
    };
    expect(extractWahaAdReferral(payload)?.ctwaClid).toBe(paToken);
  });
});
