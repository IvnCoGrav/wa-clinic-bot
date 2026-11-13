/**
 * Satu gelembung pesan di panel chat staf, termasuk pemisah tanggal, kutipan,
 * share location, voice note, gambar, dan status pengiriman.
 *
 * Komponen ini murni tampilan: semua aksi dikirim lewat callback, sehingga
 * aturan edit/revoke tetap dipegang halaman induk.
 */
import React from 'react';
import {
  AlertCircle,
  Ban,
  Bot,
  Check,
  CheckCheck,
  ExternalLink,
  MapPin,
  PenLine,
  Trash2,
  User,
  UserCheck,
} from 'lucide-react';
import { MediaImage } from '../../components/common/MediaImage';
import { VoiceNotePlayer } from '../../components/common/VoiceNotePlayer';
import {
  extractAudio,
  extractImageCaption,
  extractLocation,
  extractMedia,
  maskPhoneInTextClient,
  resolveMessageDisplayText,
} from '../../utils/mediaExtractor';
import {
  formatChatDateSeparatorWib,
  formatWib,
  formatWibTime,
  isDifferentDayWib,
} from '../../utils/dateWib';
import { ChatMessage } from './staffChatTypes';

interface StaffChatBubbleProps {
  msg: ChatMessage;
  prevCreatedAt: string | null;
  customerName: string | null;
  staffName?: string | null;
  isSupervisor: boolean;
  supportsEdit: boolean;
  supportsRevoke: boolean;
  revokingId: string | null;
  onStartEdit: (msg: ChatMessage) => void;
  onRevoke: (msg: ChatMessage) => void;
  onScrollToBottom: () => void;
}

/**
 * Ekstraksi quoted_message dari berbagai bentuk payload_raw, dengan sanitasi
 * PII terapis (maskPhoneInTextClient) bila pengguna bukan supervisor.
 */
function extractQuotedMessage(msg: ChatMessage, maskPhone = true): NonNullable<ChatMessage['quoted_message']> | null {
  const mask = (s: string): string => (maskPhone ? maskPhoneInTextClient(s) : s);
  const direct = (msg as any).quoted_message;
  if (direct && (direct.content || direct.media)) {
    const sanitized: any = { ...direct };
    if (typeof sanitized.content === 'string' && sanitized.content) sanitized.content = mask(sanitized.content);
    if (typeof sanitized.sender_name === 'string' && sanitized.sender_name) {
      sanitized.sender_name = mask(sanitized.sender_name);
    }
    if (sanitized.media && typeof sanitized.media.caption === 'string') {
      sanitized.media = { ...sanitized.media, caption: mask(sanitized.media.caption) };
    }
    return sanitized;
  }
  const pr = (msg as any).payload_raw;
  if (!pr) return null;
  const q = pr.quoted_message || pr.quotedMessage || pr.quoted || pr.reply_to_message || pr.quotedMsg;
  if (q && (q.content || q.media || q.text)) {
    return {
      id: q.id || q.wa_message_id || q.waMessageId,
      wa_message_id: q.wa_message_id || q.waMessageId || q.id,
      sender_name: q.sender_name || q.senderName || q.sender
        ? mask(String(q.sender_name || q.senderName || q.sender))
        : null,
      sender_type: q.sender_type || q.senderType || null,
      direction: q.direction || q.dir || undefined,
      content: mask(q.content || q.text || q.caption || ''),
      media: q.media
        ? { ...q.media, caption: q.media.caption ? mask(String(q.media.caption)) : undefined }
        : undefined,
    };
  }
  return null;
}

export const StaffChatBubble: React.FC<StaffChatBubbleProps> = ({
  msg,
  prevCreatedAt,
  customerName,
  staffName,
  isSupervisor,
  supportsEdit,
  supportsRevoke,
  revokingId,
  onStartEdit,
  onRevoke,
  onScrollToBottom,
}) => {
  if (!msg || typeof msg !== 'object') return null;

  const isInbound = msg.direction === 'INBOUND';
  const isBot = !isInbound && msg.sender_type === 'BOT';
  const isStaff = !isInbound && msg.sender_type === 'STAFF';
  const media = extractMedia(msg);
  const quotedMsg = extractQuotedMessage(msg, !isSupervisor);
  const locData = extractLocation(msg);
  const audioData = extractAudio(msg);
  const audioUrl = audioData?.url || null;
  const isRevoked = !!(msg.is_revoked || (msg as any).payload_raw?.is_revoked || (msg as any).isRevoked);
  const isLocationMsg = !!locData;
  const isAudioMsg = !!audioUrl && !isRevoked;
  const isValidDate = !!msg.created_at && !isNaN(new Date(msg.created_at).getTime());
  const timeStr = isValidDate ? formatWibTime(msg.created_at) : '';
  const fullDateTitle = (() => {
    try {
      return isValidDate
        ? formatWib(msg.created_at, {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Asia/Jakarta',
          }) + ' WIB'
        : '';
    } catch {
      return '';
    }
  })();
  const isDifferentDay = isValidDate && isDifferentDayWib(msg.created_at, prevCreatedAt || null);
  const separatorLabel = isValidDate ? formatChatDateSeparatorWib(msg.created_at) : '';

  return (
    <>
      {isDifferentDay && separatorLabel && (
        <div className="flex justify-center my-1.5">
          <div className="bg-surface text-ink-2 text-[11px] font-medium px-3 py-1 rounded-lg text-center shadow-xs border border-divider dark:border-divider">
            {separatorLabel}
          </div>
        </div>
      )}
      <div className={`flex flex-col ${isInbound ? 'items-start' : 'items-end'} animate-popIn`}>
        {/* Sender Label Tag */}
        <div className="text-[10px] text-ink-2 mb-0.5 px-1.5 flex items-center space-x-1" title={fullDateTitle}>
          {isInbound ? (
            <>
              <User size={10} className="text-ink-2" />
              <span className="font-medium text-ink">{customerName || 'Customer'}</span>
            </>
          ) : isBot ? (
            <>
              <Bot size={10} className="text-accent" />
              <span className="font-medium text-accent">Bot Asisten Klinik</span>
            </>
          ) : isStaff ? (
            <>
              <UserCheck size={10} className="text-info" />
              <span className="font-medium text-info">{msg.sender_name || staffName || 'Terapis'}</span>
            </>
          ) : (
            <span className="font-medium text-ink-2">Admin</span>
          )}
          <span>•</span>
          <span title={fullDateTitle}>{timeStr} WIB</span>
        </div>

        {/* WhatsApp Speech Bubble */}
        <div
          className={`relative group max-w-[85%] sm:max-w-[70%] p-3 rounded-2xl text-xs leading-relaxed shadow-xs transition ${
            isRevoked
              ? 'bg-fill-1 text-ink-2 border border-divider italic'
              : isInbound
                ? 'bg-surface text-ink rounded-tl-xs border border-divider'
                : isBot
                  ? 'bg-accent-soft text-ink rounded-tr-xs border border-accent/30'
                  : 'bg-bubble-out text-ink rounded-tr-xs border border-accent/20'
          }`}
        >
          {isRevoked ? (
            <div className="flex items-center gap-1.5 py-0.5 text-ink-2">
              <Ban size={12} className="text-ink-3 shrink-0" />
              <span className="italic">Pesan ini telah ditarik</span>
            </div>
          ) : (
            <>
              {/* Quoted Message Preview */}
              {quotedMsg && (
                <div className="mb-2 p-2 rounded-lg border-l-[3px] border-accent bg-black/[0.04] text-[11px] leading-snug">
                  <p className="font-bold text-[10px] text-accent truncate mb-0.5">
                    {quotedMsg.sender_name || (quotedMsg.direction === 'INBOUND' ? customerName || 'Customer' : 'Bidan / CS')}
                  </p>
                  <p className="text-[11px] text-ink-2 truncate">
                    {quotedMsg.media ? (
                      <span className="flex items-center gap-1">
                        Foto {quotedMsg.content && !/^\[(IMAGE|MEDIA)/.test(quotedMsg.content) ? `• ${quotedMsg.content.slice(0, 60)}` : ''}
                      </span>
                    ) : (
                      quotedMsg.content || 'Pesan'
                    )}
                  </p>
                </div>
              )}

              {/* Share Location Card */}
              {isLocationMsg && locData && (
                <div className="mb-2 p-2.5 rounded-xl bg-fill-1 border border-divider flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-danger-soft text-danger flex items-center justify-center shrink-0">
                    <MapPin size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-[12px] text-ink leading-tight flex items-center gap-1">
                      <span>{locData.isLive ? 'Live Location Pasien' : 'Share Location Pasien'}</span>
                      {locData.isLive && <span className="inline-block w-2 h-2 rounded-full bg-danger" />}
                    </p>
                    <p className="text-[10px] text-ink-2 font-mono truncate mt-0.5">
                      {locData.latitude.toFixed(6)}, {locData.longitude.toFixed(6)}
                    </p>
                    {(locData.name || locData.address) && (
                      <p className="text-[11px] text-ink truncate mt-0.5 font-medium">
                        {locData.name || locData.address}
                      </p>
                    )}
                  </div>
                  <a
                    href={locData.url || `https://www.google.com/maps/search/?api=1&query=${locData.latitude},${locData.longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-on-solid rounded-lg text-[11px] font-bold transition shadow-xs flex items-center gap-1 shrink-0 active:scale-95"
                    title="Buka lokasi di Google Maps"
                  >
                    <span>Buka Google Maps</span>
                    <ExternalLink size={12} />
                  </a>
                </div>
              )}

              {/* Voice Note / Audio Player */}
              {isAudioMsg && audioUrl ? (
                <div className="mb-2">
                  <VoiceNotePlayer src={audioUrl} />
                </div>
              ) : media && !isLocationMsg ? (
                <div onLoad={onScrollToBottom} className="mb-2 rounded-xl overflow-hidden">
                  <MediaImage
                    src={media.url || media.hdUrl || media.thumbUrl}
                    downloadSrc={media.hdUrl || media.url}
                    thumbUrl={media.thumbUrl}
                    caption={media.caption || extractImageCaption(msg.content) || undefined}
                  />
                </div>
              ) : null}

              {/* Teks dirender tepat satu kali lewat resolver terpusat. */}
              {(() => {
                const hasVisual = isLocationMsg || isAudioMsg || !!media;
                const displayText = resolveMessageDisplayText({ content: msg.content, media }, { maskPhone: !isSupervisor });
                if (!displayText) {
                  if (hasVisual) return null;
                  return <div className="text-[11px] italic text-ink-2">[Pesan tanpa teks]</div>;
                }
                return <div className="whitespace-pre-wrap break-words select-text">{displayText}</div>;
              })()}
            </>
          )}

          {/* Meta Info & Delivery Ticks */}
          <div className="flex items-center justify-end space-x-1.5 mt-1 pt-0.5 text-[10px] text-ink-2">
            {((msg as any).is_edited || msg.is_edited || (msg as any).payload_raw?.is_edited) && !isRevoked && (
              <span className="text-[9px] text-ink-2 italic">diedit</span>
            )}
            <span title={fullDateTitle}>{timeStr}</span>
            {!isInbound && !isRevoked && (
              <span
                className="inline-flex items-center"
                title={
                  msg.delivery_status === 'read'
                    ? `Dibaca ${msg.read_at ? formatWibTime(msg.read_at) : ''} WIB`
                    : msg.delivery_status === 'delivered'
                      ? `Diterima ${msg.delivered_at ? formatWibTime(msg.delivered_at) : ''} WIB`
                      : msg.delivery_status === 'failed'
                        ? 'Gagal terkirim'
                        : 'Terkirim'
                }
              >
                {msg.delivery_status === 'read' ? (
                  <CheckCheck size={13} className="text-info stroke-[2.5]" />
                ) : msg.delivery_status === 'delivered' ? (
                  <CheckCheck size={13} className="text-ink-3" />
                ) : msg.delivery_status === 'failed' ? (
                  <AlertCircle size={12} className="text-danger" />
                ) : (
                  <Check size={12} className="text-ink-3" />
                )}
              </span>
            )}

            {/* Edit message button */}
            {isStaff &&
              !isRevoked &&
              !media &&
              !isAudioMsg &&
              (msg.created_at ? Date.now() - new Date(msg.created_at).getTime() <= 15 * 60 * 1000 : false) &&
              supportsEdit && (
                <button
                  onClick={() => onStartEdit(msg)}
                  className="opacity-0 group-hover:opacity-100 hover:text-accent transition-opacity p-0.5 ml-1"
                  title="Edit pesan ini (maksimal 15 menit)"
                  aria-label="Edit pesan"
                >
                  <PenLine size={11} />
                </button>
              )}

            {/* Revoke message button */}
            {isStaff && !isRevoked && supportsRevoke && (
              <button
                onClick={() => onRevoke(msg)}
                disabled={revokingId === msg.id}
                className="opacity-0 group-hover:opacity-100 hover:text-danger transition-opacity p-0.5 ml-1"
                title="Tarik pesan ini dari WhatsApp"
                aria-label="Tarik pesan"
              >
                {revokingId === msg.id ? (
                  <div className="h-2.5 w-2.5 animate-spin rounded-full border border-danger border-t-transparent"></div>
                ) : (
                  <Trash2 size={11} />
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
};
