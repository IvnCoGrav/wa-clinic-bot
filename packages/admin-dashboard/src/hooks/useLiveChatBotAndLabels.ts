import { useState, useRef, useEffect } from 'react';
import { apiRequest } from '../services/api';
import { BRAND } from '../config/brand';
import { emitBootPhase } from '../lib/bootProgress';
import type { CustomerLabelData, LiveChatItem } from '../types/livechat';

export interface UseLiveChatBotAndLabelsProps {
  chatsRef: React.MutableRefObject<LiveChatItem[]>;
  setChats: React.Dispatch<React.SetStateAction<LiveChatItem[]>>;
  loadChats: (silent?: boolean) => Promise<void>;
  setContextMenu: React.Dispatch<React.SetStateAction<{ x: number; y: number; chat: LiveChatItem } | null>>;
  setCustomerDetailData: React.Dispatch<React.SetStateAction<any>>;
  toast: (message: string, type?: 'info' | 'success' | 'error') => void;
  confirm: (options: {
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    danger?: boolean;
  }) => Promise<boolean>;
}

export function useLiveChatBotAndLabels({
  chatsRef,
  setChats,
  loadChats,
  setContextMenu,
  setCustomerDetailData,
  toast,
  confirm,
}: UseLiveChatBotAndLabelsProps) {
  // 🤖 Internal Chatbot AI ON/OFF (bukan Emergency Kill-Switch)
  const [chatBotActive, setChatBotActive] = useState(() => {
    try {
      const cached = localStorage.getItem('wa_chatbot_active_state');
      return cached ? cached === 'true' : true;
    } catch { return true; }
  });
  const [togglingBotCutoff, setTogglingBotCutoff] = useState(false);
  // Brand klinik tenant-aware (dari DB) untuk interpolasi template balasan.
  const [clinicBrandName, setClinicBrandName] = useState<string>(BRAND.businessName);

  const loadBotCutoffStatus = async () => {
    try {
      const data = await apiRequest('/api/admin/settings');
      const active = (data as any)?.globalBotActive ?? (data as any)?.data?.globalBotActive;
      if (typeof active === 'boolean') {
        setChatBotActive(active);
        try { localStorage.setItem('wa_chatbot_active_state', String(active)); } catch {}
      }
      const brand = (data as any)?.brand ?? (data as any)?.data?.brand;
      if (brand && typeof brand.businessName === 'string' && brand.businessName.trim()) {
        setClinicBrandName(brand.businessName.trim());
      }
    } catch (_) {}
  };

  useEffect(() => {
    loadBotCutoffStatus();
  }, []);

  const handleToggleGlobalBot = async (enableBot: boolean) => {
    const isConfirm = await confirm({
      title: enableBot ? 'Aktifkan Chatbot AI?' : 'Nonaktifkan Chatbot AI?',
      message: enableBot
        ? 'Chatbot AI akan kembali membalas pesan customer secara otomatis. Follow-Up & balasan Live Chat manual tetap bisa dikirim.'
        : 'Chatbot AI akan dinonaktifkan — AI tidak membalas, percakapan dialihkan ke CS manual. Follow-Up & balasan Live Chat manual tetap aktif. Emergency Kill-Switch ada di Settings → WhatsApp Provider.',
      confirmText: enableBot ? 'Ya, Aktifkan Chatbot' : 'Ya, Nonaktifkan AI',
      danger: !enableBot,
    });
    if (!isConfirm) return;

    setTogglingBotCutoff(true);
    try {
      const res = await apiRequest('/api/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify({ globalBotActive: enableBot }),
      });
      if (res && res.success) {
        const newActive = Boolean((res as any)?.globalBotActive ?? (res as any)?.data?.globalBotActive ?? enableBot);
        setChatBotActive(newActive);
        try { localStorage.setItem('wa_chatbot_active_state', String(newActive)); } catch {}
        toast(
          newActive
            ? 'Chatbot AI DIAKTIFKAN — AI kembali membalas otomatis.'
            : 'Chatbot AI DINONAKTIFKAN — AI diam, dialihkan ke CS manual.',
          newActive ? 'success' : 'info'
        );
      }
    } catch (err: any) {
      toast(`Gagal mengubah status Chatbot: ${err?.message || err}`, 'error');
    } finally {
      setTogglingBotCutoff(false);
    }
  };

  const [gatewayCapability, setGatewayCapability] = useState<{ provider: string; supportsRevoke: boolean; supportsEdit?: boolean } | null>(null);
  const [allLabels, setAllLabels] = useState<CustomerLabelData[]>([]);
  const [labelPopoverOpen, setLabelPopoverOpen] = useState(false);
  const [togglingLabelId, setTogglingLabelId] = useState<string | null>(null);
  const labelPopoverRef = useRef<HTMLDivElement>(null);

  // Close label popover on outside click
  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent) => {
      if (labelPopoverRef.current && !labelPopoverRef.current.contains(e.target as Node)) {
        setLabelPopoverOpen(false);
      }
    };
    document.addEventListener('mousedown', handleDocumentClick);
    return () => {
      document.removeEventListener('mousedown', handleDocumentClick);
    };
  }, []);

  // Load gateway capability & available customer labels on mount
  useEffect(() => {
    emitBootPhase('done');
    apiRequest('/api/admin/gateway-capability')
      .then((res) => {
        if (res?.success && res.data) setGatewayCapability(res.data);
      })
      .catch(() => {});

    apiRequest('/api/admin/labels')
      .then((res) => {
        if (res?.success && Array.isArray(res.data)) {
          setAllLabels(res.data);
        } else if (Array.isArray(res)) {
          setAllLabels(res);
        }
      })
      .catch(() => {});
  }, []);

  const handleToggleLabel = async (customerId: string, label: CustomerLabelData) => {
    if (togglingLabelId) return;
    setTogglingLabelId(label.id);
    try {
      const targetChat = chatsRef.current.find((c) => c.customerId === customerId);
      const currentLabels = targetChat?.customerLabels || [];
      const isAssigned = currentLabels.some((l) => l.id === label.id);
      const action = isAssigned ? 'unassign' : 'assign';

      // Optimistic update for chats list
      const nextLabels = isAssigned
        ? currentLabels.filter((l) => l.id !== label.id)
        : [...currentLabels, label];

      setChats((prev) => {
        const updated = prev.map((c) =>
          c.customerId === customerId ? { ...c, customerLabels: nextLabels } : c
        );
        chatsRef.current = updated;
        return updated;
      });

      // Optimistic update for contextMenu if open
      setContextMenu((prev) => {
        if (!prev || prev.chat.customerId !== customerId) return prev;
        return {
          ...prev,
          chat: {
            ...prev.chat,
            customerLabels: nextLabels,
          },
        };
      });

      // Optimistic update for customer detail modal if open
      setCustomerDetailData((prev: any) => {
        if (!prev) return prev;
        if (prev.id !== customerId && prev.phone !== targetChat?.customerPhone) return prev;
        return {
          ...prev,
          labels: nextLabels.map((l) => ({ label: l })),
        };
      });

      await apiRequest(`/api/admin/customers/${customerId}/labels`, {
        method: 'POST',
        body: JSON.stringify({ labelId: label.id, action }),
      });
    } catch (err: any) {
      toast(err.message || 'Gagal memperbarui label customer.', 'error');
      loadChats(true);
    } finally {
      setTogglingLabelId(null);
    }
  };

  return {
    chatBotActive,
    setChatBotActive,
    togglingBotCutoff,
    clinicBrandName,
    setClinicBrandName,
    handleToggleGlobalBot,
    gatewayCapability,
    allLabels,
    setAllLabels,
    labelPopoverOpen,
    setLabelPopoverOpen,
    togglingLabelId,
    labelPopoverRef,
    handleToggleLabel,
  };
}
