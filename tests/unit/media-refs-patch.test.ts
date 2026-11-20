import { describe, it, expect } from 'vitest';
import { patchMediaRefs } from '../../src/services/media.service';

const HD = '/media/outbound/default-tenant/foto.jpg';
const THUMB = '/media/outbound/default-tenant/foto_thumb.jpg';

describe('patchMediaRefs — kontrak anti data-loss payload pesan', () => {
  it('menghapus hdUrl & memindahkan url ke thumb, key lain tetap utuh', () => {
    const payload = {
      media: { url: HD, hdUrl: HD, thumbUrl: THUMB, mimeType: 'image/jpeg', caption: 'Rumah Bunda' },
      forceEscalate: true,
      quoted_message: { id: 'q-1', content: 'Halo' },
      reply_to: 'wamid-1',
    };

    const res = patchMediaRefs(payload, HD, THUMB);

    expect(res.changed).toBe(true);
    expect(res.next).toEqual({
      media: { url: THUMB, thumbUrl: THUMB, mimeType: 'image/jpeg', caption: 'Rumah Bunda' },
      forceEscalate: true,
      quoted_message: { id: 'q-1', content: 'Halo' },
      reply_to: 'wamid-1',
    });
  });

  it('tanpa thumb: url dihapus, media dibuang bila tidak ada URL tersisa', () => {
    const payload = { media: { url: HD, hdUrl: HD, mimeType: 'video/mp4' }, forceEscalate: true };

    const res = patchMediaRefs(payload, HD, null);

    expect(res.changed).toBe(true);
    expect(res.next).toEqual({ forceEscalate: true });
    expect(res.next.media).toBeUndefined();
  });

  it('tanpa thumb tapi masih ada thumbUrl lain: url dipromosikan dari thumbUrl', () => {
    const payload = { media: { url: HD, hdUrl: HD, thumbUrl: THUMB } };

    const res = patchMediaRefs(payload, HD, null);

    expect(res.changed).toBe(true);
    expect(res.next.media).toEqual({ thumbUrl: THUMB, url: THUMB });
  });

  it('payload tanpa media / null / array → tidak berubah', () => {
    expect(patchMediaRefs({ forceEscalate: true }, HD, THUMB)).toEqual({
      changed: false,
      next: { forceEscalate: true },
    });
    expect(patchMediaRefs(null, HD, THUMB)).toEqual({ changed: false, next: null });
    expect(patchMediaRefs({ media: [] }, HD, THUMB)).toEqual({ changed: false, next: { media: [] } });
  });

  it('media dengan hdUrl berbeda (bukan target) → tidak berubah', () => {
    const payload = { media: { url: '/media/outbound/default-tenant/lain.jpg', hdUrl: '/media/outbound/default-tenant/lain.jpg' } };

    const res = patchMediaRefs(payload, HD, THUMB);

    expect(res.changed).toBe(false);
    expect(res.next).toBe(payload);
  });

  it('idempoten: hasil patch kedua tidak mengubah apa pun lagi', () => {
    const first = patchMediaRefs({ media: { url: HD, hdUrl: HD, thumbUrl: THUMB } }, HD, THUMB);
    const second = patchMediaRefs(first.next, HD, THUMB);

    expect(second.changed).toBe(false);
    expect(second.next).toEqual(first.next);
  });
});
