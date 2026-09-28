/**
 * waha-ctwa-referral.ts
 *
 * Single Source of Truth untuk ekstraksi metadata iklan Click-to-WhatsApp (CTWA)
 * dari payload webhook WAHA multi-device (Noweb/Baileys/GOWS).
 *
 * Mandat:
 * 1. Data-driven: seluruh field berasal dari payload mentah Meta/WAHA, bukan
 *    katalog kata kunci atau daftar brand yang di-hardcode.
 * 2. Fail-open: payload organik / rusak / primitif TIDAK boleh melempar exception;
 *    mengembalikan `undefined` agar alur webhook tetap berjalan.
 * 3. Struktur ekspor `WahaAdReferral` menjadi kontrak bersama atribusi iklan
 *    lintas WAHA & WABA (lihat NormalizedInboundMessage.referral & MatchAdClickParams.referral).
 */

import type { AdReferral } from './gateway.types';

export interface WahaAdReferral extends AdReferral {
  ctwaClid: string;
}

function firstString(...candidates: unknown[]): string | undefined {
  for (const c of candidates) {
    if (typeof c === 'string') {
      const trimmed = c.trim();
      if (trimmed) return trimmed;
    } else if (typeof c === 'number' && Number.isFinite(c)) {
      return String(c);
    }
  }
  return undefined;
}

/**
 * `ctwaClid` adalah token opaque Meta — WAJIB string non-kosong.
 * Angka/boolean/objek dianggap payload rusak (fail-open → undefined),
 * berbeda dari `sourceId` yang boleh numerik.
 */
function firstClidString(...candidates: unknown[]): string | undefined {
  for (const c of candidates) {
    if (typeof c === 'string') {
      const trimmed = c.trim();
      if (trimmed) return trimmed;
    }
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

/**
 * Mengumpulkan semua objek `contextInfo` yang mungkin membawa `externalAdReply`
 * dari berbagai variasi encoder WAHA (Noweb `_data`, Baileys `message`, root).
 */
function collectContextInfos(root: Record<string, any>): Record<string, any>[] {
  const data = asRecord(root._data);
  const message = asRecord(root.message);
  const dataMessage = asRecord(data.message);

  return [
    asRecord(root.contextInfo),
    asRecord(data.contextInfo),
    asRecord(message.extendedTextMessage?.contextInfo),
    asRecord(message.imageMessage?.contextInfo),
    asRecord(message.videoMessage?.contextInfo),
    asRecord(message.contextInfo),
    asRecord(dataMessage.extendedTextMessage?.contextInfo),
    asRecord(dataMessage.imageMessage?.contextInfo),
    asRecord(dataMessage.videoMessage?.contextInfo),
    asRecord(dataMessage.contextInfo),
  ];
}

/**
 * Menemukan objek `externalAdReply` pertama yang valid dari seluruh kandidat
 * contextInfo, lalu fallback ke lokasi root/_data secara langsung.
 */
function collectAdReplies(root: Record<string, any>, contextInfos: Record<string, any>[]): Record<string, any>[] {
  const data = asRecord(root._data);
  const candidates: Record<string, any>[] = [];

  for (const ctx of contextInfos) {
    const reply = asRecord(ctx.externalAdReply);
    if (Object.keys(reply).length > 0) candidates.push(reply);
  }

  const rootReply = asRecord(root.externalAdReply);
  if (Object.keys(rootReply).length > 0) candidates.push(rootReply);
  const dataReply = asRecord(data.externalAdReply);
  if (Object.keys(dataReply).length > 0) candidates.push(dataReply);

  return candidates;
}

/**
 * Ekstraksi metadata Click-to-WhatsApp (CTWA) dari payload WAHA multi-device.
 * Menangani struktur `contextInfo.externalAdReply` pada root, `_data`, maupun `message`.
 *
 * @returns `WahaAdReferral` bila `ctwaClid` valid; `undefined` untuk pesan organik.
 */
export function extractWahaAdReferral(payload: unknown): WahaAdReferral | undefined {
  const root = asRecord(payload);
  if (Object.keys(root).length === 0) return undefined;

  const contextInfos = collectContextInfos(root);
  const adReplies = collectAdReplies(root, contextInfos);

  const ctwaClid = firstClidString(
    ...adReplies.map((r) => r.ctwaClid),
    ...adReplies.map((r) => r.ctwa_clid),
    ...contextInfos.map((c) => c.ctwaClid),
    ...contextInfos.map((c) => c.ctwa_clid),
    root.ctwaClid,
    root.ctwa_clid
  );

  if (!ctwaClid) return undefined;

  const primaryCtx = contextInfos.find((c) => Object.keys(c).length > 0) || {};

  return {
    ctwaClid,
    sourceId: firstString(...adReplies.map((r) => r.sourceId), ...adReplies.map((r) => r.source_id)),
    sourceType:
      firstString(...adReplies.map((r) => r.sourceType), ...adReplies.map((r) => r.source_type)) ||
      firstString(primaryCtx.entryPointConversionSource) ||
      'ad',
    sourceApp:
      firstString(...adReplies.map((r) => r.sourceApp), ...adReplies.map((r) => r.source_app)) ||
      firstString(primaryCtx.entryPointConversionApp),
    sourceUrl: firstString(...adReplies.map((r) => r.sourceUrl), ...adReplies.map((r) => r.source_url)),
    headline: firstString(...adReplies.map((r) => r.title), ...adReplies.map((r) => r.headline)),
    body: firstString(
      ...adReplies.map((r) => r.body),
      ...adReplies.map((r) => r.description),
      ...adReplies.map((r) => r.subtitle)
    ),
  };
}
