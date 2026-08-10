import { describe, it, expect } from 'vitest';
import { isLocationQueryMessage } from '../../src/state-machine/utils/location-query';
import { WhatsAppIncomingMessage } from '../../src/integrations/whatsapp/types';

function createDummyTextMessage(body: string): WhatsAppIncomingMessage {
  return {
    id: 'msg-123',
    from: '628123456789',
    type: 'text',
    timestamp: Date.now(),
    text: { body },
  };
}

describe('Location Query Detection & Text Cleaning (10 Edge Cases Test)', () => {
  it('Case 1: Greeting + ke + location + price question', () => {
    const msg = createDummyTextMessage('halo, ke rungkut kidul berapa ya');
    expect(isLocationQueryMessage(msg, msg.text!.body!)).toBe(true);
  });

  it('Case 2: "saya di" + location + "bund, berapa ya"', () => {
    const msg = createDummyTextMessage('saya di rungkut kidul bund, berapa ya');
    expect(isLocationQueryMessage(msg, msg.text!.body!)).toBe(true);
  });

  it('Case 3: "ongkir ke" + location + abbreviation', () => {
    const msg = createDummyTextMessage('ongkir ke waru brp min');
    expect(isLocationQueryMessage(msg, msg.text!.body!)).toBe(true);
  });

  it('Case 4: Greeting + "kalau ke" + location + question', () => {
    const msg = createDummyTextMessage('bunda, kalau ke sidoarjo ongkirnya berapa?');
    expect(isLocationQueryMessage(msg, msg.text!.body!)).toBe(true);
  });

  it('Case 5: Greeting + "tarif ke kecamatan" + location', () => {
    const msg = createDummyTextMessage('permisi kak, mau tanya tarif ke kecamatan gubeng');
    expect(isLocationQueryMessage(msg, msg.text!.body!)).toBe(true);
  });

  it('Case 6: Islamic greeting + "rumah saya di kelurahan" + location', () => {
    const msg = createDummyTextMessage('assalamualaikum, rumah saya di kelurahan medokan ayu');
    expect(isLocationQueryMessage(msg, msg.text!.body!)).toBe(true);
  });

  it('Case 7: Greeting + change address keyword "ganti alamat ke"', () => {
    const msg = createDummyTextMessage('pagi min, ganti alamat ke rungkut lor');
    expect(isLocationQueryMessage(msg, msg.text!.body!)).toBe(true);
  });

  it('Case 8: [Negative Test] Pure treatment price question without location', () => {
    const msg = createDummyTextMessage('pijat hamil berapa ya min?');
    expect(isLocationQueryMessage(msg, msg.text!.body!)).toBe(false);
  });

  it('Case 9: [Negative Test] Service capability question ("di rumah")', () => {
    const msg = createDummyTextMessage('bisa pijat laktasi di rumah?');
    expect(isLocationQueryMessage(msg, msg.text!.body!)).toBe(false);
  });

  it('Case 10: [Negative Test] Operating hours / schedule question', () => {
    const msg = createDummyTextMessage('apakah buka hari minggu?');
    expect(isLocationQueryMessage(msg, msg.text!.body!)).toBe(false);
  });
});
