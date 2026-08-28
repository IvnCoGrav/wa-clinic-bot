import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { hasAccess } from '../config/rolePermissions';
import { connectLiveChatSse } from '../services/liveChatSse';
import {
  initAudioUnlock,
  unlockAudioContext,
  playIncomingMessageSound,
  showBrowserNotification,
  isSoundEnabled,
  setSoundEnabled,
  requestNotificationPermission,
} from '../services/notificationSound';
import { apiRequest } from '../services/api';

export interface IncomingChatToast {
  id: string;
  conversationId: string;
  customerName: string;
  customerPhone?: string;
  content: string;
  createdAt: string;
}

export function useLiveChatNotification(currentRole: string) {
  const navigate = useNavigate();
  const location = useLocation();
  const [incomingToast, setIncomingToast] = useState<IncomingChatToast | null>(null);
  const [soundActive, setSoundActive] = useState<boolean>(() => isSoundEnabled());
  const [unreadLiveChatCount, setUnreadLiveChatCount] = useState<number>(0);
  const recentMessageIdsRef = useRef<Set<string>>(new Set());
  const toastTimeoutRef = useRef<any>(null);

  // Check if current logged-in role has permissions to access Live Chat
  const canAccessLiveChat = hasAccess(currentRole, '/admin/live-chat');

  // Toggle sound mute/unmute
  const toggleSound = useCallback(() => {
    const next = !soundActive;
    setSoundActive(next);
    setSoundEnabled(next);
    unlockAudioContext();
    if (next) {
      playIncomingMessageSound(true);
    }
  }, [soundActive]);

  // Test sound generator explicitly
  const playTestSound = useCallback(() => {
    unlockAudioContext();
    setSoundActive(true);
    setSoundEnabled(true);
    playIncomingMessageSound(true);
  }, []);

  // Request browser desktop/mobile push notification permission & register VAPID Web Push
  const requestPushPermission = useCallback(async () => {
    const { subscribeToPushNotifications } = await import('../services/pushNotification');
    const result = await subscribeToPushNotifications(currentRole || 'ADMIN');
    return result.success ? 'granted' : 'denied';
  }, [currentRole]);

  // Auto-subscribe to Web Push if permission was previously granted
  useEffect(() => {
    if (!canAccessLiveChat) return;
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      import('../services/pushNotification').then(({ subscribeToPushNotifications }) => {
        subscribeToPushNotifications(currentRole || 'ADMIN').catch(() => {});
      });
    }
  }, [canAccessLiveChat, currentRole]);

  // Fetch initial unread count on mount if authorized (ultra lightweight endpoint)
  useEffect(() => {
    if (!canAccessLiveChat) return;

    let isMounted = true;
    apiRequest('/api/admin/live-chat/unread-count')
      .then((res) => {
        if (!isMounted) return;
        if (res?.success && typeof res.count === 'number') {
          setUnreadLiveChatCount(res.count);
        } else if (typeof res === 'number') {
          setUnreadLiveChatCount(res);
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [canAccessLiveChat]);

  // Initialize Web Audio Auto-Unlock listener
  useEffect(() => {
    if (!canAccessLiveChat) return;
    const cleanup = initAudioUnlock();
    return cleanup;
  }, [canAccessLiveChat]);

  // Persistent Live Chat SSE Subscription for Notifications
  useEffect(() => {
    if (!canAccessLiveChat) return;

    const unsubscribe = connectLiveChatSse({
      onEvent: (type, payload) => {
        if (type === 'conversation.updated') {
          if (payload?.allRead) {
            setUnreadLiveChatCount(0);
          }
        }

        if (type === 'message.created') {
          // Abaikan pesan dari sandbox / QA test simulator (tidak perlu ada notifikasi suara, toast, browser push, atau badge)
          if (payload.isSandboxTest || payload.is_sandbox_test || payload.isSandbox) return;

          const msgId = payload.messageId || `${payload.conversationId}_${Date.now()}`;
          const isCustomer =
            payload.direction === 'INBOUND' ||
            payload.senderType === 'CUSTOMER' ||
            payload.sender_type === 'CUSTOMER';

          // Abaikan pesan outbound CS dan pesan riwayat masa lalu (historical sync)
          if (!isCustomer || payload.isHistorical) return;

          // Anti-duplicate protection (10 seconds window per message ID)
          if (recentMessageIdsRef.current.has(msgId)) return;
          recentMessageIdsRef.current.add(msgId);
          setTimeout(() => {
            recentMessageIdsRef.current.delete(msgId);
          }, 10000);

          const customerName = payload.senderName || payload.sender_name || 'Pelanggan WhatsApp';
          const content = payload.content || (payload.media ? `[${payload.media.type || 'Media'}]` : 'Mengirim pesan baru');
          const conversationId = payload.conversationId;

          // 1. Play realistic WhatsApp two-tone audio chime & haptic vibration
          playIncomingMessageSound();

          // 2. Show HTML5 Native Browser Notification (only fallback if service worker is not active)
          const isDocHidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
          if (isDocHidden && !('serviceWorker' in navigator)) {
            showBrowserNotification({
              title: customerName,
              body: content,
              conversationId,
              onClick: () => {
                navigate('/admin/live-chat');
              },
            });
          }

          // 3. Increment sidebar unread badge
          setUnreadLiveChatCount((prev) => prev + 1);

          // 4. Show sleek in-app top drop-down banner (if not currently replying in live-chat)
          const isCurrentlyInLiveChat = location.pathname.includes('/live-chat');
          // If on other pages, always show floating toast. If already in live chat, toast is subtler.
          if (!isCurrentlyInLiveChat) {
            if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
            setIncomingToast({
              id: msgId,
              conversationId,
              customerName,
              content,
              createdAt: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
            });

            toastTimeoutRef.current = setTimeout(() => {
              setIncomingToast(null);
            }, 6500);
          }
        }
      },
    });

    return () => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
      unsubscribe();
    };
  }, [canAccessLiveChat, location.pathname, navigate]);

  const dismissToast = useCallback(() => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setIncomingToast(null);
  }, []);

  const openChatFromToast = useCallback(
    (conversationId: string) => {
      dismissToast();
      navigate('/admin/live-chat');
    },
    [dismissToast, navigate]
  );

  return {
    incomingToast,
    dismissToast,
    openChatFromToast,
    soundActive,
    toggleSound,
    playTestSound,
    requestPushPermission,
    unreadLiveChatCount,
    canAccessLiveChat,
  };
}
