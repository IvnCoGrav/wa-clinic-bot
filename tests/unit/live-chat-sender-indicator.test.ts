import { describe, it, expect } from 'vitest';
import { resolveChatSenderIndicator } from '../../packages/admin-dashboard/src/utils/chatSenderIndicator';

describe('resolveChatSenderIndicator (Adversarial & Unit)', () => {
  it('mengidentifikasi pesan dari Pasien / Customer (INBOUND)', () => {
    const res = resolveChatSenderIndicator({
      id: 'msg-1',
      direction: 'INBOUND',
      content: 'Halo mau tanya harga paket massage',
      sender_type: 'CUSTOMER',
    });

    expect(res.kind).toBe('CUSTOMER');
    expect(res.isCustomer).toBe(true);
    expect(res.isAdmin).toBe(false);
    expect(res.isBot).toBe(false);
    expect(res.tooltip).toBe('Pesan dari Pasien');
  });

  it('mengidentifikasi pesan dari Saya / Admin (OUTBOUND non-bot)', () => {
    const res = resolveChatSenderIndicator({
      id: 'msg-2',
      direction: 'OUTBOUND',
      content: 'Halo Bunda, ada yang bisa dibantu?',
      sender_type: 'ADMIN',
      sender_name: 'Kak Sinta',
    });

    expect(res.kind).toBe('ADMIN');
    expect(res.isCustomer).toBe(false);
    expect(res.isAdmin).toBe(true);
    expect(res.isBot).toBe(false);
    expect(res.senderName).toBe('Kak Sinta');
    expect(res.tooltip).toBe('Pesan dari Saya / Admin (Kak Sinta)');
  });

  it('mengidentifikasi pesan dari Bidan / Staff sebagai Admin/Saya', () => {
    const res = resolveChatSenderIndicator({
      id: 'msg-3',
      direction: 'OUTBOUND',
      content: 'Bidan sedang OTW ya Bunda',
      sender_type: 'STAFF',
      sender_name: 'Bidan Thabita',
    });

    expect(res.kind).toBe('ADMIN');
    expect(res.isAdmin).toBe(true);
    expect(res.isBot).toBe(false);
    expect(res.tooltip).toBe('Pesan dari Saya / Admin (Bidan Thabita)');
  });

  it('mengidentifikasi pesan dari Bot AI (OUTBOUND BOT)', () => {
    const res = resolveChatSenderIndicator({
      id: 'msg-4',
      direction: 'OUTBOUND',
      content: 'Selamat datang di Kala Spa! Silakan pilih menu berikut.',
      sender_type: 'BOT',
    });

    expect(res.kind).toBe('BOT');
    expect(res.isCustomer).toBe(false);
    expect(res.isAdmin).toBe(false);
    expect(res.isBot).toBe(true);
    expect(res.tooltip).toBe('Pesan dari Bot AI');
  });

  it('mengidentifikasi pesan SYSTEM sebagai Bot', () => {
    const res = resolveChatSenderIndicator({
      id: 'msg-5',
      direction: 'OUTBOUND',
      content: 'Pengingat otomatis jadwal',
      sender_type: 'SYSTEM',
    });

    expect(res.kind).toBe('BOT');
    expect(res.isBot).toBe(true);
  });

  it('tahan terhadap data null / undefined / kosong (adversarial)', () => {
    const resNull = resolveChatSenderIndicator(null);
    expect(resNull.kind).toBe('UNKNOWN');
    expect(resNull.isCustomer).toBe(false);
    expect(resNull.isAdmin).toBe(false);
    expect(resNull.isBot).toBe(false);

    const resEmpty = resolveChatSenderIndicator({});
    expect(resEmpty.kind).toBe('UNKNOWN');

    const resNoDir = resolveChatSenderIndicator({ content: 'tes' });
    expect(resNoDir.kind).toBe('UNKNOWN');
  });

  it('toleran terhadap variasi penamaan field camelCase vs snake_case', () => {
    const resCamel = resolveChatSenderIndicator({
      direction: 'OUTBOUND',
      senderType: 'ADMIN',
      senderName: 'Admin Utama',
    });
    expect(resCamel.kind).toBe('ADMIN');
    expect(resCamel.senderName).toBe('Admin Utama');
    expect(resCamel.tooltip).toBe('Pesan dari Saya / Admin (Admin Utama)');
  });
});
