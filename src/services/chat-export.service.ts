import { prisma } from '../db/client';
import fs from 'fs/promises';
import path from 'path';

// ============================================================================
// Daily Chat Export — ekspor percakapan harian ke file Markdown terstruktur
// agar mudah dianalisa AI (membedakan balasan BOT vs HUMAN_AGENT, melihat flag
// eskalasi/review/unknown). Data bisnis TIDAK di-hardcode; query selalu
// difilter tenant_id. Data QA/sandbox (is_sandbox_test=true) sengaja TIDAK
// diekspor supaya tidak mencemari analisa pelanggan asli.
// ============================================================================

export interface ExportMessage {
  id: string;
  direction: string;
  content: string;
  sender_type: string | null;
  sender_name: string | null;
  created_at: Date;
  delivery_status?: string | null;
  ai_score?: number | null;
  ai_reasoning?: string | null;
  ai_feedback?: string | null;
}

export interface ExportConversation {
  id: string;
  current_state: string;
  previous_state: string | null;
  is_human_handling: boolean;
  escalation_reason: string | null;
  consecutive_unknown_count: number;
  review_flagged: boolean;
  last_discussed_treatment: string | null;
  customer_phone: string;
  customer_name: string | null;
  customer_kelurahan: string | null;
  messages: ExportMessage[];
}

export interface ChatExportStats {
  date: string;
  totalConversations: number;
  totalMessages: number;
  humanHandled: number;
  escalated: number;
  flaggedReview: number;
}

export interface ChatExportResult {
  success: boolean;
  date: string;
  fileName: string;
  content: string;
  stats: ChatExportStats;
  error?: string;
}

/** Label peran untuk pembaca AI: USER = pelanggan, BOT = AI, HUMAN_AGENT = staf/manusia. */
export function roleLabel(senderType: string | null, senderName: string | null): string {
  const type = (senderType || '').toUpperCase();
  if (type === 'CUSTOMER') return 'USER';
  if (type === 'BOT') return 'BOT';
  if (type === 'ADMIN' || type === 'HUMAN' || type === 'STAFF' || type === 'AGENT') {
    return senderName ? `HUMAN_AGENT (${senderName})` : 'HUMAN_AGENT';
  }
  return senderType ? `SENDER_${type}` : 'UNKNOWN';
}

/** Format jam lokal HH:MM:SS untuk transkrip. */
export function formatTime(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/** Format tanggal lokal YYYY-MM-DD (default: hari ini). */
export function formatLocalDate(value: Date = new Date()): string {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Parse string tanggal YYYY-MM-DD ke rentang hari (UTC). null jika tidak valid. */
export function parseDateRange(dateStr: string): { start: Date; end: Date } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const start = new Date(`${dateStr}T00:00:00.000Z`);
  if (isNaN(start.getTime())) return null;
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { start, end };
}

/**
 * Pure function: render blok-blok percakapan (bagian body dari buildDailyChatMarkdown).
 * Dipisahkan agar dipakai ulang oleh generateRange (banyak hari dalam satu file).
 */
export function renderConversationBlocks(conversations: ExportConversation[], lines: string[]): void {
  conversations.forEach((conv, idx) => {
    lines.push('---');
    lines.push('');
    lines.push(`## Percakapan #${idx + 1} — ${conv.customer_phone || '-'}`);
    lines.push('');
    lines.push(`- **Customer**: ${conv.customer_name || '-'}`);
    lines.push(`- **Lokasi**: ${conv.customer_kelurahan || '-'}`);
    lines.push(
      `- **State**: ${conv.previous_state ? `${conv.previous_state} → ${conv.current_state}` : conv.current_state}`
    );
    lines.push(`- **Di-handle manusia**: ${conv.is_human_handling ? 'Ya' : 'Tidak'}`);
    lines.push(`- **Alasan eskalasi**: ${conv.escalation_reason || '-'}`);
    lines.push(`- **Pesan tidak dikenal beruntun**: ${conv.consecutive_unknown_count || 0}`);
    lines.push(`- **Flag review**: ${conv.review_flagged ? 'Ya' : 'Tidak'}`);
    lines.push('');
    lines.push('### Transkrip');
    lines.push('');

    if (conv.messages.length === 0) {
      lines.push('_Tidak ada pesan._');
      lines.push('');
      return;
    }

    conv.messages.forEach((msg) => {
      const role = roleLabel(msg.sender_type, msg.sender_name);
      const time = formatTime(msg.created_at);
      const aiTag = msg.ai_score != null ? ` (skor AI: ${msg.ai_score}/5)` : '';
      const statusTag =
        msg.delivery_status && msg.delivery_status !== 'sent' ? ` [${msg.delivery_status}]` : '';
      const prefix = `- [${time}] **${role}**${aiTag}${statusTag}:`;

      const parts = (msg.content || '')
        .split('\n')
        .map((p) => p.trim())
        .filter((p) => p !== '');
      if (parts.length === 0) {
        lines.push(`${prefix} _(pesan kosong / media)_`);
      } else {
        parts.forEach((p, pi) => {
          lines.push(pi === 0 ? `${prefix} ${p}` : `  > ${p}`);
        });
      }
    });
    lines.push('');
  });
}

/**
 * Pure function: bangun konten Markdown harian dari daftar percakapan terstruktur.
 * Dipisahkan agar mudah di-uji offline tanpa DB.
 */
export function buildDailyChatMarkdown(date: string, conversations: ExportConversation[]): ChatExportResult {
  const totalMessages = conversations.reduce((n, c) => n + c.messages.length, 0);
  const humanHandled = conversations.filter((c) => c.is_human_handling).length;
  const escalated = conversations.filter((c) => c.escalation_reason).length;
  const flaggedReview = conversations.filter((c) => c.review_flagged).length;

  const stats: ChatExportStats = {
    date,
    totalConversations: conversations.length,
    totalMessages,
    humanHandled,
    escalated,
    flaggedReview,
  };

  const lines: string[] = [];
  lines.push(`# Daily Chat Export — ${date}`);
  lines.push('');
  lines.push('> Diekspor otomatis untuk analisa AI. Satu blok per percakapan. Penanda peran:');
  lines.push('> `USER` = pelanggan, `BOT` = balasan otomatis AI, `HUMAN_AGENT` = staf/manusia.');
  lines.push('');
  lines.push(`Total percakapan: ${stats.totalConversations} | Total pesan: ${stats.totalMessages}`);
  lines.push(`Di-handle manusia: ${stats.humanHandled} | Dieskalasi: ${stats.escalated} | Ditandai review: ${stats.flaggedReview}`);
  lines.push('');

  if (conversations.length === 0) {
    lines.push('_Tidak ada percakapan pada tanggal ini._');
  }

  renderConversationBlocks(conversations, lines);

  const content = lines.join('\n').trimEnd() + '\n';
  return { success: true, date, fileName: `daily-chats-${date}.md`, content, stats };
}

export class ChatExportService {
  /** Direktori penyimpanan file ekspor (default storage/exports, sudah gitignored). */
  public getExportDir(): string {
    return process.env.CHAT_EXPORT_DIR || path.resolve(process.cwd(), 'storage', 'exports');
  }

  public fileNameFor(date: string): string {
    return `daily-chats-${date}.md`;
  }

  /**
   * Ambil data percakapan satu hari dari DB (tenant-aware, eksklusi sandbox).
   * Dipisahkan dari generateDay agar generateRange bisa memuat banyak hari lalu
   * merender SATU file Markdown gabungan.
   */
  private async loadDayData(
    tenantId: string,
    date: string
  ): Promise<{ date: string; conversations: ExportConversation[] }> {
    const range = parseDateRange(date);
    if (!range) {
      throw new Error('Tanggal tidak valid. Gunakan format YYYY-MM-DD.');
    }

    const messages = await (prisma.message as any).findMany({
      where: {
        tenant_id: tenantId,
        created_at: { gte: range.start, lte: range.end },
      },
      orderBy: { created_at: 'asc' },
      include: { conversation: { include: { customer: true } } },
    });

    // Skor LLM-as-judge: cari berdasarkan message_id dari pesan hari itu
    // (bukan rentang created_at evaluasi — evaluasi bisa berjalan setelah hari tsb).
    const messageIds = (messages || []).map((m: any) => m.id);
    let evalByMessage = new Map<string, { score: number | null; ai_reasoning: string | null; feedback: string | null }>();
    if (messageIds.length > 0) {
      try {
        const evaluations = await (prisma.aiEvaluation as any).findMany({
          where: { tenant_id: tenantId, message_id: { in: messageIds } },
          select: { message_id: true, score: true, ai_reasoning: true, feedback: true },
        });
        for (const e of evaluations || []) {
          if (e.message_id) {
            evalByMessage.set(e.message_id, {
              score: e.score ?? null,
              ai_reasoning: e.ai_reasoning ?? null,
              feedback: e.feedback ?? null,
            });
          }
        }
      } catch {
        // Evaluasi tidak wajib — lanjutkan tanpa skor.
      }
    }

    const convMap = new Map<string, ExportConversation>();
    for (const msg of messages || []) {
      const conv = msg.conversation;
      if (!conv) continue;
      const customer = conv.customer;
      // Jangan ekspor customer QA/sandbox & nomor dummy sandbox.
      if (!customer || customer.is_sandbox_test) continue;

      let exportConv = convMap.get(conv.id);
      if (!exportConv) {
        exportConv = {
          id: conv.id,
          current_state: conv.current_state,
          previous_state: conv.previous_state,
          is_human_handling: !!conv.is_human_handling,
          escalation_reason: conv.escalation_reason,
          consecutive_unknown_count: conv.consecutive_unknown_count || 0,
          review_flagged: !!conv.review_flagged,
          last_discussed_treatment: conv.last_discussed_treatment || null,
          customer_phone: customer.phone,
          customer_name: customer.name || null,
          customer_kelurahan: customer.kelurahan || null,
          messages: [],
        };
        convMap.set(conv.id, exportConv);
      }

      const aiEval = evalByMessage.get(msg.id);
      exportConv.messages.push({
        id: msg.id,
        direction: msg.direction,
        content: msg.content || '',
        sender_type: msg.sender_type || null,
        sender_name: msg.sender_name || null,
        created_at: new Date(msg.created_at),
        delivery_status: msg.delivery_status || null,
        ai_score: aiEval?.score ?? null,
        ai_reasoning: aiEval?.ai_reasoning ?? null,
        ai_feedback: aiEval?.feedback ?? null,
      });
    }

    return { date, conversations: Array.from(convMap.values()) };
  }

  /** Generate konten Markdown untuk satu hari dari DB (tenant-aware, eksklusi sandbox). */
  public async generateDay(tenantId: string, date: string): Promise<ChatExportResult> {
    const range = parseDateRange(date);
    if (!range) {
      return {
        success: false,
        date,
        fileName: this.fileNameFor(date),
        content: '',
        stats: this.emptyStats(date),
        error: 'Tanggal tidak valid. Gunakan format YYYY-MM-DD.',
      };
    }

    try {
      const { conversations } = await this.loadDayData(tenantId, date);
      return buildDailyChatMarkdown(date, conversations);
    } catch (err: any) {
      console.warn('[ChatExportService] generateDay error (DB offline?):', err?.message || err);
      return {
        success: false,
        date,
        fileName: this.fileNameFor(date),
        content: '',
        stats: this.emptyStats(date),
        error: err?.message || 'Gagal mengambil data chat.',
      };
    }
  }

  /**
   * Generate SATU file Markdown untuk rentang tanggal (startDate s/d endDate,
   * maksimal 31 hari). Per hari dirender sebagai seksi terpisah dengan statistik.
   */
  public async generateRange(tenantId: string, startDate: string, endDate: string): Promise<ChatExportResult> {
    const validDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(new Date(`${d}T00:00:00Z`).getTime());
    if (!validDate(startDate) || !validDate(endDate)) {
      return {
        success: false,
        date: `${startDate} s/d ${endDate}`,
        fileName: `daily-chats-${startDate}-to-${endDate}.md`,
        content: '',
        stats: this.emptyStats(`${startDate} s/d ${endDate}`),
        error: 'Format tanggal tidak valid. Gunakan YYYY-MM-DD.',
      };
    }
    if (startDate > endDate) {
      return {
        success: false,
        date: `${startDate} s/d ${endDate}`,
        fileName: `daily-chats-${startDate}-to-${endDate}.md`,
        content: '',
        stats: this.emptyStats(`${startDate} s/d ${endDate}`),
        error: 'Tanggal mulai (startDate) harus sebelum atau sama dengan tanggal akhir (endDate).',
      };
    }

    const days: string[] = [];
    const cursor = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${endDate}T00:00:00Z`);
    while (cursor <= end) {
      const y = cursor.getUTCFullYear();
      const m = String(cursor.getUTCMonth() + 1).padStart(2, '0');
      const d = String(cursor.getUTCDate()).padStart(2, '0');
      days.push(`${y}-${m}-${d}`);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    if (days.length > 31) {
      return {
        success: false,
        date: `${startDate} s/d ${endDate}`,
        fileName: `daily-chats-${startDate}-to-${endDate}.md`,
        content: '',
        stats: this.emptyStats(`${startDate} s/d ${endDate}`),
        error: 'Rentang maksimal 31 hari. Persempit rentang tanggal.',
      };
    }

    try {
      const perDay = await Promise.all(days.map((d) => this.loadDayData(tenantId, d)));

      const totalStats: ChatExportStats = {
        date: `${startDate} s/d ${endDate}`,
        totalConversations: 0,
        totalMessages: 0,
        humanHandled: 0,
        escalated: 0,
        flaggedReview: 0,
      };
      const lines: string[] = [];
      lines.push(`# Daily Chat Export — ${startDate} s/d ${endDate}`);
      lines.push('');
      lines.push('> Diekspor otomatis untuk analisa AI. Satu blok per percakapan. Penanda peran:');
      lines.push('> `USER` = pelanggan, `BOT` = balasan otomatis AI, `HUMAN_AGENT` = staf/manusia.');
      lines.push('');
      lines.push('| Hari | Percakapan | Pesan | Human | Eskalasi | Review |');
      lines.push('|---|---|---|---|---|---|');

      for (const day of perDay) {
        const msgs = day.conversations.reduce((n, c) => n + c.messages.length, 0);
        const human = day.conversations.filter((c) => c.is_human_handling).length;
        const esc = day.conversations.filter((c) => c.escalation_reason).length;
        const rev = day.conversations.filter((c) => c.review_flagged).length;
        totalStats.totalConversations += day.conversations.length;
        totalStats.totalMessages += msgs;
        totalStats.humanHandled += human;
        totalStats.escalated += esc;
        totalStats.flaggedReview += rev;
        lines.push(`| ${day.date} | ${day.conversations.length} | ${msgs} | ${human} | ${esc} | ${rev} |`);
      }

      lines.push('');
      lines.push(
        `**Total**: ${totalStats.totalConversations} percakapan | ${totalStats.totalMessages} pesan | ` +
          `${totalStats.humanHandled} di-handle manusia | ${totalStats.escalated} eskalasi | ${totalStats.flaggedReview} review`
      );
      lines.push('');

      if (totalStats.totalMessages === 0) {
        lines.push('_Tidak ada percakapan pada rentang tanggal ini._');
      }

      for (const day of perDay) {
        if (day.conversations.length === 0) continue;
        lines.push('');
        lines.push(`## Hari — ${day.date}`);
        lines.push('');
        renderConversationBlocks(day.conversations, lines);
      }

      const content = lines.join('\n').trimEnd() + '\n';
      const fileName =
        days.length === 1
          ? `daily-chats-${days[0]}.md`
          : `daily-chats-${days[0]}-to-${days[days.length - 1]}.md`;
      return { success: true, date: `${startDate} s/d ${endDate}`, fileName, content, stats: totalStats };
    } catch (err: any) {
      console.warn('[ChatExportService] generateRange error (DB offline?):', err?.message || err);
      return {
        success: false,
        date: `${startDate} s/d ${endDate}`,
        fileName: `daily-chats-${startDate}-to-${endDate}.md`,
        content: '',
        stats: this.emptyStats(`${startDate} s/d ${endDate}`),
        error: err?.message || 'Gagal mengambil data chat.',
      };
    }
  }

  /** Generate + tulis file ke disk (dipakai cron harian). */
  public async saveDayExport(tenantId: string, date: string): Promise<ChatExportResult> {
    const result = await this.generateDay(tenantId, date);
    if (!result.success) return result;
    const dir = this.getExportDir();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, result.fileName), result.content, 'utf-8');
    return result;
  }

  /** Daftar file ekspor yang sudah ada di disk (terbaru dulu). */
  public async listExports(): Promise<Array<{ fileName: string; date: string; rangeEnd?: string; sizeBytes: number; updatedAt: string }>> {
    const dir = this.getExportDir();
    try {
      const entries = await fs.readdir(dir);
      const files: Array<{ fileName: string; date: string; rangeEnd?: string; sizeBytes: number; updatedAt: string }> = [];
      for (const f of entries) {
        // daily-chats-YYYY-MM-DD.md (satu hari) atau daily-chats-YYYY-MM-DD-to-YYYY-MM-DD.md (rentang)
        const m = f.match(/^daily-chats-(\d{4}-\d{2}-\d{2})(?:-to-(\d{4}-\d{2}-\d{2}))?\.md$/);
        if (!m) continue;
        const stat = await fs.stat(path.join(dir, f));
        files.push({
          fileName: f,
          date: m[1],
          rangeEnd: m[2] || undefined,
          sizeBytes: stat.size,
          updatedAt: stat.mtime.toISOString(),
        });
      }
      files.sort((a, b) => b.date.localeCompare(a.date) || (b.rangeEnd || '').localeCompare(a.rangeEnd || ''));
      return files;
    } catch {
      return [];
    }
  }

  private emptyStats(date: string): ChatExportStats {
    return { date, totalConversations: 0, totalMessages: 0, humanHandled: 0, escalated: 0, flaggedReview: 0 };
  }
}

export const chatExportService = new ChatExportService();
