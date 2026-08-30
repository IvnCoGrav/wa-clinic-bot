import { describe, it, expect } from 'vitest';
import {
  parseAdminChatDistanceAndOngkir,
  parseIndonesianCurrencyText,
} from '../../src/utils/admin-chat-distance-parser';

describe('Admin Chat Distance & Ongkir Parser', () => {
  it('parses distance and promo ongkir from admin CS chat example', () => {
    const adminChat = 'Jika dilihat dari jaraknya kurang lebih 16km. Dari pricelist kami 10-20km ada tambahan ongkir 25.000 tetapi karna bulan ini ada promo, kami bisa kasih bunda ongkir menjadi 20.000 saja bunda. Jadi bisa ya bunda ☺️ Rencana mau treatment di hari apa bunda ?🤗';
    const parsed = parseAdminChatDistanceAndOngkir(adminChat);

    expect(parsed.isConfident).toBe(true);
    expect(parsed.distanceKm).toBe(16);
    expect(parsed.normalOngkir).toBe(25000);
    expect(parsed.ongkir).toBe(20000);
    expect(parsed.promoOngkir).toBe(5000);
  });

  it('parses decimal distance like "8.5 km" or "8,5 km"', () => {
    const chat1 = 'Untuk jaraknya sekitar 8.5 km ya bunda';
    const parsed1 = parseAdminChatDistanceAndOngkir(chat1);
    expect(parsed1.distanceKm).toBe(8.5);

    const chat2 = 'Jarak ke lokasi bunda 12,3 km, ongkir 15.000';
    const parsed2 = parseAdminChatDistanceAndOngkir(chat2);
    expect(parsed2.distanceKm).toBe(12.3);
    expect(parsed2.ongkir).toBe(15000);
  });

  it('parses informal currency abbreviations (20rb, 20k, 25 ribu)', () => {
    expect(parseIndonesianCurrencyText('20rb')).toBe(20000);
    expect(parseIndonesianCurrencyText('20k')).toBe(20000);
    expect(parseIndonesianCurrencyText('25 ribu')).toBe(25000);
    expect(parseIndonesianCurrencyText('20.000')).toBe(20000);
    expect(parseIndonesianCurrencyText('Rp 20.000')).toBe(20000);
  });

  it('returns null distance when chat is unrelated to distance or ongkir', () => {
    const generalChat = 'Baik bunda, untuk jadwal besok jam 10 pagi bersama Bidan Yusi ya.';
    const parsed = parseAdminChatDistanceAndOngkir(generalChat);
    expect(parsed.distanceKm).toBeNull();
    expect(parsed.ongkir).toBeNull();
    expect(parsed.isConfident).toBe(false);
  });
});
