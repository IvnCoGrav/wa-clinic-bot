/**
 * Alat bantu di atas daftar pesan: pencarian dalam percakapan dan banner
 * pesan yang disematkan.
 */
import React from 'react';
import { Search, X } from 'lucide-react';
import { MessagePinBanner } from './MessagePinBanner';

interface LiveChatThreadToolsProps {
  searchOpen: boolean;
  searchQuery: string;
  searchInputRef: React.RefObject<HTMLInputElement>;
  onQueryChange: (query: string) => void;
  onClearSearch: () => void;
  pinnedBubble: any;
  onJumpToPinned: (msgId: string) => void;
  onUnpin: (msgId: string) => void;
  isUnpinning: boolean;
}

export const LiveChatThreadTools: React.FC<LiveChatThreadToolsProps> = ({
  searchOpen,
  searchQuery,
  searchInputRef,
  onQueryChange,
  onClearSearch,
  pinnedBubble,
  onJumpToPinned,
  onUnpin,
  isUnpinning,
}) => (
  <>
    {searchOpen && (
      <div className="mx-1 mb-1 p-1.5 bg-surface-2 dark:bg-surface border border-divider dark:border-divider rounded-xl flex items-center gap-1.5 animate-fadeIn shrink-0">
        <Search size={14} className="text-ink-3 shrink-0 ml-1" />
        <input
          ref={searchInputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Cari dalam percakapan ini… (min. 2 huruf)"
          className="flex-1 bg-transparent text-xs text-ink placeholder-ink-3 focus:outline-none focus:ring-1 focus:ring-accent rounded px-1 min-w-0"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={onClearSearch}
            className="p-1 rounded-lg hover:bg-fill-2 dark:hover:bg-strong text-ink-3"
            aria-label="Hapus pencarian dalam chat"
          >
            <X size={14} />
          </button>
        )}
      </div>
    )}

    {pinnedBubble && (
      <MessagePinBanner
        pinnedMessage={pinnedBubble}
        onJumpToMessage={onJumpToPinned}
        onUnpin={onUnpin}
        isUnpinning={isUnpinning}
      />
    )}
  </>
);
