import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleLabelChatEvent } from '../../src/routes/webhook.route';
import { customerService } from '../../src/services/customer.service';
import { clearLabelCache, setCachedLidPhone } from '../../src/integrations/waha/label-cache';

/**
 * F8 / M01-08 — JID `@lid` adalah ID internal WhatsApp, BUKAN nomor telepon.
 * Label event untuk LID yang belum terpetakan TIDAK boleh membuat/menandai
 * customer dengan digit LID sebagai nomor HP.
 */

const labelEvent = (event: string, chatId: string, label: string | null) =>
  ({ event, session: 'default', payload: { chatId, label: label ? { name: label } : null } }) as any;

describe('F8 — identitas JID pada label event', () => {
  beforeEach(() => {
    clearLabelCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('LID tanpa pemetaan → setLabelFlags TIDAK dipanggil (anti entitas palsu)', async () => {
    const spy = vi.spyOn(customerService, 'setLabelFlags').mockResolvedValue(undefined as any);

    await handleLabelChatEvent(
      labelEvent('label.chat.added', '79903991054369@lid', 'hold'),
      'default-tenant'
    );

    expect(spy).not.toHaveBeenCalled();
  });

  it('LID yang sudah dipetakan → memakai nomor HP asli, bukan digit LID', async () => {
    setCachedLidPhone('79903991054369@lid', '6285794210526');
    const spy = vi.spyOn(customerService, 'setLabelFlags').mockResolvedValue(undefined as any);

    await handleLabelChatEvent(
      labelEvent('label.chat.added', '79903991054369@lid', 'hold'),
      'default-tenant'
    );

    expect(spy).toHaveBeenCalledWith('6285794210526', { isAdminLabeled: undefined, isHoldLabeled: true }, 'default-tenant');
    expect(spy).not.toHaveBeenCalledWith('79903991054369', expect.anything(), expect.anything());
  });

  it('JID nomor telepon tetap diproses seperti biasa', async () => {
    const spy = vi.spyOn(customerService, 'setLabelFlags').mockResolvedValue(undefined as any);

    await handleLabelChatEvent(
      labelEvent('label.chat.added', '628111222333@c.us', 'admin'),
      'default-tenant'
    );

    expect(spy).toHaveBeenCalledWith('628111222333', { isAdminLabeled: true, isHoldLabeled: undefined }, 'default-tenant');
  });

  it('JID grup/broadcast diabaikan (label bukan milik customer perorangan)', async () => {
    const spy = vi.spyOn(customerService, 'setLabelFlags').mockResolvedValue(undefined as any);

    await handleLabelChatEvent(
      labelEvent('label.chat.added', '120363000000000000@g.us', 'hold'),
      'default-tenant'
    );
    await handleLabelChatEvent(
      labelEvent('label.chat.added', 'status@broadcast', 'hold'),
      'default-tenant'
    );

    expect(spy).not.toHaveBeenCalled();
  });
});
