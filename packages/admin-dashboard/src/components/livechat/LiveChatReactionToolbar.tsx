/**
 * Toolbar reaksi cepat dan grid emoji tambahan di dalam gelembung Live Chat.
 */
import React from 'react';
import { EXTRA_REACTIONS, QUICK_REACTIONS } from '../../utils/liveChatReactions';

interface LiveChatReactionToolbarProps {
  active: boolean;
  customOpen: boolean;
  isCustomer: boolean;
  selectedEmoji?: string;
  onToggleReaction: (emoji: string) => void;
  onToggleCustom: () => void;
}

export const LiveChatReactionToolbar: React.FC<LiveChatReactionToolbarProps> = ({
  active,
  customOpen,
  isCustomer,
  selectedEmoji,
  onToggleReaction,
  onToggleCustom,
}) => (
  <>
    {active && (
      <div
        role="presentation"
        className={`absolute -top-10 ${isCustomer ? 'left-0' : 'right-0'} z-30 bg-surface border border-divider rounded-full shadow-lg px-2 py-1 flex items-center gap-1 animate-fadeIn select-none`}
        onClick={(e) => e.stopPropagation()}
      >
        {QUICK_REACTIONS.map((emoji) => {
          const isSelected = selectedEmoji === emoji;
          return (
            <button
              key={emoji}
              type="button"
              onClick={() => onToggleReaction(emoji)}
              className={`w-7 h-7 flex items-center justify-center text-base rounded-full hover:scale-125 transition active:scale-95 ${
                isSelected ? 'bg-bubble-out ring-2 ring-accent' : 'hover:bg-fill-1'
              }`}
              title={`Reaksi ${emoji}${isSelected ? ' (klik untuk batal)' : ''}`}
              aria-label={`Reaksi ${emoji}${isSelected ? ', klik untuk batal' : ''}`}
            >
              {emoji}
            </button>
          );
        })}
        <button
          type="button"
          onClick={onToggleCustom}
          className={`w-7 h-7 flex items-center justify-center text-xs rounded-full hover:bg-fill-1 transition ${
            customOpen ? 'bg-accent-soft text-accent' : 'text-ink-2'
          }`}
          title="Pilih emoji lainnya"
          aria-label="Pilih emoji reaksi lainnya"
        >
          ➕
        </button>
      </div>
    )}

    {active && customOpen && (
      <div
        role="presentation"
        className={`absolute -top-28 ${isCustomer ? 'left-0' : 'right-0'} z-40 bg-surface border border-divider rounded-2xl shadow-xl p-2 grid grid-cols-6 gap-1 animate-fadeIn select-none`}
        onClick={(e) => e.stopPropagation()}
      >
        {EXTRA_REACTIONS.map((emoji) => {
          const isSelected = selectedEmoji === emoji;
          return (
            <button
              key={emoji}
              type="button"
              onClick={() => onToggleReaction(emoji)}
              className={`w-7 h-7 flex items-center justify-center text-base rounded-full hover:scale-125 transition active:scale-95 ${
                isSelected ? 'bg-bubble-out ring-2 ring-accent' : 'hover:bg-fill-1'
              }`}
              title={`Reaksi ${emoji}`}
              aria-label={`Reaksi ${emoji}`}
            >
              {emoji}
            </button>
          );
        })}
      </div>
    )}
  </>
);
