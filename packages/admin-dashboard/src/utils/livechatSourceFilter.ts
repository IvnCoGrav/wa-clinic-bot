/**
 * livechatSourceFilter.ts — gerbang deterministik mode sumber LiveChat (#160).
 *
 * Masalah: saat admin berada di filter Sandbox, event SSE dari pasien WA asli
 * (mode real) tetap memicu `loadChats(true)` berulang → UI berkedip (thrashing).
 * Sebaliknya, event sandbox saat filter real juga memicu reload tak perlu.
 *
 * Solusi: satu kontrak boolean murni berbasis `isSandboxTest` (state, bukan
 * pencocokan teks). Dipakai untuk memutuskan: (a) apakah event SSE layak
 * memicu reload daftar, (b) apakah chat aktif layak dipertahankan saat reset.
 *
 * Catatan: `all | unread | reservation` semuanya memuat mode "real".
 */

export type SourceFilter = 'all' | 'unread' | 'reservation' | 'sandbox';

/** Apakah item percakapan termasuk mode filter yang aktif. */
export function matchesSourceFilter(
  chat: { isSandboxTest?: boolean } | null | undefined,
  filter: SourceFilter
): boolean {
  const isSandbox = Boolean(chat?.isSandboxTest);
  return filter === 'sandbox' ? isSandbox : !isSandbox;
}

/**
 * Apakah event SSE layak memicu `loadChats(true)`.
 * Payload tanpa `isSandboxTest` dianggap mode real (fail-open ke perilaku lama).
 */
export function shouldReloadForSseEvent(
  payload: { isSandboxTest?: boolean } | null | undefined,
  filter: SourceFilter
): boolean {
  return matchesSourceFilter(payload, filter);
}

/**
 * Apakah chat yang sedang dibuka layak dipertahankan saat daftar di-reset
 * (mencegah "ghost chat": chat pasien real tetap tampil di panel saat filter sandbox).
 */
export function shouldPreserveActiveChat(
  chat: { isSandboxTest?: boolean } | null | undefined,
  filter: SourceFilter
): boolean {
  return matchesSourceFilter(chat, filter);
}

/**
 * Apakah refresh thread menargetkan percakapan yang SAMA dengan yang sudah tampil.
 * Bila sama → jangan kosongkan bubble (cegah flash spinner saat reconnect/refresh).
 */
export function isSameConversation(
  currentSelectedId: string | null | undefined,
  incomingId: string | null | undefined
): boolean {
  return Boolean(currentSelectedId) && currentSelectedId === incomingId;
}
