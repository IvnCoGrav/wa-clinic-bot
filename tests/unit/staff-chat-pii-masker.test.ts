import { describe, it, expect } from 'vitest';
import {
  maskPhoneInText,
  sanitizeMessageForStaff,
  sanitizeStaffHubPayload,
  sanitizePayloadRawForStaff,
  maskPhoneNumber,
} from '../../src/utils/pii-masker';

describe('maskPhoneInText — sanitizer 5 digit terakhir', () => {
  it('081234567890 → 0812345*****', () => {
    expect(maskPhoneInText('hubungi 081234567890 ya')).toBe('hubungi 0812345***** ya');
  });
  it('0812-3456-7890 → 0812-345*****', () => {
    expect(maskPhoneInText('nomor 0812-3456-7890')).toBe('nomor 0812-345*****');
  });
  it('+6281234567890 → +62812345*****', () => {
    expect(maskPhoneInText('+6281234567890')).toBe('+62812345*****');
  });
  it('0812 3456 7890 → 0812 345*****', () => {
    expect(maskPhoneInText('0812 3456 7890')).toBe('0812 345*****');
  });
  it('wa.me/6281234567890 → wa.me/62812345*****', () => {
    expect(maskPhoneInText('cek wa.me/6281234567890')).toBe('cek wa.me/62812345*****');
  });
  it('https://wa.me/6281234567890 dengan scheme', () => {
    expect(maskPhoneInText('https://wa.me/6281234567890')).toBe('https://wa.me/62812345*****');
  });
  it('6281234567890@c.us → 62812345*****@c.us', () => {
    expect(maskPhoneInText('from 6281234567890@c.us')).toBe('from 62812345*****@c.us');
  });
  it('(0812) 3456-7890 dengan kurung', () => {
    const out = maskPhoneInText('telp (0812) 3456-7890');
    expect(out).toContain('*****');
    expect(out).not.toContain('7890');
  });
  it('+62 812-3456-7890 dengan spasi & plus', () => {
    const out = maskPhoneInText('+62 812-3456-7890');
    expect(out).toContain('*****');
    expect(out).not.toContain('7890');
  });
  it('multiple numbers dalam satu teks', () => {
    const out = maskPhoneInText('081234567890 dan 081298765432');
    expect(out).toBe('0812345***** dan 0812987*****');
  });

  it('tidak menyentuh harga Rp 150.000', () => {
    expect(maskPhoneInText('biaya Rp 150.000')).toBe('biaya Rp 150.000');
  });
  it('tidak menyentuh jam 08:00 WIB', () => {
    expect(maskPhoneInText('jam 08:00 WIB')).toBe('jam 08:00 WIB');
  });
  it('tidak menyentuh tahun 2026', () => {
    expect(maskPhoneInText('tahun 2026')).toBe('tahun 2026');
  });
  it('tidak menyentuh koordinat', () => {
    expect(maskPhoneInText('lokasi -7.28, 112.79')).toBe('lokasi -7.28, 112.79');
  });
  it('tidak menyentuh order ID pendek', () => {
    expect(maskPhoneInText('order #12345')).toBe('order #12345');
  });
  it('teks tanpa nomor tetap utuh', () => {
    expect(maskPhoneInText('halo bunda apa kabar')).toBe('halo bunda apa kabar');
  });
  it('null/empty safe', () => {
    expect(maskPhoneInText('' as any)).toBe('');
    expect(maskPhoneInText(null as any)).toBe('');
  });
});

describe('maskPhoneNumber vs maskPhoneInText dual standard', () => {
  it('maskPhoneNumber tetap 4+****+3', () => {
    expect(maskPhoneNumber('081234567890')).toBe('0812****890');
  });
  it('maskPhoneInText 5 digit bintang', () => {
    expect(maskPhoneInText('081234567890')).toBe('0812345*****');
  });
});

describe('sanitizePayloadRawForStaff — allowlist & strip JID', () => {
  it('menghapus from/to/author/_data/buffer/jpegThumbnail', () => {
    const raw = {
      from: '6281234567890@c.us',
      to: '6289999999999@c.us',
      author: '6281234567890@c.us',
      chatId: '6281234567890@c.us',
      sender: '6281234567890@c.us',
      participant: '6281234567890@c.us',
      _data: {
        key: { remoteJid: '6281234567890@c.us', participant: '6281234567890@c.us' },
        notifyName: 'Bunda',
        pushName: 'Bunda',
        jpegThumbnail: 'base64...',
        mediaData: 'base64...',
      },
      buffer: Buffer.from('xxx'),
      message: { imageMessage: { jpegThumbnail: 'xxx' } },
      media: { url: '/media/a.jpg', mimeType: 'image/jpeg', caption: 'hub 081234567890' },
      location: { latitude: -7.28, longitude: 112.79, address: 'Jl call 081234567890' },
      type: 'image',
      is_revoked: false,
    };
    const out = sanitizePayloadRawForStaff(raw);
    expect(out.from).toBeUndefined();
    expect(out.to).toBeUndefined();
    expect(out.author).toBeUndefined();
    expect(out.chatId).toBeUndefined();
    expect(out.sender).toBeUndefined();
    expect(out.participant).toBeUndefined();
    expect(out._data).toBeUndefined();
    expect(out.buffer).toBeUndefined();
    expect(out.key).toBeUndefined();
    // media lestari tapi caption termaskir
    expect(out.media.url).toBe('/media/a.jpg');
    expect(out.media.caption).toBe('hub 0812345*****');
    // location lestari tapi address termaskir
    expect(out.location.latitude).toBe(-7.28);
    expect(out.location.address).toBe('Jl call 0812345*****');
    expect(out.type).toBe('image');
  });

  it('contact phone termaskir', () => {
    const raw = { contact: { name: 'Bunda', phone: '081234567890', displayName: 'Bunda' } };
    const out = sanitizePayloadRawForStaff(raw);
    expect(out.contact.phone).toBe('0812345*****');
  });

  it('quoted_message content termaskir', () => {
    const raw = { quoted_message: { content: 'hub 081234567890', sender_name: '081234567890' } };
    const out = sanitizePayloadRawForStaff(raw);
    expect(out.quoted_message.content).toBe('hub 0812345*****');
    expect(out.quoted_message.sender_name).toBe('0812345*****');
  });

  it('promosi location dari _data.message.locationMessage', () => {
    const raw = { _data: { message: { locationMessage: { degreesLatitude: -7.1, degreesLongitude: 112.7, address: 'call 081234567890' } } } };
    const out = sanitizePayloadRawForStaff(raw);
    expect(out.location.latitude).toBe(-7.1);
    expect(out.location.address).toBe('call 0812345*****');
    expect(out._data).toBeUndefined();
  });

  it('reactions actorId dibuang, emoji lestari', () => {
    const raw = { reactions: [{ emoji: '❤️', fromMe: true, actorId: '6281234567890@c.us', senderName: '081234567890' }] };
    const out = sanitizePayloadRawForStaff(raw);
    expect(out.reactions[0].emoji).toBe('❤️');
    expect(out.reactions[0].actorId).toBeUndefined();
    expect(out.reactions[0].senderName).toBe('0812345*****');
  });
});

describe('sanitizeMessageForStaff — row DB', () => {
  it('content & sender_name termaskir, payload_raw difilter', () => {
    const msg = {
      id: '1',
      content: 'hub 081234567890',
      sender_name: '081234567890',
      media: { caption: 'foto 081234567890', url: '/media/a.jpg' },
      payload_raw: {
        from: '6281234567890@c.us',
        media: { url: '/media/a.jpg', caption: 'hub 081234567890' },
        type: 'image',
      },
      quoted_message: { content: 'balas ke 081234567890' },
    };
    const out = sanitizeMessageForStaff(msg);
    expect(out.content).toBe('hub 0812345*****');
    expect(out.sender_name).toBe('0812345*****');
    expect(out.media.caption).toBe('foto 0812345*****');
    expect(out.quoted_message.content).toBe('balas ke 0812345*****');
    expect(out.payload_raw.from).toBeUndefined();
    expect(out.payload_raw.media.caption).toBe('hub 0812345*****');
    expect(out.payload_raw.type).toBe('image');
  });

  it('contact di top-level termaskir', () => {
    const msg = { content: 'hi', contact: { phone: '081234567890' }, payload_raw: {} };
    const out = sanitizeMessageForStaff(msg);
    expect(out.contact.phone).toBe('0812345*****');
  });

  it('tidak mutasi objek asli', () => {
    const msg = { content: '081234567890', payload_raw: { from: '6281@c.us', media: { url: '/a.jpg' } } };
    const orig = JSON.parse(JSON.stringify(msg));
    sanitizeMessageForStaff(msg);
    expect(msg).toEqual(orig);
  });
});

describe('sanitizeStaffHubPayload — SSE', () => {
  it('message.created: content/senderName/media/contact/payloadRaw termaskir', () => {
    const payload = {
      conversationId: 'c1',
      content: 'hub 081234567890',
      senderName: '081234567890',
      media: { caption: 'hub 081234567890' },
      contact: { phone: '081234567890' },
      payloadRaw: { from: '6281234567890@c.us', media: { url: '/a.jpg', caption: '081234567890' } },
    };
    const out = sanitizeStaffHubPayload(payload, 'message.created');
    expect(out.content).toBe('hub 0812345*****');
    expect(out.senderName).toBe('0812345*****');
    expect(out.media.caption).toBe('hub 0812345*****');
    expect(out.contact.phone).toBe('0812345*****');
    expect(out.payloadRaw.from).toBeUndefined();
    expect(out.payloadRaw.media.caption).toBe('0812345*****');
  });

  it('message.updated: content & JID di messageId termaskir', () => {
    const payload = {
      conversationId: 'c1',
      messageId: 'true_6281234567890@c.us_ABC123',
      waMessageId: '6281234567890@c.us',
      content: 'edit 081234567890',
    };
    const out = sanitizeStaffHubPayload(payload, 'message.updated');
    expect(out.content).toBe('edit 0812345*****');
    expect(out.messageId).toContain('*****');
    expect(out.messageId).not.toContain('6281234567890');
    expect(out.waMessageId).toBe('62812345*****@c.us');
  });

  it('tidak bocor JID di payloadRaw SSE', () => {
    const payload = {
      conversationId: 'c1',
      content: 'hi',
      payloadRaw: { _data: { key: { remoteJid: '6281234567890@c.us' } }, from: '6281234567890@c.us' },
    };
    const out = sanitizeStaffHubPayload(payload, 'message.created');
    expect(JSON.stringify(out)).not.toContain('6281234567890@c.us');
  });
});
