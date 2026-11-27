import { customerService } from '../../services/customer.service';
import { invalidateCachedLabels } from '../../integrations/waha/label-cache';
import { parseJidType, normalizeWahaJid, extractRealPhoneFromWahaPayload } from '../../utils/jid';
import type { WahaWebhookEvent } from '../../integrations/waha/types';

/**
 * Handler event label.chat.added / label.chat.deleted dari WAHA.
 *
 * Meng-update kolom Customer.is_admin_labeled / is_hold_labeled (best-effort)
 * supaya jalur pesan masuk bisa membaca status label dari DB tanpa HTTP call
 * ke WAHA. Label lain di-cache-invalidate supaya fallback getChatLabels segar.
 *
 * M01-08: JID `@lid` adalah ID internal WhatsApp; digit-nya BUKAN nomor HP.
 * Hanya JID bertipe `phone` (atau LID yang sudah dipetakan) yang boleh menandai
 * customer — mencegah pembuatan entitas pelanggan palsu dari LID.
 */
export async function handleLabelChatEvent(event: WahaWebhookEvent, tenantId: string): Promise<void> {
  try {
    const payload: any = event.payload;
    const chatId: string | undefined = payload?.chatId;
    const labelName: string | undefined = payload?.label?.name || payload?.labelName;
    if (!chatId || !labelName) return;

    const jidType = parseJidType(chatId);
    let phone = '';
    if (jidType === 'phone') {
      phone = normalizeWahaJid(chatId);
    } else if (jidType === 'lid') {
      phone = extractRealPhoneFromWahaPayload({ chatId }).phone;
      if (!phone) {
        console.warn(
          `[LABEL EVENT] JID LID ${chatId} belum terpetakan ke nomor HP — label "${labelName}" TIDAK ditulis ke customer (cegah entitas palsu).`
        );
        invalidateCachedLabels(chatId);
        return;
      }
    } else {
      // group/broadcast/newsletter: label bukan milik customer perorangan.
      invalidateCachedLabels(chatId);
      return;
    }
    if (!phone) return;

    const lower = labelName.toLowerCase();
    if (lower !== 'admin' && lower !== 'hold') {
      invalidateCachedLabels(chatId);
      return;
    }

    const isAdded = event.event === 'label.chat.added';
    let attempts = 0;
    while (attempts < 3) {
      try {
        await customerService.setLabelFlags(
          phone,
          {
            isAdminLabeled: lower === 'admin' ? isAdded : undefined,
            isHoldLabeled: lower === 'hold' ? isAdded : undefined,
          },
          tenantId
        );
        break;
      } catch (e: any) {
        attempts++;
        if (attempts >= 3) throw e;
        await new Promise((r) => setTimeout(r, 100 * attempts));
      }
    }
    invalidateCachedLabels(chatId);
  } catch (err: any) {
    console.warn(`[LABEL EVENT] Failed to process label event ${event.event}:`, err.message);
  }
}
