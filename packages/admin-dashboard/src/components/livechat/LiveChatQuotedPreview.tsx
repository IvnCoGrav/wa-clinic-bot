/**
 * Pratinjau pesan yang dikutip di dalam gelembung Live Chat. Klik untuk
 * menggulir ke pesan aslinya dan menyorotnya sebentar.
 */
import React from 'react';
import { QuotedMessageData } from '../../types/livechat';

interface LiveChatQuotedPreviewProps {
  quotedMsg: QuotedMessageData;
  customerName?: string | null;
  isCustomer: boolean;
}

function jumpToMessage(id?: string | null) {
  if (!id) return;
  const target = document.getElementById(`msg-${id}`);
  if (!target) return;
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target.classList.add('ring-2', 'ring-accent');
  setTimeout(() => target.classList.remove('ring-2', 'ring-accent'), 1200);
}

export const LiveChatQuotedPreview: React.FC<LiveChatQuotedPreviewProps> = ({
  quotedMsg,
  customerName,
  isCustomer,
}) => (
  <div
    role="button"
    tabIndex={0}
    className={`mb-1.5 p-1.5 rounded-md border-l-[3px] text-[11px] leading-snug cursor-pointer transition select-none ${
      isCustomer ? 'bg-black/[0.04] hover:bg-black/[0.07] border-accent' : 'bg-black/[0.05] hover:bg-black/[0.08] border-accent'
    }`}
    onClick={() => jumpToMessage(quotedMsg.id || quotedMsg.wa_message_id)}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        jumpToMessage(quotedMsg.id || quotedMsg.wa_message_id);
      }
    }}
    title="Klik untuk melihat pesan asli"
  >
    <p className="font-bold text-[10px] text-accent truncate mb-0.5">
      {quotedMsg.sender_name ||
        (quotedMsg.direction === 'INBOUND' ? customerName || 'Customer' : 'Bidan / CS')}
    </p>
    <p className="text-[11px] text-ink-2 truncate font-sans">
      {quotedMsg.media ? (
        <span className="flex items-center gap-1">
          <span>Foto</span>
          {quotedMsg.content && !/^\[(IMAGE|MEDIA)/.test(quotedMsg.content) && (
            <span>{quotedMsg.content}</span>
          )}
        </span>
      ) : (
        quotedMsg.content || 'Pesan'
      )}
    </p>
  </div>
);
