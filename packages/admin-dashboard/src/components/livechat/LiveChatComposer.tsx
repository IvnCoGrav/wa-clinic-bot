import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from 'react';
import {
  Send,
  X,
  Plus,
  Loader,
  Smile,
  Zap,
  Calendar,
  CalendarPlus,
  Receipt,
  ImagePlus,
  Sparkles,
  Reply,
} from 'lucide-react';

/**
 * LiveChatComposer — input balasan Live Chat mandiri (Fase A v3).
 *
 * Tujuan fondasional: mengisolasi siklus render pengetikan dari
 * LiveChatMonitor (6.2k baris) sehingga keystroke di mobile (Safari iOS)
 * tidak me-render ulang thread/sidebar. Input bersifat uncontrolled
 * (contentEditable + ref); ke parent hanya naik transisi kosong<->terisi
 * via `onTextChange` dan presence via `onTyping` (debounce 500ms).
 */

export interface ComposerQuickReply {
  id: string;
  shortcut: string;
  title: string;
  content: string;
  category: string | null;
}

export interface ComposerReplyTarget {
  senderLabel: string;
  preview: string;
}

export interface ComposerImage {
  preview: string;
}

export interface LiveChatComposerProps {
  conversationId: string;
  sending?: boolean;
  generatingDraft?: boolean;
  replyingTo?: ComposerReplyTarget | null;
  selectedImage?: ComposerImage | null;
  quickReplies?: ComposerQuickReply[];
  onTextChange?: (text: string, isNotEmpty: boolean) => void;
  onTyping?: (isTyping: boolean) => void;
  onSend?: (text: string) => void;
  /** Interpolasi template di parent (butuh data customer); kembalikan teks final untuk disisipkan. */
  onApplyQuickReply?: (qr: ComposerQuickReply) => string;
  onPickImage?: () => void;
  onRemoveImage?: () => void;
  onCancelReply?: () => void;
  onGenerateAiDraft?: () => void;
  onOpenSchedule?: () => void;
  onOpenQuickHold?: () => void;
  onOpenQuickReservation?: () => void;
  onGenerateInvoice?: () => void;
  onRequestScrollToBottom?: () => void;
}

export interface LiveChatComposerHandle {
  setText: (text: string) => void;
  clear: () => void;
  focus: () => void;
  closePopovers: () => void;
  getText: () => string;
}

const DRAFT_KEY_PREFIX = 'liveChat:draft:';
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

function loadDraft(convId: string): string {
  if (!convId) return '';
  try {
    const raw = localStorage.getItem(`${DRAFT_KEY_PREFIX}${convId}`);
    if (!raw) return '';
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        if (Date.now() - (parsed.timestamp || 0) > DRAFT_TTL_MS) {
          localStorage.removeItem(`${DRAFT_KEY_PREFIX}${convId}`);
          return '';
        }
        return parsed.text || '';
      }
    } catch {
      return raw;
    }
    return '';
  } catch {
    return '';
  }
}

function saveDraft(convId: string, text: string) {
  if (!convId) return;
  try {
    const key = `${DRAFT_KEY_PREFIX}${convId}`;
    if (!text || !text.trim()) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify({ text, timestamp: Date.now() }));
    }
  } catch {}
}

function clearDraft(convId: string) {
  if (!convId) return;
  try {
    localStorage.removeItem(`${DRAFT_KEY_PREFIX}${convId}`);
  } catch {}
}

const DEFAULT_FAVORITE_EMOJIS = [
  '😊', '🙏', '👶', '❤️', '👍', '✅', '✨', '🌸',
  '🥰', '🙌', '🩺', '🗓️', '🍼', '💐', '💬', '🎉',
  '😄', '👌', '💆‍♀️', '💵', '⭐', '☀️', '📞', '💡',
];

const EMOJI_CATEGORIES = [
  {
    id: 'favorites',
    label: 'Favorit & Sering Digunakan',
    icon: '⭐',
    emojis: [] as string[],
  },
  {
    id: 'smileys',
    label: 'Wajah & Ekspresi',
    icon: '😊',
    emojis: [
      '😊', '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '🥹',
      '🥰', '😍', '🤩', '😘', '😗', '😚', '😋', '😛', '😜', '🤪',
      '🤗', '🤭', '🫢', '🤫', '🤔', '🫡', '🤐', '🤨', '😐', '😑',
      '😶', '😏', '😒', '🙄', '😬', '😮‍💨', '🤥', '😌', '😔', '😪',
      '😴', '😷', '🤒', '🤕', '🤢', '🤧', '🥵', '🥶', '🥴', '😵',
      '🤯', '🥳', '🥸', '😎', '🤓', '🧐', '😇', '🤠', '🥺', '😭'
    ],
  },
  {
    id: 'gestures',
    label: 'Tangan & Hati',
    icon: '👍',
    emojis: [
      '👍', '👍🏻', '👍🏼', '👍🏽', '👎', '👌', '👌🏻', '👌🏼', '✌️', '🤞',
      '🫰', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '✋',
      '🤚', '🖐️', '👋', '🤝', '🙏', '🤲', '💪', '👏', '🙌', '🫶',
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🤎', '🖤', '🤍', '💔',
      '❤️‍🔥', '❤️‍🩹', '💖', '💗', '💓', '💞', '💕', '💌', '✨', '⭐',
      '🌟', '💫', '💥', '🔥', '💯', '🎉', '🎊', '💐', '🌸', '🌹'
    ],
  },
  {
    id: 'clinic',
    label: 'Klinik & Bayi',
    icon: '👶',
    emojis: [
      '👶', '👶🏻', '👶🏼', '🧒', '👧', '👦', '👩‍🍼', '👨‍🍼', '🍼', '🤱',
      '🤰', '💆‍♀️', '💆‍♂️', '🧖‍♀️', '🧖‍♂️', '🛁', '🫧', '🧴', '🩺', '🩹',
      '💊', '💉', '🏥', '🗓️', '📅', '⏰', '⏱️', '📍', '🗺️', '🏡',
      '🏠', '🚗', '🛵', '💳', '💵', '🧾', '💰', '🎁', '🎈', '🌿',
      '🌱', '☀️', '🌤️', '🌙', '⭐', '🌈', '☂️', '☕', '🍵', '🍎'
    ],
  },
  {
    id: 'symbols',
    label: 'Simbol',
    icon: '✅',
    emojis: [
      '✅', '✔️', '☑️', '❌', '❎', '❓', '❔', '❗', '❕', '⚠️',
      '⛔', '🚫', '💡', '🔔', '🔕', '📌', '📍', '📞', '📱', '💬',
      '💭', '📝', '📋', '📎', '➡️', '⬅️', '⬆️', '⬇️', '▶️', '⏸️',
      '🔁', '🔂', '🔄', '📢', '📣', '🔍', '🔎', '🔒', '🔓', '🔑',
      '🏷️', '🏧', '🟢', '🟡', '🔴', '⚪', '⚫', '🟦', '🟧', '🟨',
      '🟩', '🟣', '🟤', '🔘', '0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'
    ],
  },
] as const;

function detectSlashToken(text: string): string | null {
  if (!text) return null;
  const tokens = text.split(/\s+/);
  const lastToken = tokens[tokens.length - 1] || '';
  const match = text.match(/(?:^|\s)\/([a-z0-9_-]*)$/i);
  if (match) return match[1].toLowerCase();
  if (lastToken.startsWith('/') && /^\/[a-z0-9_-]*$/i.test(lastToken)) {
    return lastToken.slice(1).toLowerCase();
  }
  return null;
}

type EmojiCategoryId = 'favorites' | 'smileys' | 'gestures' | 'clinic' | 'symbols';

const LiveChatComposerInner = (
  props: LiveChatComposerProps,
  ref: React.Ref<LiveChatComposerHandle>
) => {
  const {
    conversationId,
    sending,
    generatingDraft,
    replyingTo,
    selectedImage,
    quickReplies = [],
    onTextChange,
    onTyping,
    onSend,
    onApplyQuickReply,
    onPickImage,
    onRemoveImage,
    onCancelReply,
    onGenerateAiDraft,
    onOpenSchedule,
    onOpenQuickHold,
    onOpenQuickReservation,
    onGenerateInvoice,
    onRequestScrollToBottom,
  } = props;

  const inputRef = useRef<HTMLDivElement | null>(null);
  const [hasText, setHasText] = useState(false);
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [emojiCategory, setEmojiCategory] = useState<EmojiCategoryId>('favorites');
  const [favoriteEmojis, setFavoriteEmojis] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('liveChat:favoriteEmojis');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return DEFAULT_FAVORITE_EMOJIS;
  });
  const [quickReplyFilter, setQuickReplyFilter] = useState<string | null>(null);
  const [quickReplyActiveIdx, setQuickReplyActiveIdx] = useState(0);

  const toolsMenuRef = useRef<HTMLDivElement | null>(null);
  const emojiPickerRef = useRef<HTMLDivElement | null>(null);
  const composerWrapperRef = useRef<HTMLDivElement | null>(null);
  const typingTimerRef = useRef<any>(null);
  const typingStartTimerRef = useRef<any>(null);
  const isTypingActiveRef = useRef(false);
  const convIdRef = useRef(conversationId);

  const onTextChangeRef = useRef(onTextChange);
  onTextChangeRef.current = onTextChange;
  const onTypingRef = useRef(onTyping);
  onTypingRef.current = onTyping;

  const emitTextChange = useCallback((text: string) => {
    const isNotEmpty = text.trim().length > 0;
    setHasText((prev) => (prev === isNotEmpty ? prev : isNotEmpty));
    onTextChangeRef.current?.(text, isNotEmpty);
  }, []);

  const setTyping = useCallback((isTyping: boolean) => {
    if (isTypingActiveRef.current === isTyping && isTyping) return;
    isTypingActiveRef.current = isTyping;
    onTypingRef.current?.(isTyping);
  }, []);

  const stopTypingTimers = useCallback(() => {
    if (typingStartTimerRef.current) clearTimeout(typingStartTimerRef.current);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingStartTimerRef.current = null;
    typingTimerRef.current = null;
  }, []);

  const scheduleTyping = useCallback((isNotEmpty: boolean) => {
    if (isNotEmpty) {
      if (typingStartTimerRef.current) clearTimeout(typingStartTimerRef.current);
      typingStartTimerRef.current = setTimeout(() => setTyping(true), 500);
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(() => setTyping(false), 3000);
    } else {
      stopTypingTimers();
      setTyping(false);
    }
  }, [setTyping, stopTypingTimers]);

  const readText = useCallback(() => inputRef.current?.innerText || '', []);

  const writeText = useCallback((text: string, notify = true) => {
    if (inputRef.current && inputRef.current.innerText !== text) {
      inputRef.current.innerText = text;
    }
    saveDraft(convIdRef.current, text);
    if (notify) {
      emitTextChange(text);
      scheduleTyping(text.trim().length > 0);
    }
  }, [emitTextChange, scheduleTyping]);

  // Ganti percakapan: hentikan typing lama, muat draf 24 jam milik chat baru.
  useEffect(() => {
    const prevId = convIdRef.current;
    if (prevId !== conversationId) {
      stopTypingTimers();
      isTypingActiveRef.current = false;
      convIdRef.current = conversationId;
    }
    setQuickReplyFilter(null);
    setQuickReplyActiveIdx(0);
    setEmojiPickerOpen(false);
    setToolsMenuOpen(false);
    const draft = loadDraft(conversationId);
    if (inputRef.current) {
      inputRef.current.innerText = draft;
    }
    emitTextChange(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => {
    return () => {
      stopTypingTimers();
      onTypingRef.current?.(false);
    };
  }, [stopTypingTimers]);

  // Tutup popover saat klik di luar.
  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent) => {
      if (toolsMenuRef.current && !toolsMenuRef.current.contains(e.target as Node)) {
        setToolsMenuOpen(false);
      }
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setEmojiPickerOpen(false);
      }
      if (composerWrapperRef.current && !composerWrapperRef.current.contains(e.target as Node)) {
        setQuickReplyFilter((prev) => (prev === null ? prev : null));
      }
    };
    document.addEventListener('mousedown', handleDocumentClick);
    return () => {
      document.removeEventListener('mousedown', handleDocumentClick);
    };
  }, []);

  useImperativeHandle(ref, () => ({
    setText: (text: string) => {
      writeText(text);
      setTimeout(() => inputRef.current?.focus(), 50);
    },
    clear: () => {
      if (inputRef.current) inputRef.current.innerText = '';
      clearDraft(convIdRef.current);
      setHasText(false);
      onTextChangeRef.current?.('', false);
      stopTypingTimers();
      isTypingActiveRef.current = false;
    },
    focus: () => {
      setTimeout(() => inputRef.current?.focus(), 50);
    },
    closePopovers: () => {
      setEmojiPickerOpen(false);
      setToolsMenuOpen(false);
      setQuickReplyFilter(null);
    },
    getText: () => readText(),
  }), [writeText, readText, stopTypingTimers]);

  const filteredQuickReplies = useMemo(() => {
    if (quickReplyFilter === null) return [];
    const q = quickReplyFilter.toLowerCase();
    if (!q) return quickReplies.slice(0, 8);
    return quickReplies
      .filter((qr) => qr.shortcut.toLowerCase().includes(q) || qr.title.toLowerCase().includes(q))
      .slice(0, 8);
  }, [quickReplies, quickReplyFilter]);

  const showQuickReplyPopover = quickReplyFilter !== null && filteredQuickReplies.length > 0;

  const handleInput = useCallback(() => {
    const text = readText();
    saveDraft(convIdRef.current, text);
    const slash = detectSlashToken(text);
    if (slash !== null) {
      setQuickReplyFilter(slash);
      setQuickReplyActiveIdx(0);
    } else {
      setQuickReplyFilter((prev) => (prev === null ? prev : null));
    }
    emitTextChange(text);
    scheduleTyping(text.trim().length > 0);
  }, [readText, emitTextChange, scheduleTyping]);

  const applyQuickReply = useCallback((qr: ComposerQuickReply) => {
    const interpolated = onApplyQuickReply?.(qr) ?? qr.content;
    writeText(interpolated);
    setQuickReplyFilter(null);
    setQuickReplyActiveIdx(0);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [onApplyQuickReply, writeText]);

  const insertEmoji = useCallback((emoji: string) => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    setFavoriteEmojis((prev) => {
      const next = [emoji, ...prev.filter((e) => e !== emoji)].slice(0, 32);
      try {
        localStorage.setItem('liveChat:favoriteEmojis', JSON.stringify(next));
      } catch {}
      return next;
    });
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      if (el.contains(range.commonAncestorContainer)) {
        range.deleteContents();
        const textNode = document.createTextNode(emoji);
        range.insertNode(textNode);
        range.setStartAfter(textNode);
        range.setEndAfter(textNode);
        sel.removeAllRanges();
        sel.addRange(range);
      } else {
        el.innerText += emoji;
        const newRange = document.createRange();
        newRange.selectNodeContents(el);
        newRange.collapse(false);
        sel.removeAllRanges();
        sel.addRange(newRange);
      }
    } else {
      el.innerText += emoji;
      if (sel) {
        const newRange = document.createRange();
        newRange.selectNodeContents(el);
        newRange.collapse(false);
        sel.removeAllRanges();
        sel.addRange(newRange);
      }
    }
    handleInput();
  }, [handleInput]);

  const handleSend = useCallback(() => {
    const text = readText().trim();
    if ((!text && !selectedImage) || sending) return;
    stopTypingTimers();
    isTypingActiveRef.current = false;
    onTypingRef.current?.(false);
    if (inputRef.current) inputRef.current.innerText = '';
    clearDraft(convIdRef.current);
    setHasText(false);
    onTextChangeRef.current?.('', false);
    setQuickReplyFilter(null);
    setEmojiPickerOpen(false);
    setToolsMenuOpen(false);
    onSend?.(text);
  }, [readText, selectedImage, sending, stopTypingTimers, onSend]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (showQuickReplyPopover) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setQuickReplyActiveIdx((prev) => (prev + 1) % filteredQuickReplies.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setQuickReplyActiveIdx((prev) => (prev - 1 + filteredQuickReplies.length) % filteredQuickReplies.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const target = filteredQuickReplies[quickReplyActiveIdx];
        if (target) applyQuickReply(target);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setQuickReplyFilter(null);
        return;
      }
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
    }
  }, [showQuickReplyPopover, filteredQuickReplies, quickReplyActiveIdx, applyQuickReply, handleSend]);

  const sendDisabled = sending || (!hasText && !selectedImage);

  return (
    <>
      {replyingTo && (
        <div className="flex items-center justify-between bg-white px-3 py-2 border-l-4 border-[#008069] rounded-t-xl mb-0 shadow-xs border border-b-0 border-[#e9edef] animate-fadeIn">
          <div className="flex-1 min-w-0 pr-2">
            <div className="flex items-center space-x-1.5">
              <Reply size={12} className="text-[#008069] shrink-0" />
              <span className="text-[11px] font-bold text-[#008069] truncate">
                Membalas {replyingTo.senderLabel}
              </span>
            </div>
            <p className="text-[11px] text-[#54656f] truncate mt-0.5 pl-4">
              {replyingTo.preview}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            className="p-1 text-[#8696a0] hover:text-rose-500 hover:bg-rose-50 rounded-full transition active:scale-90"
            title="Batal membalas"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {selectedImage && (
        <div className="relative inline-block mb-2">
          <img
            src={selectedImage.preview}
            alt="Preview"
            className="w-20 h-20 object-cover rounded-lg border border-[#e9edef]"
          />
          <button
            onClick={onRemoveImage}
            className="absolute -top-1.5 -right-1.5 p-0.5 bg-rose-500 text-white rounded-full hover:bg-rose-600 transition"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {showQuickReplyPopover && (
        <div className="mb-1.5 bg-white border border-[#e9edef] rounded-2xl shadow-xl overflow-hidden z-30 max-h-72 flex flex-col animate-fadeIn">
          <div className="px-3 py-1.5 bg-[#f8fafc] border-b border-[#e9edef] flex items-center justify-between">
            <span className="text-[11px] font-bold text-[#008069] flex items-center gap-1"><Zap size={12} /> Balasan Cepat</span>
            <span className="text-[10px] text-[#8696a0]">{filteredQuickReplies.length} template</span>
          </div>
          <div className="overflow-y-auto flex-1 divide-y divide-[#f0f2f5]">
            {filteredQuickReplies.map((qr, idx) => (
              <button
                key={qr.id}
                type="button"
                onClick={() => applyQuickReply(qr)}
                onMouseEnter={() => setQuickReplyActiveIdx(idx)}
                className={`w-full text-left px-3 py-2 flex items-start gap-2.5 transition ${idx === quickReplyActiveIdx ? 'bg-[#e8f5f2] border-l-4 border-[#008069]' : 'hover:bg-[#f8fafc] border-l-4 border-transparent'}`}
              >
                <span className={`shrink-0 px-1.5 py-0.5 rounded-md text-[11px] font-mono font-bold border ${idx === quickReplyActiveIdx ? 'bg-[#008069] text-white border-[#008069]' : 'bg-[#f0f2f5] text-[#008069] border-[#c2e7e0]'}`}>/{qr.shortcut}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-bold text-[#111b21] truncate flex items-center gap-1.5">{qr.title} {qr.category && <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-[#f0f2f5] text-[#54656f] border border-[#e9edef] font-semibold">{qr.category}</span>}</p>
                  <p className="text-[11px] text-[#667781] line-clamp-1 truncate">{qr.content.slice(0, 80).replace(/\n/g, ' ')}</p>
                </div>
              </button>
            ))}
          </div>
          <div className="px-2.5 py-1 bg-[#fffbeb] border-t border-amber-100 text-[10px] text-amber-700 flex items-center gap-1.5">
            <span>↑↓ navigasi</span><span className="opacity-40">•</span><span>Enter/Tab pilih</span><span className="opacity-40">•</span><span>Esc tutup</span>
          </div>
        </div>
      )}

      <div ref={composerWrapperRef} className={`flex items-end space-x-1.5 sm:space-x-2 bg-[#f0f2f5] p-1 sm:p-1.5 md:p-2 pb-[max(0.5rem,env(safe-area-inset-bottom,0.5rem))] border border-[#e9edef] w-full mb-0 ${replyingTo ? 'rounded-b-none border-t-0' : 'rounded-t-xl rounded-b-none'} border-b-0`}>
        <div className="relative shrink-0" ref={toolsMenuRef}>
          <button
            type="button"
            onClick={() => setToolsMenuOpen(!toolsMenuOpen)}
            disabled={sending || generatingDraft}
            className={`w-9 h-9 sm:w-10 sm:h-10 min-h-[36px] sm:min-h-[38px] p-0 bg-white border border-[#d1d7db] hover:border-[#008069] disabled:opacity-40 rounded-xl text-xs font-bold transition flex items-center justify-center shadow-xs active:scale-95 shrink-0 ${
              toolsMenuOpen ? 'bg-[#e8f5f2] border-[#008069] text-[#008069]' : 'text-[#54656f] hover:text-[#008069]'
            }`}
            title="Fitur & Lampiran (AI Copilot / Gambar)"
            aria-label="Menu Tools & Lampiran"
          >
            {generatingDraft ? (
              <Loader size={17} className="animate-spin text-amber-500" />
            ) : (
              <Plus size={17} className={`transition-transform duration-200 ${toolsMenuOpen ? 'rotate-45 text-[#008069]' : ''}`} />
            )}
          </button>

          {toolsMenuOpen && (
            <div className="absolute bottom-full left-0 mb-2 w-56 bg-white border border-[#e9edef] rounded-2xl shadow-xl p-1.5 z-30 animate-fadeIn space-y-1">
              <button
                type="button"
                onClick={() => {
                  setToolsMenuOpen(false);
                  onGenerateAiDraft?.();
                }}
                disabled={generatingDraft || sending}
                className="w-full flex items-center space-x-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#111b21] hover:bg-amber-50/80 hover:text-amber-700 transition text-left group disabled:opacity-50"
              >
                <div className="w-7 h-7 rounded-lg bg-amber-100/80 text-amber-600 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                  <Sparkles size={15} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-[12px] truncate flex items-center gap-1">
                    <span>AI Copilot Draft</span>
                    <span className="text-[9px] px-1 py-0.2 bg-amber-100 text-amber-800 rounded font-semibold">AI</span>
                  </p>
                  <p className="text-[10px] text-[#667781] truncate">Saran balasan otomatis bidan</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setToolsMenuOpen(false);
                  onOpenSchedule?.();
                }}
                className="w-full flex items-center space-x-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#111b21] hover:bg-[#e8f5f2] hover:text-[#008069] transition text-left group"
              >
                <div className="w-7 h-7 rounded-lg bg-[#e8f5f2] text-[#008069] flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                  <Calendar size={15} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-[12px] truncate">Cek Jadwal Harian</p>
                  <p className="text-[10px] text-[#667781] truncate">Lihat kalender & slot kosong</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setToolsMenuOpen(false);
                  onOpenQuickHold?.();
                }}
                disabled={sending}
                className="w-full flex items-center space-x-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#111b21] hover:bg-amber-50/80 hover:text-amber-700 transition text-left group disabled:opacity-50"
              >
                <div className="w-7 h-7 rounded-lg bg-amber-100/80 text-amber-600 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                  <Zap size={15} className="fill-current" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-[12px] truncate">Tahan Slot (Hold)</p>
                  <p className="text-[10px] text-[#667781] truncate">Kunci tgl & jam negosiasi</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setToolsMenuOpen(false);
                  onOpenQuickReservation?.();
                }}
                disabled={sending}
                className="w-full flex items-center space-x-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#111b21] hover:bg-emerald-50/80 hover:text-[#008069] transition text-left group disabled:opacity-50"
              >
                <div className="w-7 h-7 rounded-lg bg-emerald-100/80 text-[#008069] flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                  <CalendarPlus size={15} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-[12px] truncate">Buat Reservasi Baru</p>
                  <p className="text-[10px] text-[#667781] truncate">Auto-fill data pasien & anak</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setToolsMenuOpen(false);
                  onGenerateInvoice?.();
                }}
                disabled={sending}
                className="w-full flex items-center space-x-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#111b21] hover:bg-sky-50/80 hover:text-sky-700 transition text-left group disabled:opacity-50"
              >
                <div className="w-7 h-7 rounded-lg bg-sky-100/80 text-sky-600 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                  <Receipt size={15} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-[12px] truncate">Generate Invoice / Payment</p>
                  <p className="text-[10px] text-[#667781] truncate">Isi format rincian ke chat</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setToolsMenuOpen(false);
                  onPickImage?.();
                }}
                disabled={sending}
                className="w-full flex items-center space-x-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#111b21] hover:bg-[#e8f5f2] hover:text-[#008069] transition text-left group disabled:opacity-50"
              >
                <div className="w-7 h-7 rounded-lg bg-[#e8f5f2] text-[#008069] flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                  <ImagePlus size={15} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-[12px] truncate">Lampirkan Gambar</p>
                  <p className="text-[10px] text-[#667781] truncate">Kirim foto/pricelist (maks 8MB)</p>
                </div>
              </button>
            </div>
          )}
        </div>

        <div className="relative shrink-0 hidden md:block" ref={emojiPickerRef}>
          <button
            type="button"
            onClick={() => setEmojiPickerOpen(!emojiPickerOpen)}
            disabled={sending}
            className={`w-9 h-9 sm:w-10 sm:h-10 min-h-[36px] sm:min-h-[38px] p-0 bg-white border border-[#d1d7db] hover:border-[#008069] disabled:opacity-40 rounded-xl text-xs font-bold transition flex items-center justify-center shadow-xs active:scale-95 shrink-0 ${
              emojiPickerOpen ? 'bg-[#e8f5f2] border-[#008069] text-[#008069]' : 'text-[#54656f] hover:text-[#008069]'
            }`}
            title="Pilih Emoticon (Khusus Web)"
            aria-label="Pilih Emoticon"
          >
            <Smile size={18} className={emojiPickerOpen ? 'text-[#008069]' : 'text-[#54656f]'} />
          </button>

          {emojiPickerOpen && (
            <div className="absolute bottom-full left-0 mb-2 w-80 bg-white border border-[#e9edef] rounded-2xl shadow-2xl p-2.5 z-40 animate-fadeIn flex flex-col gap-2 select-none">
              <div className="flex items-center justify-between border-b border-[#e9edef] pb-1.5 px-0.5">
                <div className="flex items-center space-x-1">
                  {EMOJI_CATEGORIES.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setEmojiCategory(cat.id as EmojiCategoryId)}
                      className={`w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center text-base transition active:scale-95 cursor-pointer ${
                        emojiCategory === cat.id
                          ? 'bg-[#e8f5f2] text-[#008069] font-bold shadow-xs scale-105'
                          : 'text-[#54656f] hover:bg-[#f0f2f5]'
                      }`}
                      title={cat.label}
                      aria-label={cat.label}
                    >
                      <span>{cat.icon}</span>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setEmojiPickerOpen(false)}
                  className="text-[#8696a0] hover:text-[#111b21] p-1.5 rounded-lg hover:bg-[#f0f2f5] transition"
                  title="Tutup"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="grid grid-cols-8 gap-1 max-h-52 overflow-y-auto p-1 custom-scrollbar">
                {(emojiCategory === 'favorites'
                  ? favoriteEmojis
                  : (EMOJI_CATEGORIES.find((cat) => cat.id === emojiCategory)?.emojis || [])
                ).map((emoji, idx) => (
                  <button
                    key={`${emoji}-${idx}`}
                    type="button"
                    onClick={() => insertEmoji(emoji)}
                    className="w-8 h-8 flex items-center justify-center text-lg rounded-lg hover:bg-[#f0f2f5] hover:scale-125 transition-transform active:scale-95 cursor-pointer"
                    title={emoji}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div
          ref={inputRef}
          contentEditable="plaintext-only"
          role="textbox"
          aria-multiline="true"
          tabIndex={0}
          inputMode="text"
          enterKeyHint="send"
          autoCapitalize="sentences"
          autoCorrect="on"
          spellCheck={true}
          data-placeholder="Tulis balasan... (Enter baris baru, klik Kirim)"
          onFocus={() => {
            if (typeof window !== 'undefined') {
              window.scrollTo(0, 0);
              setTimeout(() => {
                window.scrollTo(0, 0);
                onRequestScrollToBottom?.();
              }, 100);
            }
          }}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          className="chat-contenteditable flex-1 w-full min-w-0 rounded-xl bg-white border border-[#d1d7db] focus:border-[#008069] focus:ring-1 focus:ring-[#008069] focus:outline-none text-[16px] sm:text-sm text-[#111b21] py-2 px-2.5 sm:px-3 shadow-xs min-h-[38px] max-h-[125px] overflow-y-auto leading-relaxed outline-none"
          style={{ fontSize: '16px', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}
        />
        <button
          onClick={handleSend}
          disabled={sendDisabled}
          className="w-9 h-9 sm:w-auto sm:px-4 min-h-[36px] sm:min-h-[38px] p-0 sm:py-2.5 bg-[#008069] hover:bg-[#00a884] disabled:opacity-40 text-white rounded-xl text-xs font-bold transition flex items-center justify-center space-x-1.5 shadow-xs shrink-0 active:scale-95"
          title="Kirim Balasan"
        >
          <Send size={15} />
          <span className="hidden sm:inline">{sending ? 'Mengirim...' : 'Kirim'}</span>
        </button>
      </div>
    </>
  );
};

export const LiveChatComposer = React.memo(forwardRef<LiveChatComposerHandle, LiveChatComposerProps>(LiveChatComposerInner));
export default LiveChatComposer;
