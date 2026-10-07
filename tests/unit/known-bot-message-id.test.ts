import { describe, it, expect } from 'vitest';
import { messageService } from '../../src/services/message.service';

/**
 * F5 — Ledger wa_message_id pesan bot sebagai penentu UTAMA bot-vs-admin.
 * Mencegah gema bot salah dikategorikan sebagai balasan admin (bot membisu
 * sendiri) atau sebaliknya balasan admin dikira gema (bot menyela CS).
 */
describe('F5 — ledger wa_message_id bot', () => {
  it('pesan bot yang terdaftar dikenali; yang tidak terdaftar tidak', () => {
    messageService.registerKnownBotMessageId('waid_bot_1', 'default-tenant');
    expect(messageService.isKnownBotMessageId('waid_bot_1', 'default-tenant')).toBe(true);
    expect(messageService.isKnownBotMessageId('waid_admin_x', 'default-tenant')).toBe(false);
  });

  it('tenant berbeda tidak cocok (anti salah-kategorikan lintas tenant)', () => {
    messageService.registerKnownBotMessageId('waid_bot_2', 'tenant-a');
    expect(messageService.isKnownBotMessageId('waid_bot_2', 'tenant-b')).toBe(false);
    expect(messageService.isKnownBotMessageId('waid_bot_2', 'tenant-a')).toBe(true);
  });

  it('id kosong selalu false', () => {
    expect(messageService.isKnownBotMessageId('', 'default-tenant')).toBe(false);
  });
});
