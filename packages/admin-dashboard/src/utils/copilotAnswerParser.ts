/**
 * copilotAnswerParser.ts — Parser deterministik untuk blok jawaban AI Copilot.
 *
 * Murni, tanpa DOM, mengklasifikasi teks markdown terstruktur dari model:
 * - Heading: `##`, `###`, `####` → heading bersih tanpa `#`
 * - Baris data: `1. Nama — status · [Buka Chat]` → row dengan aksi deep-link
 * - Daftar biasa: `- item` → list
 * - Paragraf: teks narasi → paragraph
 *
 * Tidak memutilasi teks di tengah kalimat. Fallback aman ke teks asli.
 */

export type CopilotBlock =
  | { type: 'heading'; text: string }
  | { type: 'row'; name: string; status: string; detail?: string; conversationId?: string }
  | { type: 'list'; text: string; conversationId?: string }
  | { type: 'paragraph'; text: string };

export const COPILOT_MAX_VISIBLE_ROWS = 8;

/** Peta deterministik navigasi tabel untuk data yang terlalu panjang (>20 baris). */
export const COPILOT_TOOL_PAGE: Record<string, { path: string; label: string }> = {
  query_followups: { path: '/admin/follow-ups', label: 'Buka halaman Follow-up' },
  query_reservations_by_filter: { path: '/admin/reservations', label: 'Buka halaman Reservasi' },
  query_stalled_inquiries: { path: '/admin/reservations', label: 'Buka halaman Reservasi' },
  query_unscheduled_prospects: { path: '/admin/reservations', label: 'Buka halaman Reservasi' },
  query_unreplied_chats: { path: '/admin/live-chat', label: 'Buka Live Chat' },
};

const MARKDOWN_LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/g;

/** Ekstrak conversationId hanya dari URL internal /admin/live-chat (anti open-redirect). */
export function extractLiveChatConversationId(url: string): string | undefined {
  if (!url || typeof url !== 'string' || !url.startsWith('/admin/live-chat')) {
    return undefined;
  }
  try {
    const qIndex = url.indexOf('?');
    if (qIndex === -1) return undefined;
    const params = new URLSearchParams(url.slice(qIndex));
    const convId = params.get('conversationId') || params.get('id');
    return convId ? convId.trim() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Pisahkan link kanonis Live Chat pertama dari teks.
 * Hanya link kanonis pertama yang dicabut menjadi conversationId; link kedua atau link eksternal tetap dipertahankan sebagai teks.
 */
export function splitInlineLink(text: string): { text: string; conversationId?: string } {
  if (!text || typeof text !== 'string') return { text: '' };

  let firstMatch: { index: number; length: number; conversationId: string } | null = null;
  const re = new RegExp(MARKDOWN_LINK_RE.source, 'g');
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    const url = m[2];
    const convId = extractLiveChatConversationId(url);
    if (convId) {
      firstMatch = {
        index: m.index,
        length: m[0].length,
        conversationId: convId,
      };
      break;
    }
  }

  if (!firstMatch) {
    return { text };
  }

  // Angkat tautan Live Chat pertama, bersihkan pemisah gantung di sekitarnya jika ada
  const before = text.slice(0, firstMatch.index);
  const after = text.slice(firstMatch.index + firstMatch.length);
  const remaining = `${before}${after}`.trim();

  return {
    text: remaining,
    conversationId: firstMatch.conversationId,
  };
}

/** Regex pemisah segmen row: em-dash, en-dash, middle dot, atau tanda strip bertoleransi spasi */
const SEPARATOR_RE = /\s*[—–·]\s*|\s+-\s+/;

/**
 * Parsing teks jawaban Copilot menjadi blok-blok terstruktur yang siap dirender.
 */
export function parseCopilotAnswer(answer: string): CopilotBlock[] {
  if (!answer || typeof answer !== 'string') return [];

  const normalized = answer.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const blocks: CopilotBlock[] = [];

  for (let rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // 1. Heading (#, ##, ###, ####)
    const headingMatch = line.match(/^#{1,4}\s+(.*)$/);
    if (headingMatch) {
      const headingText = headingMatch[1].trim();
      if (headingText) {
        blocks.push({ type: 'heading', text: headingText });
        continue;
      }
    }

    // 2. Kandidat List Item atau Row data
    const listMatch = line.match(/^[-*]\s+(.*)$/) || line.match(/^\d+\.\s+(.*)$/);
    if (listMatch) {
      const lineContent = listMatch[1].trim();
      const { text: cleanedText, conversationId } = splitInlineLink(lineContent);

      // Baris diklasifikasikan sebagai `row` jika memiliki link Live Chat kanonis DAN pemisah segmen
      if (conversationId && SEPARATOR_RE.test(cleanedText)) {
        // Bersihkan tanda pemisah di ujung sebelum pemecahan segmen
        const trimmedForSplit = cleanedText.replace(/^[—–·\s-]+|[—–·\s-]+$/g, '').trim();
        const segments = trimmedForSplit.split(SEPARATOR_RE).map((s) => s.trim()).filter(Boolean);

        if (segments.length >= 2 && segments[0] && segments[1]) {
          // Bersihkan pembungkus **bold** di awal & akhir nama jika ada
          const name = segments[0].replace(/^\*\*|\*\*$/g, '').trim();
          const status = segments[1];
          const detail = segments.slice(2).join(' · ') || undefined;

          blocks.push({
            type: 'row',
            name,
            status,
            detail,
            conversationId,
          });
          continue;
        }
      }

      // Jika bukan row terstruktur lengkap, masukkan sebagai list biasa
      blocks.push({
        type: 'list',
        text: lineContent,
        conversationId,
      });
      continue;
    }

    // 3. Paragraf biasa
    blocks.push({
      type: 'paragraph',
      text: line,
    });
  }

  // Fallback aman: bila ada input tapi tidak ada blok terurai
  if (blocks.length === 0 && answer.trim().length > 0) {
    blocks.push({ type: 'paragraph', text: answer });
  }

  return blocks;
}
