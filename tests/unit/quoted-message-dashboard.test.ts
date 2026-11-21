import { describe, it, expect } from 'vitest';
import { extractQuotedMessage } from '../../packages/admin-dashboard/src/utils/quotedMessage';

describe('Dashboard Quoted Message Helper (Tugas 3.1)', () => {
  it('1. msg.quoted_message normalized -> terbaca dengan seluruh atribut', () => {
    const msg = {
      quoted_message: {
        id: 'qm1',
        wa_message_id: 'false_6281200000001@c.us_3EB01',
        direction: 'OUTBOUND',
        sender_name: 'Bidan Ratna',
        sender_type: 'ADMIN',
        content: 'Halo Bunda, mau tanya apa?',
      },
    };
    const result = extractQuotedMessage(msg);
    expect(result).toBeDefined();
    expect(result?.wa_message_id).toBe('false_6281200000001@c.us_3EB01');
    expect(result?.content).toBe('Halo Bunda, mau tanya apa?');
    expect(result?.sender_name).toBe('Bidan Ratna');
    expect(result?.direction).toBe('OUTBOUND');
    expect(result?.sender_type).toBe('ADMIN');
  });

  it('2. SSE camelCase msg.payloadRaw.quoted_message -> terbaca (regresi #365 realtime)', () => {
    const msg = {
      payloadRaw: {
        quoted_message: {
          id: 'qm2',
          wa_message_id: 'false_6281200000001@c.us_3EB02',
          direction: 'INBOUND',
          sender_name: 'Bunda Pasien',
          sender_type: 'CUSTOMER',
          content: 'Bisa jadwal hari Sabtu?',
        },
      },
    };
    const result = extractQuotedMessage(msg);
    expect(result).toBeDefined();
    expect(result?.wa_message_id).toBe('false_6281200000001@c.us_3EB02');
    expect(result?.content).toBe('Bisa jadwal hari Sabtu?');
    expect(result?.direction).toBe('INBOUND');
    expect(result?.sender_name).toBe('Bunda Pasien');
  });

  it('3. Legacy snake_case msg.payload_raw.quoted_message -> terbaca', () => {
    const msg = {
      payload_raw: {
        quoted_message: {
          wa_message_id: 'false_6281200000001@c.us_3EB03',
          content: 'Pricelist layanan',
          direction: 'OUTBOUND',
        },
      },
    };
    const result = extractQuotedMessage(msg);
    expect(result).toBeDefined();
    expect(result?.wa_message_id).toBe('false_6281200000001@c.us_3EB03');
    expect(result?.content).toBe('Pricelist layanan');
    expect(result?.direction).toBe('OUTBOUND');
  });

  it('4. Payload NOWEB mentah tanpa normalisasi (contextInfo) -> terbaca', () => {
    const msg = {
      payload_raw: {
        _data: {
          message: {
            extendedTextMessage: {
              text: 'Oke kak',
              contextInfo: {
                stanzaId: 'true_6281200000001@c.us_3EB0BOT',
                participant: '6289900000000@c.us',
                quotedMessage: {
                  conversation: 'Total biaya Rp 175.000',
                },
              },
            },
          },
        },
      },
    };
    const result = extractQuotedMessage(msg);
    expect(result).toBeDefined();
    expect(result?.wa_message_id).toBe('true_6281200000001@c.us_3EB0BOT');
    expect(result?.content).toBe('Total biaya Rp 175.000');
  });

  it('5. temp_ atau UUID tidak dijadikan wa_message_id (disanitasi menjadi null)', () => {
    const msgTemp = {
      quoted_message: {
        id: 'temp_1795220000994',
        wa_message_id: 'temp_1795220000994',
        content: 'pesan sementara',
      },
    };
    const resultTemp = extractQuotedMessage(msgTemp);
    expect(resultTemp).toBeDefined();
    expect(resultTemp?.content).toBe('pesan sementara');
    expect(resultTemp?.wa_message_id).toBeNull();

    const msgUuid = {
      quoted_message: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        wa_message_id: '123e4567-e89b-12d3-a456-426614174000',
        content: 'pesan uuid',
      },
    };
    const resultUuid = extractQuotedMessage(msgUuid);
    expect(resultUuid).toBeDefined();
    expect(resultUuid?.content).toBe('pesan uuid');
    expect(resultUuid?.wa_message_id).toBeNull();
  });

  it('6. Media quote tanpa URL tetap menghasilkan indikator media (mimeType/caption)', () => {
    const msgMediaNoUrl = {
      quoted_message: {
        content: '[IMAGE: Foto Ruam Bayi]',
        media: {
          mimeType: 'image/jpeg',
          caption: 'Foto Ruam Bayi',
        },
      },
    };
    const resultMedia = extractQuotedMessage(msgMediaNoUrl);
    expect(resultMedia).toBeDefined();
    expect(resultMedia?.media).toBeDefined();
    expect(resultMedia?.media?.mimeType).toBe('image/jpeg');
    expect(resultMedia?.media?.caption).toBe('Foto Ruam Bayi');
  });

  it('7. payloadRaw punya message DAN _data.message: quote di _data.message tetap terbaca', () => {
    const msg = {
      payloadRaw: {
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
      },
    };

    const result = extractQuotedMessage(msg);

    expect(result).toBeDefined();
    expect(result?.wa_message_id).toBe('true_6289900000000@c.us_BOT_QUOTE');
    expect(result?.content).toBe('Paket Kenari Hemat 3 sesi');
  });

  it('8. contextInfo root kosong tidak menghalangi contextInfo nested di _data.message', () => {
    const msg = {
      payloadRaw: {
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
      },
    };

    const result = extractQuotedMessage(msg);

    expect(result).toBeDefined();
    expect(result?.content).toBe('Promo Baby Spa 3x');
    expect(result?.wa_message_id).toBe('true_6289900000000@c.us_BOT_QUOTE_2');
  });

  it('9. stanzaId mentah tidak dipakai sebagai wa_message_id (konten tetap tampil)', () => {
    const msg = {
      payloadRaw: {
        _data: {
          message: {
            extendedTextMessage: {
              text: 'yang ini',
              contextInfo: {
                stanzaId: '3EB0RAWSTANZA1234567890',
                participant: '6289900000000@c.us',
                quotedMessage: { conversation: 'Paket 3 sesi' },
              },
            },
          },
        },
      },
    };

    const result = extractQuotedMessage(msg);

    expect(result).toBeDefined();
    expect(result?.content).toBe('Paket 3 sesi');
    expect(result?.wa_message_id).toBeNull();
  });
});
