import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  parseCanonicalInboundMessage,
  extractQuotedMessageFromPayload,
} from '../../src/utils/canonical-message-normalizer';

describe('quoted-message-normalizer (Tugas 2.1)', () => {
  const fixturesDir = path.resolve(__dirname, '../fixtures/quoted');

  it('1. NOWEB teks reply: contextInfo di extendedTextMessage menghasilkan quoted outbound', () => {
    const raw = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, 'waha-noweb-inbound-text-reply.json'), 'utf-8')
    );
    const result = parseCanonicalInboundMessage(raw.payload, { customerPhone: '6281200000001' });

    expect(result.type).toBe('text');
    expect(result.content).toBe('Mau yang no 2 ya kak');
    expect(result.quoted).toBeDefined();
    expect(result.quoted?.wa_message_id).toBe('true_6281200000001@c.us_3EB0BOT111111111111');
    expect(result.quoted?.content).toContain('Halo Bunda, untuk tindik bayi ada 2 pilihan');
    expect(result.quoted?.direction).toBe('OUTBOUND');
    expect(result.quoted?.sender_type).toBe('ADMIN');
  });

  it('2. NOWEB gambar reply: contextInfo di imageMessage menghasilkan quoted dengan caption [IMAGE: ...]', () => {
    const raw = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, 'waha-noweb-inbound-image-reply.json'), 'utf-8')
    );
    const result = parseCanonicalInboundMessage(raw.payload, { customerPhone: '6281200000001' });

    expect(result.type).toBe('text');
    expect(result.content).toBe('Bisa untuk bayi usia 3 bulan?');
    expect(result.quoted).toBeDefined();
    expect(result.quoted?.wa_message_id).toBe('true_6281200000001@c.us_3EB0BOT222222222222');
    expect(result.quoted?.content).toBe('[IMAGE: Pricelist Layanan Homecare & Spa Bayi]');
    expect(result.quoted?.media?.caption).toBe('Pricelist Layanan Homecare & Spa Bayi');
    expect(result.quoted?.media?.mimeType).toBe('image/jpeg');
    expect(result.quoted?.direction).toBe('OUTBOUND');
  });

  it('3. NOWEB customer mengutip pesannya sendiri: direction = INBOUND dan sender_type = CUSTOMER', () => {
    const payload = {
      id: 'false_6281200000001@c.us_3EB0SELF',
      body: 'maksud saya yang ini kak',
      _data: {
        message: {
          extendedTextMessage: {
            text: 'maksud saya yang ini kak',
            contextInfo: {
              stanzaId: 'false_6281200000001@c.us_PREVMSG',
              participant: '6281200000001@c.us',
              quotedMessage: {
                conversation: 'anak saya demam sejak kemarin malam',
              },
            },
          },
        },
      },
    };

    const result = parseCanonicalInboundMessage(payload, { customerPhone: '6281200000001' });

    expect(result.quoted).toBeDefined();
    expect(result.quoted?.content).toBe('anak saya demam sejak kemarin malam');
    expect(result.quoted?.direction).toBe('INBOUND');
    expect(result.quoted?.sender_type).toBe('CUSTOMER');
    expect(result.quoted?.wa_message_id).toBe('false_6281200000001@c.us_PREVMSG');
  });

  it('4. WEBJS quote: _data.quotedMsg menghasilkan quote valid', () => {
    const payload = {
      body: 'oke deal',
      _data: {
        quotedMsg: {
          id: {
            _serialized: 'true_6281200000001@c.us_WEBJS_MSG_1',
            id: 'WEBJS_MSG_1',
          },
          body: 'Total biaya kunjungan Rp 150.000',
          fromMe: true,
        },
      },
    };

    const result = parseCanonicalInboundMessage(payload, { customerPhone: '6281200000001' });

    expect(result.quoted).toBeDefined();
    expect(result.quoted?.wa_message_id).toBe('true_6281200000001@c.us_WEBJS_MSG_1');
    expect(result.quoted?.content).toBe('Total biaya kunjungan Rp 150.000');
    expect(result.quoted?.direction).toBe('OUTBOUND');
    expect(result.quoted?.sender_type).toBe('ADMIN');
  });

  it('5. Payload tanpa quote: quoted adalah undefined tanpa regresi fungsi parser lainnya', () => {
    const payload = {
      id: 'false_6281200000001@c.us_NORMAL',
      body: 'Halo admin, selamat pagi',
    };

    const result = parseCanonicalInboundMessage(payload, { customerPhone: '6281200000001' });

    expect(result.type).toBe('text');
    expect(result.content).toBe('Halo admin, selamat pagi');
    expect(result.quoted).toBeUndefined();
  });

  it('6. temp_ atau UUID tidak pernah dijadikan wa_message_id', () => {
    const payloadTemp = {
      body: 'ini respon',
      _data: {
        quotedMsg: {
          id: 'temp_1795220000994',
          body: 'pesan sementara',
        },
      },
    };

    const resultTemp = parseCanonicalInboundMessage(payloadTemp);
    expect(resultTemp.quoted).toBeDefined();
    expect(resultTemp.quoted?.content).toBe('pesan sementara');
    expect(resultTemp.quoted?.wa_message_id).toBeUndefined();

    const payloadUuid = {
      body: 'ini respon uuid',
      _data: {
        quotedMsg: {
          id: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
          body: 'pesan internal db',
        },
      },
    };

    const resultUuid = parseCanonicalInboundMessage(payloadUuid);
    expect(resultUuid.quoted).toBeDefined();
    expect(resultUuid.quoted?.content).toBe('pesan internal db');
    expect(resultUuid.quoted?.wa_message_id).toBeUndefined();
  });

  it('7. extractQuotedMessageFromPayload mengekstrak dari berbagai tipe media quotedMessage (video, doc, audio, sticker)', () => {
    // Video
    const videoPayload = {
      message: {
        extendedTextMessage: {
          text: 'bagus',
          contextInfo: {
            stanzaId: 'false_6281200000001@c.us_VID',
            quotedMessage: {
              videoMessage: {
                caption: 'tutorial pijat kolik',
                mimetype: 'video/mp4',
              },
            },
          },
        },
      },
    };
    const quotedVideo = extractQuotedMessageFromPayload(videoPayload);
    expect(quotedVideo?.content).toBe('[VIDEO: tutorial pijat kolik]');
    expect(quotedVideo?.media?.caption).toBe('tutorial pijat kolik');

    // Document
    const docPayload = {
      message: {
        extendedTextMessage: {
          text: 'sudah dibaca',
          contextInfo: {
            stanzaId: 'false_6281200000001@c.us_DOC',
            quotedMessage: {
              documentMessage: {
                fileName: 'buku_kia.pdf',
                mimetype: 'application/pdf',
              },
            },
          },
        },
      },
    };
    const quotedDoc = extractQuotedMessageFromPayload(docPayload);
    expect(quotedDoc?.content).toBe('[DOCUMENT: buku_kia.pdf]');
    expect(quotedDoc?.media?.fileName).toBe('buku_kia.pdf');

    // Audio / Voice Note
    const pttPayload = {
      message: {
        extendedTextMessage: {
          text: 'iya betul',
          contextInfo: {
            stanzaId: 'false_6281200000001@c.us_PTT',
            quotedMessage: {
              audioMessage: {
                ptt: true,
                mimetype: 'audio/ogg; codecs=opus',
              },
            },
          },
        },
      },
    };
    const quotedPtt = extractQuotedMessageFromPayload(pttPayload);
    expect(quotedPtt?.content).toBe('[VOICE_NOTE]');
    expect(quotedPtt?.media?.isPtt).toBe(true);

    // Sticker
    const stickerPayload = {
      message: {
        extendedTextMessage: {
          text: 'lucu',
          contextInfo: {
            stanzaId: 'false_6281200000001@c.us_STK',
            quotedMessage: {
              stickerMessage: {
                mimetype: 'image/webp',
              },
            },
          },
        },
      },
    };
    const quotedSticker = extractQuotedMessageFromPayload(stickerPayload);
    expect(quotedSticker?.content).toBe('[STICKER]');
    expect(quotedSticker?.media?.isSticker).toBe(true);
  });

  it('8. payload memiliki message DAN _data.message: contextInfo di _data tetap terbaca', () => {
    const payload = {
      id: 'false_6281200000001@c.us_INCOMING',
      body: 'Mau yang ini kak',
      // Versi ringkas di root `message` (tanpa contextInfo)
      message: { conversation: 'Mau yang ini kak' },
      _data: {
        message: {
          extendedTextMessage: {
            text: 'Mau yang ini kak',
            contextInfo: {
              stanzaId: 'true_6289900000000@c.us_BOT_QUOTE',
              participant: '6289900000000@c.us',
              quotedMessage: {
                conversation: 'Paket Kenari Hemat 3 sesi',
              },
            },
          },
        },
      },
    };

    const result = parseCanonicalInboundMessage(payload, { customerPhone: '6281200000001' });

    expect(result.quoted).toBeDefined();
    expect(result.quoted?.wa_message_id).toBe('true_6289900000000@c.us_BOT_QUOTE');
    expect(result.quoted?.content).toBe('Paket Kenari Hemat 3 sesi');
    expect(result.quoted?.direction).toBe('OUTBOUND');
  });

  it('9. contextInfo root kosong tidak menghalangi contextInfo nested di _data.message', () => {
    const payload = {
      id: 'false_6281200000001@c.us_INCOMING2',
      body: 'Yang ini ya',
      // Root contextInfo hanya membawa stanzaId/metadata lain (bukan quote)
      contextInfo: { stanzaId: 'root-stanza-bukan-quote', externalAdReply: { title: 'Promo' } },
      message: { conversation: 'Yang ini ya' },
      _data: {
        message: {
          extendedTextMessage: {
            text: 'Yang ini ya',
            contextInfo: {
              stanzaId: 'true_6289900000000@c.us_BOT_QUOTE_2',
              participant: '6289900000000@c.us',
              quotedMessage: { conversation: 'Promo Baby Spa 3x' },
            },
          },
        },
      },
    };

    const result = parseCanonicalInboundMessage(payload, { customerPhone: '6281200000001' });

    expect(result.quoted).toBeDefined();
    expect(result.quoted?.content).toBe('Promo Baby Spa 3x');
    expect(result.quoted?.wa_message_id).toBe('true_6289900000000@c.us_BOT_QUOTE_2');
  });

  it('10. stanzaId mentah tidak dipalsukan menjadi wa_message_id (konten tetap tersimpan)', () => {
    const payload = {
      id: 'false_6281200000001@c.us_INCOMING3',
      body: 'yang ini',
      _data: {
        message: {
          extendedTextMessage: {
            text: 'yang ini',
            contextInfo: {
              // Baileys kadang memberi stanza mentah tanpa prefix serialized.
              stanzaId: '3EB0RAWSTANZA1234567890',
              participant: '6289900000000@c.us',
              quotedMessage: { conversation: 'Paket 3 sesi' },
            },
          },
        },
      },
    };

    const result = parseCanonicalInboundMessage(payload, { customerPhone: '6281200000001' });

    expect(result.quoted).toBeDefined();
    expect(result.quoted?.content).toBe('Paket 3 sesi');
    expect(result.quoted?.wa_message_id).toBeUndefined();
  });
});
