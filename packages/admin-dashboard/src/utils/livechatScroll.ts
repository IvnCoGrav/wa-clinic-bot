/**
 * Scroll deterministik di dalam container pesan Live Chat.
 *
 * Jangan memakai `Element.scrollIntoView` untuk lompat ke pesan: pada iOS Safari
 * `scrollIntoView` dapat menggeser window / visual viewport saat keyboard terbuka,
 * sehingga shell chat tertinggal dan menyisakan area kosong. Helper ini hanya
 * mengubah posisi scroll container pesan (container-only).
 */

export const CHAT_SCROLL_CONTAINER_ATTR = 'data-chat-scroll-container';

/**
 * Pusatkan `target` di dalam `container` tanpa menyentuh scroll window.
 * Mengembalikan `false` bila container/target tidak valid atau target bukan
 * keturunan container.
 */
export function centerElementInScrollContainer(
  container: HTMLElement | null,
  target: HTMLElement | null,
  behavior: ScrollBehavior = 'auto',
): boolean {
  if (!container || !target || !container.contains(target)) return false;
  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const delta =
    targetRect.top - containerRect.top - (container.clientHeight - targetRect.height) / 2;
  container.scrollTo({ top: container.scrollTop + delta, behavior });
  return true;
}
