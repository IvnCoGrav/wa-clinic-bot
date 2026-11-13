import React, { useEffect, startTransition } from 'react';
import { connectLiveChatSse } from '../services/liveChatSse';
import { dedupeThreadMessages } from '../utils/livechatThread';
import { shouldReloadForSseEvent, shouldPreserveActiveChat, isSameConversation } from '../utils/livechatSourceFilter';
import { getCleanTreatmentName } from '../utils/treatmentFormatter';
import { resolveStaffName } from '../utils/resolveStaffName';
import { extractMedia, extractLocation } from '../utils/mediaExtractor';
import { preloadChatImage } from '../components/common/MediaImage';
import { saveConversationScroll, getConversationScroll } from './useLiveChatScroll';
import { extractQuotedMessage, type LiveChatItem, type ChatMessage } from '../types/livechat';
import { useUiFeedback } from '../components/common/UiFeedback';

export interface UseLiveChatSseParams {
  selectedIdRef: React.MutableRefObject<string | null>;
  sseConnectedRef: React.MutableRefObject<boolean>;
  setSseConnected: React.Dispatch<React.SetStateAction<boolean>>;
  loadChats: (reset?: boolean) => Promise<void>;
  refreshTotalUnread: (immediate?: boolean) => void;
  loadThread: (convId: string, focusId?: string) => Promise<void>;
  setChatBotActive: React.Dispatch<React.SetStateAction<boolean>>;
  setChats: React.Dispatch<React.SetStateAction<LiveChatItem[]>>;
  chatsRef: React.MutableRefObject<LiveChatItem[]>;
  setTotalUnreadCount: React.Dispatch<React.SetStateAction<number>>;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  optimisticMessageIdsRef: React.MutableRefObject<Set<string>>;
  scrollToBottom: (smooth?: boolean, force?: boolean) => void;
  chatContainerRef: React.RefObject<HTMLDivElement>;
  wasNearBottomRef: React.MutableRefObject<boolean>;
  savedScrollTopRef: React.MutableRefObject<number | null>;
  mobileViewRef: React.MutableRefObject<'list' | 'chat'>;
  isDesktopRef: React.MutableRefObject<boolean>;
  sourceFilterRef: React.MutableRefObject<any>;
  reservationRefreshRef: React.MutableRefObject<any>;
  lastReservationRefreshTimeRef: React.MutableRefObject<number>;
  delayAlertedRef: React.MutableRefObject<Set<string>>;
  loadDispatchTripRef: React.MutableRefObject<((resId: string) => void | Promise<void>) | null>;
  sortChats: (items: LiveChatItem[]) => LiveChatItem[];
  setCustomerDetailData: React.Dispatch<React.SetStateAction<any>>;
  setPinnedBubble: React.Dispatch<React.SetStateAction<any>>;
  setBgSyncProgress: React.Dispatch<React.SetStateAction<any>>;
  setSelectedReservation: (res: any) => void;
  setDelayAlert: React.Dispatch<React.SetStateAction<any>>;
  dispatchReservationIdRef: React.MutableRefObject<string | null>;
}

export function useLiveChatSse({
  selectedIdRef,
  sseConnectedRef,
  setSseConnected,
  loadChats,
  refreshTotalUnread,
  loadThread,
  setChatBotActive,
  setChats,
  chatsRef,
  setTotalUnreadCount,
  setMessages,
  optimisticMessageIdsRef,
  scrollToBottom,
  chatContainerRef,
  wasNearBottomRef,
  savedScrollTopRef,
  mobileViewRef,
  isDesktopRef,
  sourceFilterRef,
  reservationRefreshRef,
  lastReservationRefreshTimeRef,
  delayAlertedRef,
  loadDispatchTripRef,
  sortChats,
  setCustomerDetailData,
  setPinnedBubble,
  setBgSyncProgress,
  setSelectedReservation,
  setDelayAlert,
  dispatchReservationIdRef,
}: UseLiveChatSseParams) {
  const { toast } = useUiFeedback();
  useEffect(() => {
    loadChats(true);

    const unsubscribe = connectLiveChatSse({
      onStatusChange: (connected) => {
        const wasDisconnected = !sseConnectedRef.current && connected;
        setSseConnected(connected);
        sseConnectedRef.current = connected;
        if (wasDisconnected) {
          loadChats(true);
          refreshTotalUnread(true);
          if (selectedIdRef.current) {
            loadThread(selectedIdRef.current);
          }
        }
      },
      onEvent: (type, payload) => {
        if (type === 'bot.cutoff_changed' || type === 'BOT_CUTOFF_CHANGED') {
          // Emergency cut-off change tidak lagi ditampilkan di LiveChat header (internal chatbot)
          // Tetap sync cache untuk Settings panel jika ada
          return;
        }
        if (type === 'bot.active_changed' || type === 'BOT_ACTIVE_CHANGED') {
          const active = (payload as any)?.globalBotActive;
          if (typeof active === 'boolean') {
            setChatBotActive(active);
            // Cache lokal opsional: status bot tetap benar dari payload SSE.
        try { localStorage.setItem('wa_chatbot_active_state', String(active)); } catch {}
          }
          return;
        }
        if (type === 'conversation.updated' && payload?.allRead) {
          startTransition(() => setChats((prev) =>
            prev.map((c) => ({
              ...c,
              unreadCount: 0,
              isManualUnread: false,
            }))
          ));
          setTotalUnreadCount(0);
          return;
        }

        if (type === 'message.created') {
          refreshTotalUnread();
          const conversationId = payload.conversationId;
          const msgTime = payload.createdAt || payload.created_at || new Date().toISOString();
          const rawPayload = payload.payloadRaw || payload.payload_raw || payload.payload;
          const msg: ChatMessage = {
            id: payload.messageId || `sse_${Date.now()}`,
            wa_message_id: payload.waMessageId || payload.wa_message_id || null,
            direction: payload.direction,
            content: payload.content || '',
            sender_type: payload.senderType || payload.sender_type || null,
            sender_name: payload.senderName || payload.sender_name || null,
            created_at: msgTime,
            delivery_status: payload.deliveryStatus || 'sent',
            media: extractMedia(payload),
            location: payload.location || extractLocation(payload),
            quoted_message: extractQuotedMessage(payload),
            payload_raw: rawPayload,
          };

          // Append ke thread yang sedang dibuka / replace optimistic message
          if (selectedIdRef.current === conversationId) {
            const applyMessageCreated = () => {
              // User bisa pindah percakapan selama pra-muat berjalan.
              if (selectedIdRef.current !== conversationId) return;
              setMessages((prev) => {
                const mediaUrlOf = (x: ChatMessage) => (x.media as any)?.url || (x.media as any)?.hdUrl || (x.media as any)?.thumbUrl || null;
                // Cek apakah ada optimistic message (temp_) yang cocok — cocokkan via content identik atau media URL sama
                const tempIndex = prev.findIndex(
                  (m) =>
                    m.id.startsWith('temp_') &&
                    m.direction === msg.direction &&
                    (m.content === msg.content || (mediaUrlOf(m) && mediaUrlOf(msg) && mediaUrlOf(m) === mediaUrlOf(msg)))
                );
                if (tempIndex !== -1) {
                  const next = [...prev];
                  next[tempIndex] = {
                    ...msg,
                    id: msg.id || next[tempIndex].id,
                    media: msg.media || next[tempIndex].media,
                  };
                  return next;
                }

                // Dedupe berbasis identitas saja (pesan identik beruntun tetap tampil).
                const merged = dedupeThreadMessages([...prev, msg]);
                if (merged.length === prev.length) return prev;
                return merged;
              });
              optimisticMessageIdsRef.current.clear();
              setTimeout(() => scrollToBottom(true), 50);
            };

            // Anti-flash: bubble optimis masih menampilkan blob lokal. Pra-muat
            // thumbnail server DULU, baru ganti sumbernya → tidak ada overlay "Memuat...".
            const preloadTarget = (msg.media as any)?.thumbUrl || (msg.media as any)?.url;
            if (optimisticMessageIdsRef.current.size > 0 && preloadTarget) {
              void preloadChatImage(preloadTarget).then(applyMessageCreated);
            } else {
              applyMessageCreated();
            }
          }

          // Update preview daftar
          const current = chatsRef.current;
          const existing = current.find((c) => c.conversationId === conversationId);
          if (existing) {
            const isMsgInbound = msg.direction === 'INBOUND';
            const isAdminOutbound = msg.direction === 'OUTBOUND' && (msg.sender_type === 'ADMIN' || (msg as any).senderType === 'ADMIN');
            const isChatVisuallyActive = isDesktopRef.current || mobileViewRef.current === 'chat';
            const isCurrentOpen = selectedIdRef.current === conversationId && isChatVisuallyActive;
            const nextUnread = (isCurrentOpen || isAdminOutbound) ? 0 : (existing.unreadCount || 0) + (isMsgInbound ? 1 : 0);

            const updated = current.map((c) =>
              c.conversationId !== conversationId
                ? c
                : {
                    ...c,
                    lastMessageAt: msgTime,
                    lastMessages: [...(c.lastMessages || []), msg].slice(-3),
                    unreadCount: nextUnread,
                    isAwaitingReply: isAdminOutbound ? false : (isCurrentOpen && isMsgInbound),
                    isManualUnread: isAdminOutbound ? false : c.isManualUnread,
                    // Pulse alert SLA: balasan admin (dari web mana pun) memadamkan badge seketika.
                    isFrustrated: isAdminOutbound ? false : c.isFrustrated,
                    frustratedAt: isAdminOutbound ? null : c.frustratedAt,
                    frustratedReason: isAdminOutbound ? null : c.frustratedReason,
                  }
            );
            const sorted = sortChats(updated);
            startTransition(() => setChats(sorted));
            chatsRef.current = sorted;
          } else if (shouldReloadForSseEvent(payload, sourceFilterRef.current)) {
            // Percakapan baru muncul → reload daftar dari awal.
            // Issue 160: HANYA bila mode event cocok dengan filter aktif — mencegah
            // thrashing/kedip saat event real masuk di filter Sandbox (dan sebaliknya).
            loadChats(true);
          }
        } else if (type === 'conversation.updated') {
          refreshTotalUnread();
          const current = chatsRef.current;
          if (!current.some((c) => c.conversationId === payload.conversationId)) {
            if (shouldReloadForSseEvent(payload, sourceFilterRef.current)) {
              loadChats(true);
            }
            return;
          }
          const updated = current.map((c) =>
            c.conversationId === payload.conversationId
              ? {
                  ...c,
                  currentState: payload.currentState ?? c.currentState,
                  isHumanHandling: payload.isHumanHandling !== undefined ? !!payload.isHumanHandling : c.isHumanHandling,
                  humanHandlingSince: payload.humanHandlingSince ?? c.humanHandlingSince,
                  escalationReason: payload.escalationReason ?? c.escalationReason,
                  isPinned: payload.isPinned !== undefined ? !!payload.isPinned : c.isPinned,
                  pinnedAt: payload.pinnedAt ?? c.pinnedAt,
                  unreadCount: payload.unreadCount !== undefined ? payload.unreadCount : c.unreadCount,
                  isManualUnread: payload.isManualUnread !== undefined ? payload.isManualUnread : c.isManualUnread,
                  // Pulse alert SLA: satu bentuk payload standar — selalu ikut terpetakan.
                  isFrustrated: payload.isFrustrated !== undefined ? !!payload.isFrustrated : c.isFrustrated,
                  frustratedAt: payload.isFrustrated !== undefined ? (payload.frustratedAt ?? null) : c.frustratedAt,
                  frustratedReason: payload.isFrustrated !== undefined ? (payload.frustratedReason ?? null) : c.frustratedReason,
                  locationSource: payload.locationSource !== undefined ? payload.locationSource : c.locationSource,
                  effectiveLocationSource:
                    payload.effectiveLocationSource !== undefined
                      ? payload.effectiveLocationSource
                      : c.effectiveLocationSource,
                  locationAdequacy:
                    payload.locationAdequacy !== undefined ? payload.locationAdequacy : c.locationAdequacy,
                  sharelocNeeded:
                    payload.sharelocNeeded !== undefined ? payload.sharelocNeeded : c.sharelocNeeded,
                  shareLocationSent: payload.shareLocationSent !== undefined ? payload.shareLocationSent : c.shareLocationSent,
                  sharelocRequestedAt: payload.sharelocRequestedAt !== undefined ? payload.sharelocRequestedAt : c.sharelocRequestedAt,
                  activeConfirmedReservation: payload.activeConfirmedReservation !== undefined ? payload.activeConfirmedReservation : (c as any).activeConfirmedReservation,
                }
              : c
          );
          const sorted = sortChats(updated);
          startTransition(() => setChats(sorted));
          chatsRef.current = sorted;
          // F-C: bila event untuk chat yang sedang dibuka, segarkan snapshot reservasi
          if (payload.conversationId && payload.conversationId === selectedIdRef.current) {
            if (payload.activeConfirmedReservation) {
              setCustomerDetailData((prev: any) => {
                if (!prev) return prev;
                const existing = Array.isArray(prev.reservations) ? prev.reservations : [];
                const foundIndex = existing.findIndex((r: any) => r.id === payload.activeConfirmedReservation.id);
                let nextRes: any[];
                if (foundIndex >= 0) {
                  nextRes = [...existing];
                  nextRes[foundIndex] = { ...nextRes[foundIndex], ...payload.activeConfirmedReservation };
                } else {
                  nextRes = [payload.activeConfirmedReservation, ...existing];
                }
                return { ...prev, reservations: nextRes };
              });
            }
            const now = Date.now();
            if (now - lastReservationRefreshTimeRef.current >= 1000) {
              lastReservationRefreshTimeRef.current = now;
              reservationRefreshRef.current?.();
            }
          }
        } else if (type === 'message.updated' && (payload?.messageId || payload?.waMessageId)) {
          const { messageId, waMessageId, content, isRevoked, isEdited, isMessagePinned, isMessageHidden, payload_raw } = payload;
          const matchesUpdated = (m: any) => {
            if (messageId && (m.id === messageId || m.wa_message_id === messageId)) return true;
            if (waMessageId && (m.id === waMessageId || m.wa_message_id === waMessageId)) return true;
            const shortA = messageId ? String(messageId).split('_').pop() : null;
            if (shortA && m.wa_message_id && String(m.wa_message_id).endsWith(`_${shortA}`)) return true;
            return false;
          };
          if (selectedIdRef.current === payload.conversationId) {
            setMessages((prev) =>
              prev.map((m) =>
                matchesUpdated(m)
                  ? {
                      ...m,
                      content: content !== undefined ? content : m.content,
                      is_revoked: isRevoked !== undefined ? isRevoked : m.is_revoked,
                      is_edited: isEdited !== undefined ? isEdited : (m as any).is_edited,
                      is_message_pinned: isMessagePinned !== undefined ? isMessagePinned : ((m as any).is_message_pinned ?? (m as any).payload_raw?.is_pinned),
                      is_message_hidden: isMessageHidden !== undefined ? isMessageHidden : ((m as any).is_message_hidden ?? (m as any).payload_raw?.is_hidden),
                      pinned_by: payload.pinnedBy !== undefined ? payload.pinnedBy : (m.pinned_by || (m as any).payload_raw?.pinned_by),
                      pinned_at: payload.pinnedAt !== undefined ? payload.pinnedAt : (m.pinned_at || (m as any).payload_raw?.pinned_at),
                      hidden_by: payload.hiddenBy !== undefined ? payload.hiddenBy : (m.hidden_by || (m as any).payload_raw?.hidden_by),
                      hidden_at: payload.hiddenAt !== undefined ? payload.hiddenAt : (m.hidden_at || (m as any).payload_raw?.hidden_at),
                      media: payload.media !== undefined ? payload.media : (m as any).media,
                      payload_raw: {
                        ...((m as any).payload_raw || {}),
                        ...(payload_raw || {}),
                        ...(payload.media !== undefined ? { media: payload.media } : {}),
                        ...(isMessagePinned !== undefined ? { is_pinned: isMessagePinned } : {}),
                        ...(isMessageHidden !== undefined ? { is_hidden: isMessageHidden } : {}),
                      },
                    }
                  : (isMessagePinned ? {
                      // single-pin: jika pesan lain di-pin di percakapan yang sama, unpin pesan ini
                      ...m,
                      is_message_pinned: false,
                      payload_raw: {
                        ...((m as any).payload_raw || {}),
                        is_pinned: false,
                      },
                    } : m)
              )
            );

            // Sinkronkan state pinnedBubble di header percakapan aktif
            if (isMessagePinned === true) {
              setPinnedBubble({
                id: messageId || waMessageId,
                wa_message_id: waMessageId || messageId,
                content: content || 'Pesan yang disematkan',
                sender_name: payload.sender_name,
                sender_type: payload.sender_type,
                created_at: payload.created_at || new Date().toISOString(),
                pinned_by: payload.pinnedBy,
                pinned_at: payload.pinnedAt,
              });
            } else if (isMessagePinned === false) {
              setPinnedBubble((current: any) => {
                if (!current) return null;
                const matchId = messageId || waMessageId;
                if (current.id === matchId || (current.wa_message_id && current.wa_message_id === matchId)) return null;
                return current;
              });
            }
          }
        } else if ((type === 'message:reaction' || type === 'message.reaction') && (payload?.messageId || payload?.waMessageId)) {
          const { messageId, waMessageId, conversationId, reactions } = payload;
          const idsMatch = (a?: string | null, b?: string | null) => {
            if (!a || !b) return false;
            if (a === b) return true;
            const shortA = String(a).split('_').pop() || a;
            const shortB = String(b).split('_').pop() || b;
            return shortA === shortB || String(a).endsWith(String(b)) || String(b).endsWith(String(a));
          };
          if (!conversationId || selectedIdRef.current === conversationId) {
            setMessages((prev) =>
              prev.map((m) => {
                if (
                  (messageId && (m.id === messageId || idsMatch(m.id, messageId) || idsMatch((m as any).wa_message_id, messageId))) ||
                  (waMessageId && (m.wa_message_id === waMessageId || m.id === waMessageId || idsMatch((m as any).wa_message_id, waMessageId) || idsMatch(m.id, waMessageId)))
                ) {
                  return {
                    ...m,
                    reactions,
                    payload_raw: {
                      ...(typeof m.payload_raw === 'object' && m.payload_raw ? m.payload_raw : {}),
                      reactions,
                    },
                  };
                }
                return m;
              })
            );
          }
      // Reaksi staf pada pesan customer terakhir = sudah dibalas (keputusan
      // produk 2026-11-11). Padamkan badge tanpa menunggu polling.
      const hasStaffReactionInPayload =
        Array.isArray(reactions) && reactions.some((r: any) => r?.fromMe === true && r?.emoji);
      if (hasStaffReactionInPayload && conversationId) {
        setChats((prev) =>
          prev.map((c) =>
            c.conversationId === conversationId ? { ...c, isAwaitingReply: false } : c
          )
        );
      }
        } else if (type === 'message.status_updated' && (payload?.messageId || payload?.waMessageId)) {
          const { messageId, waMessageId, conversationId, status, deliveredAt, readAt } = payload;
          if (!conversationId || selectedIdRef.current === conversationId) {
            setMessages((prev) =>
              prev.map((m) => {
                if (
                  (messageId && m.id === messageId) ||
                  (waMessageId && (m.wa_message_id === waMessageId || m.id === waMessageId))
                ) {
                  return {
                    ...m,
                    delivery_status: status,
                    delivered_at: deliveredAt || m.delivered_at,
                    read_at: readAt || m.read_at,
                  };
                }
                return m;
              })
            );
          }
          // Sinkronisasi ticks sidebar: centang di daftar ikut realtime saat ACK tiba.
          if (conversationId) {
            const updatedChats = chatsRef.current.map((c) =>
              c.conversationId !== conversationId
                ? c
                : {
                    ...c,
                    lastMessages: (c.lastMessages || []).map((m: any) =>
                      (messageId && (m.id === messageId || m.wa_message_id === messageId)) ||
                      (waMessageId && (m.wa_message_id === waMessageId || m.id === waMessageId))
                        ? { ...m, delivery_status: status, delivered_at: deliveredAt || m.delivered_at, read_at: readAt || m.read_at }
                        : m
                    ),
                  }
            );
            chatsRef.current = updatedChats;
            startTransition(() => setChats([...updatedChats]));
          }
        } else if (type === ('sync.progress' as any) || payload?.status) {
          const syncData = payload.payload || payload;
          if (syncData && typeof syncData.syncedChats === 'number') {
            setBgSyncProgress((prev: any) => ({ ...prev, ...syncData }));
            if (syncData.status === 'completed') {
              loadChats(true);
            }
          }
        } else if (type === 'customer.location_updated') {
          const { customerId, reservationId, lat, lng, distanceKm, ongkir, landmark, housePhotoUrl } = payload;
          if (selectedIdRef.current) {
            setSelectedReservation((prev: any) => {
              if (!prev) return prev;
              const needsUpdate = prev.reservationId === reservationId;
              if (!needsUpdate) return prev;
              return {
                ...prev,
                lat: lat ?? prev.lat,
                lng: lng ?? prev.lng,
                distanceKm: distanceKm ?? prev.distanceKm,
                ongkir: ongkir ?? prev.ongkir,
                landmark: landmark ?? prev.landmark,
                housePhotoUrl: housePhotoUrl ?? prev.housePhotoUrl,
              };
            });
          }
          // Sinkron kartu sidebar + drawer profil pasien agar jarak & ongkir konsisten
          // di seluruh permukaan (sidebar, profil, modal reservasi).
          if (customerId) {
            const updatedChats = chatsRef.current.map((c) =>
              c.customerId === customerId
                ? {
                    ...c,
                    distanceKm: distanceKm ?? (c as any).distanceKm,
                    ongkir: ongkir ?? (c as any).ongkir,
                    lat: lat ?? (c as any).lat,
                    lng: lng ?? (c as any).lng,
                  }
                : c
            );
            chatsRef.current = updatedChats;
            startTransition(() => setChats(updatedChats));
            setCustomerDetailData((prev: any) => {
              if (!prev || prev.id !== customerId) return prev;
              return {
                ...prev,
                distance_km: distanceKm ?? prev.distance_km,
                ongkir: ongkir ?? prev.ongkir,
                lat: lat ?? prev.lat,
                lng: lng ?? prev.lng,
                preferences: {
                  ...(prev.preferences || {}),
                  ...(landmark ? { landmark } : {}),
                },
              };
            });
          }
        } else if (type === 'staff.task_completed') {
          const { reservationId, staffId, staffName, completedAt } = payload;
          if (selectedIdRef.current) {
            setSelectedReservation((prev: any) => {
              if (!prev || prev.reservationId !== reservationId) return prev;
              return {
                ...prev,
                reservationStatus: 'completed',
                completedAt,
                completedBy: staffName,
              };
            });
          }
        } else if (type === 'staff.telemetry_updated') {
          // Posisi terapis terbaru — perbarui widget bila relevan dengan chat terpilih.
          const reservationId = payload?.reservationId;
          if (reservationId && dispatchReservationIdRef.current === reservationId) {
            loadDispatchTripRef.current?.(reservationId);
          }
        } else if (type === 'staff.trip_closed') {
          const reservationId = payload?.reservationId;
          if (reservationId && dispatchReservationIdRef.current === reservationId) {
            loadDispatchTripRef.current?.(reservationId);
          }
        } else if (type === 'staff.trip_delay_warning') {
          const reservationId = payload?.reservationId;
          if (!reservationId) return;
          const level = payload?.level === 'critical' ? 'critical' : 'warning';
          setDelayAlert({
            reservationId,
            staffName: payload?.staffName,
            patientName: payload?.patientName,
            level,
            delayMinutes: Number(payload?.delayMinutes) || 0,
            formattedArrivalWib: payload?.formattedArrivalWib,
          });
          // Toast SEKALI per reservasi (dedupe) — ikon pulse di header tetap tampil.
          if (!delayAlertedRef.current.has(reservationId)) {
            delayAlertedRef.current.add(reservationId);
            const who = payload?.staffName ? `Bidan ${payload.staffName}` : 'Bidan';
            const eta = payload?.formattedArrivalWib ? ` (estimasi tiba ±${payload.formattedArrivalWib} WIB)` : '';
            toast(
              `⚠️ ${who} diprediksi terlambat ${Number(payload?.delayMinutes) || 0} menit${eta}.`,
              level === 'critical' ? 'error' : 'info'
            );
          }
          if (dispatchReservationIdRef.current === reservationId) {
            loadDispatchTripRef.current?.(reservationId);
          }
        } else if (type === 'staff.trip_arrived') {
          const reservationId = payload?.reservationId;
          if (reservationId) {
            setDelayAlert((prev: any) => (prev && prev.reservationId === reservationId ? null : prev));
          }
          const staffName = payload?.staffName ? `Bidan ${payload.staffName}` : 'Bidan';
          const patientName = payload?.patientName ? `Bunda ${payload.patientName}` : 'pasien';
          toast(`${staffName} telah tiba di lokasi ${patientName}.`, 'success');
          if (reservationId && dispatchReservationIdRef.current === reservationId) {
            loadDispatchTripRef.current?.(reservationId);
          }
        }
      },
    });

    // 🔄 Smart Event-Driven / Fallback Background Sync
    // Saat SSE aktif, polling konstan 3.5s dimatikan untuk menghemat 95% resource & mencegah UI jitter.
    // Jika SSE terputus, gunakan fallback interval 15s.
    const pollInterval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        if (!sseConnectedRef.current) {
          loadChats(true);
        }
      }
    }, 15000);

    const captureCurrentScroll = () => {
      const el = chatContainerRef.current;
      if (el) {
        savedScrollTopRef.current = el.scrollTop;
        const isNear = (el.scrollHeight - el.scrollTop - el.clientHeight) < 300;
        wasNearBottomRef.current = isNear;
        if (selectedIdRef.current) {
          saveConversationScroll(selectedIdRef.current, el.scrollTop, isNear);
        }
      }
    };

    const restoreCurrentScroll = () => {
      const el = chatContainerRef.current;
      if (!el) return;
      if (wasNearBottomRef.current) {
        scrollToBottom(true, false);
      } else if (savedScrollTopRef.current !== null) {
        el.scrollTop = savedScrollTopRef.current;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        captureCurrentScroll();
      } else if (document.visibilityState === 'visible') {
        // Jangan reset paginasi/urutan sidebar saat tab kembali terlihat. Saat SSE aktif,
        // cukup segarkan badge unread & thread aktif (silent). Fallback loadChats(true)
        // HANYA bila SSE terputus (data memang mungkin basi).
        if (sseConnectedRef.current) {
          refreshTotalUnread();
          if (selectedIdRef.current) {
            void loadThread(selectedIdRef.current);
          }
        } else {
          loadChats(true);
        }
        // Preserve posisi baca: hanya auto-scroll jika sebelumnya memang di bawah
        setTimeout(restoreCurrentScroll, 60);
        setTimeout(restoreCurrentScroll, 160);
      }
    };

    const handleWindowBlur = () => {
      captureCurrentScroll();
    };

    const handleWindowFocus = () => {
      setTimeout(restoreCurrentScroll, 60);
      setTimeout(restoreCurrentScroll, 160);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);

    return () => {
      unsubscribe();
      clearInterval(pollInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
