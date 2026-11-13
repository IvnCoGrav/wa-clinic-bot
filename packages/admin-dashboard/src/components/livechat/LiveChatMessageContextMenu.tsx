import React from 'react';
import {
  Pin,
  Mail,
  MailCheck,
  Bot,
  User,
  BellOff,
  Tag,
  Check,
} from 'lucide-react';
import { CustomerAvatar } from '../common/CustomerAvatar';

export interface LiveChatMessageContextMenuProps {
  contextMenu: { x: number; y: number; chat: any } | null;
  allLabels: any[];
  togglingLabelId: string | null;
  onClose: () => void;
  onTogglePin: (chat: any) => void;
  onToggleReadStatus: (chat: any) => void;
  onTakeover: (chat: any) => void;
  onRelease: (chat: any) => void;
  onDismissFrustration: (chat: any) => void;
  onToggleLabel: (customerId: string, label: any) => void;
}

export const LiveChatMessageContextMenu: React.FC<LiveChatMessageContextMenuProps> = ({
  contextMenu,
  allLabels,
  togglingLabelId,
  onClose,
  onTogglePin,
  onToggleReadStatus,
  onTakeover,
  onRelease,
  onDismissFrustration,
  onToggleLabel,
}) => {
  if (!contextMenu) return null;

  return (
    <div
      className="modal-backdrop fixed inset-0 z-50 flex items-end sm:items-start sm:justify-start p-0 bg-black/40 sm:bg-transparent sm:backdrop-blur-none animate-in fade-in duration-150"
      onClick={onClose}
    >
      {/* Mobile Bottom Action Sheet (sm:hidden) */}
      <div
        className="sm:hidden w-full bg-surface rounded-t-2xl shadow-2xl p-4 space-y-3 animate-in slide-in-from-bottom duration-200 border-t border-divider max-h-[80dvh] overflow-y-auto overscroll-contain pb-[max(1rem,env(safe-area-inset-bottom,1rem))]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Grab Handle */}
        <div className="w-10 h-1 bg-strong rounded-full mx-auto" />

        {/* Header info */}
        <div className="flex items-center space-x-3 pb-2 border-b border-divider">
          <CustomerAvatar
            src={contextMenu.chat.customerProfilePictureUrl}
            name={contextMenu.chat.customerName || 'Customer'}
            phone={contextMenu.chat.customerPhone}
            size="sm"
          />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-ink truncate">
              {contextMenu.chat.customerName || 'Customer'}
            </p>
            <p className="text-[11px] text-ink-2 font-mono">
              {contextMenu.chat.customerPhone || 'Unknown'}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={() => onTogglePin(contextMenu.chat)}
            className="w-full px-3.5 py-3 text-left rounded-xl bg-surface-2 hover:bg-fill-1 active:bg-fill-2 flex items-center space-x-3 transition font-medium text-xs text-ink cursor-pointer"
          >
            <Pin size={16} className={contextMenu.chat.isPinned ? 'text-accent fill-current' : 'text-ink-2'} />
            <span>{contextMenu.chat.isPinned ? 'Lepas Sematan (Unpin dari Atas)' : 'Sematkan Percakapan (Pin ke Atas)'}</span>
          </button>

          <button
            type="button"
            onClick={() => onToggleReadStatus(contextMenu.chat)}
            className="w-full px-3.5 py-3 text-left rounded-xl bg-surface-2 hover:bg-fill-1 active:bg-fill-2 flex items-center space-x-3 transition font-medium text-xs text-ink cursor-pointer"
          >
            {(contextMenu.chat.unreadCount || 0) > 0 || contextMenu.chat.isManualUnread ? (
              <>
                <MailCheck size={16} className="text-success" />
                <span>Tandai Sudah Dibaca</span>
              </>
            ) : (
              <>
                <Mail size={16} className="text-accent" />
                <span>Tandai Belum Dibaca (Badge Hijau Tua)</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              const c = contextMenu.chat;
              onClose();
              if (c.isHumanHandling) {
                onRelease(c);
              } else {
                onTakeover(c);
              }
            }}
            className="w-full px-3.5 py-3 text-left rounded-xl bg-surface-2 hover:bg-fill-1 active:bg-fill-2 flex items-center space-x-3 transition font-medium text-xs text-ink-2 cursor-pointer"
          >
            {contextMenu.chat.isHumanHandling ? (
              <>
                <Bot size={16} />
                <span>Kembalikan ke Bot AI</span>
              </>
            ) : (
              <>
                <User size={16} className="text-warning" />
                <span>Ambil Alih Manual (CS)</span>
              </>
            )}
          </button>
        </div>

        {contextMenu.chat.isFrustrated && (
          <div>
            <button
              type="button"
              onClick={() => onDismissFrustration(contextMenu.chat)}
              className="w-full px-3.5 py-3 text-left rounded-xl bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/50 active:bg-rose-200/70 flex items-center space-x-3 transition font-medium text-xs text-rose-600 dark:text-danger cursor-pointer"
            >
              <BellOff size={16} className="text-rose-600 dark:text-danger" />
              <span>Padamkan Peringatan SLA</span>
            </button>
          </div>
        )}

        {/* System Labels Section */}
        <div className="pt-2 pb-1 border-t border-divider space-y-1.5">
          <div className="flex items-center justify-between px-1 text-[11px] font-bold text-ink-2">
            <span className="flex items-center space-x-1.5">
              <Tag size={13} className="text-accent" />
              <span>Label Pasien (Sistem CRM)</span>
            </span>
            <a
              href="/admin/labels"
              className="text-[10px] text-accent hover:underline font-semibold"
              onClick={(e) => e.stopPropagation()}
            >
              Kelola Label
            </a>
          </div>
          {allLabels.length === 0 ? (
            <p className="text-[11px] text-ink-3 px-1 py-0.5">Belum ada label sistem.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5 pt-0.5 max-h-36 overflow-y-auto overscroll-contain" data-no-select="true">
              {allLabels.map((lbl) => {
                const isAssigned = (contextMenu.chat.customerLabels || []).some((l: any) => l.id === lbl.id);
                return (
                  <button
                    key={lbl.id}
                    type="button"
                    onClick={() => onToggleLabel(contextMenu.chat.customerId, lbl)}
                    disabled={togglingLabelId === lbl.id}
                    className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition cursor-pointer shadow-2xs border active:scale-95 ${
                      isAssigned
                        ? 'text-white border-transparent'
                        : 'bg-surface-2 text-ink-2 border-divider hover:bg-fill-1'
                    }`}
                    style={{
                      backgroundColor: isAssigned ? lbl.color || 'rgb(var(--c-accent))' : undefined,
                    }}
                    title={`Klik untuk ${isAssigned ? 'lepas' : 'pasang'} label ${lbl.name}`}
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: isAssigned ? 'rgb(var(--c-surface))' : lbl.color }}
                    />
                    <span>{lbl.name}</span>
                    {isAssigned && <Check size={12} className="text-white shrink-0 ml-0.5 stroke-[3]" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Cancel Button */}
        <button
          type="button"
          onClick={onClose}
          className="w-full py-3 bg-fill-1 active:bg-fill-2 text-ink font-bold text-xs rounded-xl transition cursor-pointer"
        >
          Batal
        </button>
      </div>

      {/* Desktop Floating Popover (hidden sm:block) — mengikuti koordinat mouse + clamp tepi layar */}
      <div
        style={{
          position: 'fixed',
          left: Math.min(contextMenu.x, Math.max(0, (typeof window !== 'undefined' ? window.innerWidth : 0) - 272)),
          top: Math.min(contextMenu.y, Math.max(0, (typeof window !== 'undefined' ? window.innerHeight : 0) - 420)),
          zIndex: 51,
        }}
        className="hidden sm:block bg-surface border border-divider rounded-xl shadow-2xl py-1.5 w-64 text-xs text-ink animate-in fade-in zoom-in-95 origin-top-left duration-100 divide-y divide-divider max-h-[70dvh] overflow-y-auto overscroll-contain"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3.5 py-2 text-[11px] font-bold text-ink-2 truncate">
          {contextMenu.chat.customerName || contextMenu.chat.customerPhone || 'Opsi Percakapan'}
        </div>
        <div className="py-1">
          <button
            type="button"
            onClick={() => onTogglePin(contextMenu.chat)}
            className="w-full px-3.5 py-2.5 text-left hover:bg-fill-1 flex items-center space-x-2.5 transition font-medium cursor-pointer"
          >
            <Pin size={14} className={contextMenu.chat.isPinned ? 'text-accent fill-current' : 'text-ink-2'} />
            <span>{contextMenu.chat.isPinned ? 'Lepas Sematan (Unpin)' : 'Sematkan Chat (Pin ke Atas)'}</span>
          </button>
          <button
            type="button"
            onClick={() => onToggleReadStatus(contextMenu.chat)}
            className="w-full px-3.5 py-2.5 text-left hover:bg-fill-1 flex items-center space-x-2.5 transition font-medium cursor-pointer"
          >
            {(contextMenu.chat.unreadCount || 0) > 0 || contextMenu.chat.isManualUnread ? (
              <>
                <MailCheck size={14} className="text-success" />
                <span>Tandai Sudah Dibaca</span>
              </>
            ) : (
              <>
                <Mail size={14} className="text-accent" />
                <span>Tandai Belum Dibaca (Hijau Tua)</span>
              </>
            )}
          </button>
        </div>
        <div className="py-1">
          <button
            type="button"
            onClick={() => {
              const c = contextMenu.chat;
              onClose();
              if (c.isHumanHandling) {
                onRelease(c);
              } else {
                onTakeover(c);
              }
            }}
            className="w-full px-3.5 py-2.5 text-left hover:bg-fill-1 flex items-center space-x-2.5 transition text-ink-2 font-medium cursor-pointer"
          >
            {contextMenu.chat.isHumanHandling ? (
              <>
                <Bot size={14} />
                <span>Kembalikan ke Bot AI</span>
              </>
            ) : (
              <>
                <User size={14} className="text-warning" />
                <span>Ambil Alih Manual (CS)</span>
              </>
            )}
          </button>
        </div>
        {contextMenu.chat.isFrustrated && (
          <div className="py-1">
            <button
              type="button"
              onClick={() => onDismissFrustration(contextMenu.chat)}
              className="w-full px-3.5 py-2.5 text-left hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center space-x-2.5 transition font-medium cursor-pointer text-rose-600 dark:text-danger"
            >
              <BellOff size={14} className="text-rose-600 dark:text-danger" />
              <span>Padamkan Peringatan SLA</span>
            </button>
          </div>
        )}

        {/* System Labels Section (Desktop) */}
        <div className="py-2 px-3 space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-bold text-ink-2">
            <span className="flex items-center space-x-1">
              <Tag size={12} className="text-accent" />
              <span>Label Sistem (CRM)</span>
            </span>
            <a
              href="/admin/labels"
              className="text-[10px] text-accent hover:underline font-semibold"
              onClick={(e) => e.stopPropagation()}
            >
              Kelola
            </a>
          </div>
          {allLabels.length === 0 ? (
            <p className="text-[11px] text-ink-3 py-0.5">Belum ada label sistem.</p>
          ) : (
            <div className="flex flex-wrap gap-1 pt-0.5 max-h-32 overflow-y-auto overscroll-contain">
              {allLabels.map((lbl) => {
                const isAssigned = (contextMenu.chat.customerLabels || []).some((l: any) => l.id === lbl.id);
                return (
                  <button
                    key={lbl.id}
                    type="button"
                    onClick={() => onToggleLabel(contextMenu.chat.customerId, lbl)}
                    disabled={togglingLabelId === lbl.id}
                    className={`px-2 py-1 rounded-lg text-[11px] font-semibold flex items-center space-x-1 transition cursor-pointer shadow-2xs border ${
                      isAssigned
                        ? 'text-white border-transparent'
                        : 'bg-surface-2 text-ink-2 border-divider hover:bg-fill-1'
                    }`}
                    style={{
                      backgroundColor: isAssigned ? lbl.color || 'rgb(var(--c-accent))' : undefined,
                    }}
                    title={`Klik untuk ${isAssigned ? 'lepas' : 'pasang'} label ${lbl.name}`}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: isAssigned ? 'rgb(var(--c-surface))' : lbl.color }}
                    />
                    <span>{lbl.name}</span>
                    {isAssigned && <Check size={11} className="text-white shrink-0 ml-0.5 stroke-[3]" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
