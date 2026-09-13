import { describe, it, expect, beforeEach } from 'vitest';
import { extractRealPhoneFromWahaPayload, normalizeWahaJid, parseJidType } from '../../src/utils/jid';
import { getCachedLidPhone, setCachedLidPhone, clearLabelCache } from '../../src/integrations/waha/label-cache';
import { wahaClient } from '../../src/integrations/waha/client';

describe('WAHA Multi-Device LID to Phone Resolution', () => {
  beforeEach(() => {
    clearLabelCache();
  });

  it('should extract real phone from _data.key.remoteJidAlt when from is a LID', () => {
    const payload = {
      id: 'false_216088545607703@lid_AC583D94C7B9E84E91C7624C4E44FCBB',
      from: '216088545607703@lid',
      chatId: '216088545607703@lid',
      body: 'Halo Bu Bidan, saya tertarik dengan layanan home-treatment',
      _data: {
        key: {
          id: 'AC583D94C7B9E84E91C7624C4E44FCBB',
          fromMe: false,
          remoteJid: '216088545607703@lid',
          remoteJidAlt: '6281230133633@s.whatsapp.net',
          addressingMode: 'lid',
        },
      },
    };

    const result = extractRealPhoneFromWahaPayload(payload);
    expect(result.phone).toBe('6281230133633');
    expect(result.resolvedJid).toBe('6281230133633@c.us');

    // Should also cache the LID mapping
    expect(getCachedLidPhone('216088545607703@lid')).toBe('6281230133633');
    expect(getCachedLidPhone('216088545607703')).toBe('6281230133633');
  });

  it('should extract real phone from _data.remoteJidAlt in outbound payload', () => {
    const payload = {
      id: 'true_216088545607703@lid_3EB0A7E824C96F58563AFD',
      from: '216088545607703@lid',
      fromMe: true,
      _data: {
        key: {
          id: '3EB0A7E824C96F58563AFD',
          fromMe: true,
          remoteJid: '216088545607703@lid',
          remoteJidAlt: '6281230133633@s.whatsapp.net',
        },
      },
    };

    const result = extractRealPhoneFromWahaPayload(payload);
    expect(result.phone).toBe('6281230133633');
    expect(result.resolvedJid).toBe('6281230133633@c.us');
  });

  it('should handle standard non-LID payload normally', () => {
    const payload = {
      id: 'false_6289620099380@c.us_ABC123',
      from: '6289620099380@c.us',
      chatId: '6289620099380@c.us',
      body: 'Halo',
    };

    const result = extractRealPhoneFromWahaPayload(payload);
    expect(result.phone).toBe('6289620099380');
    expect(result.resolvedJid).toBe('6289620099380@c.us');
  });

  it('should resolve active JID to real phone when cached LID is used', async () => {
    setCachedLidPhone('216088545607703', '6281230133633');

    const primaryJid = await wahaClient.resolvePrimaryJid('216088545607703@c.us');
    expect(primaryJid).toBe('6281230133633@c.us');
  });

  it('parseJidType: mengklasifikasikan domain JID secara presisi (Matt Pocock Domain Standard)', () => {
    expect(parseJidType('628123456789@c.us')).toBe('phone');
    expect(parseJidType('628123456789@s.whatsapp.net')).toBe('phone');
    expect(parseJidType('102649175314541@lid')).toBe('lid');
    expect(parseJidType('256606822854817@lid')).toBe('lid');
    expect(parseJidType('120363024819284@g.us')).toBe('group');
    expect(parseJidType('status@broadcast')).toBe('broadcast');
    expect(parseJidType('12036314@newsletter')).toBe('newsletter');
    expect(parseJidType('')).toBe('unknown');
    expect(parseJidType(null)).toBe('unknown');
  });

  it('Invarian Mutlak: Unresolved LID acak DILARANG dikembalikan sebagai nomor telepon palsu', () => {
    // Payload dari WhatsApp dengan LID baru tanpa metadata remoteJidAlt
    const payload = {
      id: 'false_102649175314541@lid_AB123456',
      from: '102649175314541@lid',
      chatId: '102649175314541@lid',
      body: 'Halo Bidan',
      _data: {
        key: {
          id: 'AB123456',
          fromMe: false,
          remoteJid: '102649175314541@lid',
          // TIDAK ADA remoteJidAlt
        },
      },
    };

    const result = extractRealPhoneFromWahaPayload(payload);
    // WAJIB mengembalikan phone kosong, BUKAN '102649175314541'
    expect(result.phone).toBe('');
    expect(result.resolvedJid).toBe('102649175314541@lid');
  });
});
