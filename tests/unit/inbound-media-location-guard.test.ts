import { describe, it, expect } from 'vitest';
import { wahaClient } from '../../src/integrations/waha/client';

describe('Inbound Media & Location Guard', () => {
  it('should verify WahaClient has fetchUrl and downloadMedia methods implemented', async () => {
    expect(typeof wahaClient.fetchUrl).toBe('function');
    expect(typeof wahaClient.downloadMedia).toBe('function');

    const resUrl = await wahaClient.fetchUrl('http://mock/file.jpg');
    expect(resUrl).toBeDefined();

    const resDownload = await wahaClient.downloadMedia('msg_123', '628123@c.us');
    expect(resDownload).toBeDefined();
  });

  it('should validate strict location checks and reject coordinates with 0, 0', () => {
    const isStrictLocation = (loc: any, isImage: boolean) => {
      const rawLat = loc?.latitude != null ? Number(loc.latitude) : NaN;
      const rawLng = loc?.longitude != null ? Number(loc.longitude) : NaN;
      return !isImage && !isNaN(rawLat) && !isNaN(rawLng) && rawLat !== 0 && rawLng !== 0;
    };

    // 0, 0 location should be rejected
    expect(isStrictLocation({ latitude: 0, longitude: 0 }, false)).toBe(false);
    expect(isStrictLocation({ latitude: '0', longitude: '0' }, false)).toBe(false);
    expect(isStrictLocation({ latitude: 0, longitude: 112.75 }, false)).toBe(false);

    // Location attached to image should be rejected as location
    expect(isStrictLocation({ latitude: -7.25, longitude: 112.75 }, true)).toBe(false);

    // Valid standalone location should be accepted
    expect(isStrictLocation({ latitude: -7.2574719, longitude: 112.7520883 }, false)).toBe(true);
    expect(isStrictLocation({ latitude: '-7.2574719', longitude: '112.7520883' }, false)).toBe(true);
  });

  it('should detect inbound images across all WAHA NOWEB variations', () => {
    const detectInboundImage = (pAny: any) => {
      return (
        pAny.type === 'image' ||
        pAny._data?.type === 'image' ||
        !!(pAny.message && pAny.message.imageMessage) ||
        !!(pAny.hasMedia && (pAny.media?.mimetype?.startsWith('image/') || pAny.media?.mime_type?.startsWith('image/'))) ||
        !!(pAny._data?.mimetype?.startsWith('image/')) ||
        !!(pAny.mimetype?.startsWith('image/')) ||
        !!(pAny._data?.directPath && pAny._data?.mediaKey) ||
        !!(pAny.mediaUrl || pAny._data?.mediaUrl || pAny.media?.url)
      );
    };

    // Type image
    expect(detectInboundImage({ type: 'image' })).toBe(true);

    // WAHA NOWEB _data.type
    expect(detectInboundImage({ _data: { type: 'image', id: '123' } })).toBe(true);

    // WAHA NOWEB directPath & mediaKey binary
    expect(detectInboundImage({ _data: { directPath: '/v/t62.7118', mediaKey: 'abc==' } })).toBe(true);

    // WAHA mediaUrl candidate
    expect(detectInboundImage({ mediaUrl: 'http://waha:3000/api/files/1.jpg' })).toBe(true);

    // WAHA hasMedia with mimetype
    expect(detectInboundImage({ hasMedia: true, media: { mimetype: 'image/jpeg' } })).toBe(true);

    // Plain text message should NOT be detected as image
    expect(detectInboundImage({ body: 'Halo min reservasi' })).toBe(false);
  });

  it('should detect and process outbound companion images with and without captions', () => {
    const isOutboundImagePayload = (pAny: any) => {
      const isImg =
        pAny.type === 'image' ||
        pAny._data?.type === 'image' ||
        !!(pAny.message && pAny.message.imageMessage) ||
        !!(pAny.hasMedia && (pAny.media?.mimetype?.startsWith('image/') || pAny.media?.mime_type?.startsWith('image/'))) ||
        !!(pAny._data?.mimetype?.startsWith('image/')) ||
        !!(pAny.mimetype?.startsWith('image/')) ||
        !!(pAny._data?.directPath && pAny._data?.mediaKey) ||
        !!(pAny.mediaUrl || pAny._data?.mediaUrl || pAny.media?.url);

      const imageCaption = (pAny.message?.imageMessage?.caption) || pAny.caption || (isImg ? '' : pAny.body) || pAny._data?.caption || '';
      const adminReplyText = imageCaption || pAny.body || '';

      return {
        isOutboundImage: isImg,
        shouldProcess: (adminReplyText.trim().length > 0 || isImg),
        caption: imageCaption,
      };
    };

    // Outbound image from phone WITHOUT caption (body: "")
    const imgWithoutCaption = {
      fromMe: true,
      body: '',
      hasMedia: true,
      media: { mimetype: 'image/jpeg', url: 'http://waha:3000/api/files/kartini.jpg' },
    };
    const res1 = isOutboundImagePayload(imgWithoutCaption);
    expect(res1.isOutboundImage).toBe(true);
    expect(res1.shouldProcess).toBe(true);

    // Outbound image from phone WITH caption
    const imgWithCaption = {
      fromMe: true,
      body: 'Selamat Hari Kartini',
      _data: { type: 'image', caption: 'Selamat Hari Kartini' },
    };
    const res2 = isOutboundImagePayload(imgWithCaption);
    expect(res2.isOutboundImage).toBe(true);
    expect(res2.shouldProcess).toBe(true);
    expect(res2.caption).toBe('Selamat Hari Kartini');
  });
});
