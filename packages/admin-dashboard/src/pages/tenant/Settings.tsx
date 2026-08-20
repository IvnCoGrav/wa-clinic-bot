import React, { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../../components/common/UiFeedback';
import { BRAND } from '../../config/brand';
import { WhatsAppProviderPanel } from '../../components/settings/WhatsAppProviderPanel';
import { AiRouterPanel } from '../../components/settings/AiRouterPanel';
import { MetaCapiPanel } from '../../components/settings/MetaCapiPanel';
import { MqlSettingsPanel } from '../../components/settings/MqlSettingsPanel';
import { InstallAppPanel } from '../../components/settings/InstallAppPanel';
import { DailyReportPanel } from '../../components/settings/DailyReportPanel';

// Mask penanda token CAPI sudah ter-input (token asli tidak pernah disimpan di UI/state)
const CAPI_TOKEN_MASK = '••••••••••••••••••••••••••••••••';

import { 
  Settings as SettingsIcon, 
  MapPin, 
  Truck, 
  Clock, 
  Volume2, 
  ShieldCheck, 
  Check, 
  AlertTriangle,
  Map,
  Plus,
  Trash,
  MessageCircle,
  RefreshCw,
  KeyRound,
  FileCheck,
  FileX,
  Save,
  BarChart3,
  QrCode,
  Play,
  Power,
  Image as ImageIcon
} from 'lucide-react';

export const Settings: React.FC = () => {
  const { toast, confirm } = useUiFeedback();
  const [globalBotActive, setGlobalBotActive] = useState(true);
  const [loading, setLoading] = useState(true);
  
  // Coordinates & branch picker (persisted locally)
  const [lat, setLat] = useState(-7.2758);
  const [lng, setLng] = useState(112.7913);
  const [branchName, setBranchName] = useState(`${BRAND.businessName} — Mulyosari`);

  // Tiering Ongkir (persisted locally)
  const [ongkirTiers, setOngkirTiers] = useState<Array<{ id: number; maxDist: number; fee: number; promoDiscount: number }>>([
    { id: 1, maxDist: 3, fee: 10000, promoDiscount: 0 },
    { id: 2, maxDist: 7, fee: 20000, promoDiscount: 0 },
    { id: 3, maxDist: 15, fee: 35000, promoDiscount: 0 },
  ]);

  // Broadcast campaign input
  const [broadcastText, setBroadcastText] = useState('');
  const [randomDelay, setRandomDelay] = useState(15); // in seconds
  const [quietHoursStart, setQuietHoursStart] = useState('21:00');
  const [quietHoursEnd, setQuietHoursEnd] = useState('08:00');

  // WhatsApp Provider (Fase 5)
  const [provider, setProvider] = useState<'WAHA' | 'WABA'>('WAHA');
  const [wahaStatus, setWahaStatus] = useState('UNKNOWN');
  const [wahaSessionId, setWahaSessionId] = useState('default');
  const [wabaConfigured, setWabaConfigured] = useState(false);
  const [wabaPhoneNumberId, setWabaPhoneNumberId] = useState('');
  const [wabaBusinessAccountId, setWabaBusinessAccountId] = useState('');
  const [wabaAccessToken, setWabaAccessToken] = useState('');
  const [wabaWebhookVerifyToken, setWabaWebhookVerifyToken] = useState('');
  const [wabaTemplates, setWabaTemplates] = useState<Array<{
    type: string; variant: number; templateName: string; category: string; status: string; isActive: boolean; isDefault: boolean;
  }>>([]);
  const [savingProvider, setSavingProvider] = useState(false);
  const [providerTab, setProviderTab] = useState<'WAHA' | 'WABA'>('WAHA');

  // Fitur 1: Konek WhatsApp via QR (Admin UI)
  const [qrData, setQrData] = useState<{ mimetype: string; data: string } | null>(null);
  const [qrStatus, setQrStatus] = useState('UNKNOWN');
  const [qrMessage, setQrMessage] = useState('');
  const [loadingQr, setLoadingQr] = useState(false);
  const [startingSession, setStartingSession] = useState(false);
  const [resettingSession, setResettingSession] = useState(false);
  const qrStatusRef = useRef('UNKNOWN');

  // AI Router Engine (default ON + shadow ON)
  const [aiRouterEnabled, setAiRouterEnabled] = useState(true);
  const [aiRouterShadowMode, setAiRouterShadowMode] = useState(true);

  // AI Rollout Scope (AI hanya untuk customer baru)
  const [aiScope, setAiScope] = useState<'NEW_ONLY' | 'ALL'>('NEW_ONLY');
  const [aiScopeCutoffAt, setAiScopeCutoffAt] = useState('');
  const [aiScopeSummary, setAiScopeSummary] = useState<{
    totalCustomers: number;
    newCustomers: number;
    legacyCustomers: number;
    silencedByScope: number;
  }>({ totalCustomers: 0, newCustomers: 0, legacyCustomers: 0, silencedByScope: 0 });
  const [savingAiScope, setSavingAiScope] = useState(false);
  const [savingAiRouter, setSavingAiRouter] = useState(false);

  // Meta Pixel & CAPI (konversi iklan — berlaku semua provider WAHA/WABA)
  const [metaPixelId, setMetaPixelId] = useState('');
  const [capiAccessToken, setCapiAccessToken] = useState('');
  const [capiConfigured, setCapiConfigured] = useState(false);
  const [capiSource, setCapiSource] = useState('none');
  const [savingCapi, setSavingCapi] = useState(false);

  // MQL Automation Settings
  const [mqlThresholdBubbles, setMqlThresholdBubbles] = useState<number>(5);
  const [mqlAutoLeadEnabled, setMqlAutoLeadEnabled] = useState<boolean>(true);
  const [savingMql, setSavingMql] = useState(false);

  // Moderasi Event Purchase Meta CAPI (Outlier Filter Queue)
  const [autoSendPurchaseCapi, setAutoSendPurchaseCapi] = useState<boolean>(false);
  const [savingPurchaseModeration, setSavingPurchaseModeration] = useState(false);

  // Live Chat Media retention (per-tenant, hari)
  const [mediaRetentionDays, setMediaRetentionDays] = useState<string>('30');
  const [mediaEnvFallbackDays, setMediaEnvFallbackDays] = useState<number>(30);
  const [savingMediaRetention, setSavingMediaRetention] = useState(false);

  // Gambar Pricelist (per-tenant)
  const [pricelistImageUrl, setPricelistImageUrl] = useState<string>('');

  const loadMediaRetention = async () => {
    try {
      const res = await apiRequest('/api/admin/settings/media');
      const d = res?.data;
      if (d) {
        if (d.tenantMediaRetentionDays != null) {
          setMediaRetentionDays(String(d.tenantMediaRetentionDays));
        }
        if (d.envFallbackRetentionDays != null) setMediaEnvFallbackDays(d.envFallbackRetentionDays);
      }
    } catch (e) {
      console.warn('Failed to load media retention settings:', e);
    }
  };

  const handleSaveMediaRetention = async () => {
    setSavingMediaRetention(true);
    try {
      const val = parseInt(mediaRetentionDays, 10);
      if (!Number.isFinite(val) || val < 1 || val > 3650) {
        toast('Retensi media harus angka 1-3650 (hari).', 'error');
        return;
      }
      const res = await apiRequest('/api/admin/settings/media', {
        method: 'PUT',
        body: JSON.stringify({ mediaRetentionDays: val }),
      });
      if (res && res.success) {
        toast(res.message || 'Retensi media Live Chat tersimpan.', 'success');
        await loadMediaRetention();
      }
    } catch (err: any) {
      toast(`Gagal menyimpan retensi media: ${err.message}`, 'error');
    } finally {
      setSavingMediaRetention(false);
    }
  };


  const loadPricelistImage = async () => {
    try {
      const res = await apiRequest('/api/admin/settings/pricelist-image');
      const d = res?.data;
      if (d && d.pricelistImageUrl) {
        setPricelistImageUrl(d.pricelistImageUrl);
      }
    } catch (e) {
      console.warn('Failed to load pricelist image settings:', e);
    }
  };


  const loadMqlSettings = async () => {
    try {
      const res = await apiRequest('/api/admin/settings/mql');
      if (res && res.data) {
        setMqlThresholdBubbles(res.data.mqlThresholdBubbles ?? 5);
        setMqlAutoLeadEnabled(res.data.mqlAutoLeadEnabled ?? true);
      }
    } catch (e) {
      console.warn('Failed to load MQL settings:', e);
    }
  };

  const handleSaveMqlSettings = async () => {
    setSavingMql(true);
    try {
      const res = await apiRequest('/api/admin/settings/mql', {
        method: 'PUT',
        body: JSON.stringify({
          mqlThresholdBubbles: Number(mqlThresholdBubbles),
          mqlAutoLeadEnabled,
        }),
      });
      if (res && res.success) {
        toast('Pengaturan MQL & Trigger Event Lead berhasil disimpan.', 'success');
      }
    } catch (err: any) {
      toast(`Gagal menyimpan MQL settings: ${err.message}`, 'error');
    } finally {
      setSavingMql(false);
    }
  };

  const loadPurchaseModeration = async () => {
    try {
      const res = await apiRequest('/api/admin/purchase-moderation');
      if (res && res.data && typeof res.data.autoSendPurchaseCapi === 'boolean') {
        setAutoSendPurchaseCapi(res.data.autoSendPurchaseCapi);
      }
    } catch (e) {
      console.warn('Failed to load purchase moderation settings:', e);
    }
  };

  const handleSavePurchaseModeration = async (val: boolean) => {
    setSavingPurchaseModeration(true);
    try {
      const res = await apiRequest('/api/admin/purchase-moderation', {
        method: 'PATCH',
        body: JSON.stringify({ autoSendPurchaseCapi: val }),
      });
      if (res && res.success) {
        setAutoSendPurchaseCapi(val);
        toast(
          val
            ? 'Auto-send Purchase CAPI aktif. Semua event pembayaran dikirim langsung ke Meta.'
            : 'Moderasi manual aktif. Event pembayaran ditahan di Meta CAPI Queue untuk review admin.',
          'success'
        );
      }
    } catch (err: any) {
      toast(`Gagal menyimpan pengaturan moderasi: ${err.message}`, 'error');
    } finally {
      setSavingPurchaseModeration(false);
    }
  };

  useEffect(() => {
    async function loadSettings() {
      try {
        const [
          data,
          tiersRes,
          , // provider
          , // qr
          , // aiRouter
          , // aiScope
          , // capi
          , // mql
          , // media
          , // purchaseModeration
        ] = await Promise.all([
          apiRequest('/api/admin/settings'),
          apiRequest('/api/admin/delivery-tiers'),
          loadWhatsAppProvider(),
          loadQr(),
          loadAiRouterConfig(),
          loadAiScopeConfig(),
          loadCapiConfig(),
          loadMqlSettings(),
          loadMediaRetention(),
          loadPricelistImage(),
          loadPurchaseModeration(),
        ]);

        if (data) {
          setGlobalBotActive(data.globalBotActive);
        }

        // Load branch from localStorage if available
        const localBranch = localStorage.getItem('kala_branch_settings');
        if (localBranch) {
          const parsed = JSON.parse(localBranch);
          setLat(parsed.lat);
          setLng(parsed.lng);
          setBranchName(parsed.name);
        }

        const list = Array.isArray(tiersRes) ? tiersRes : (tiersRes?.data || []);
        if (list.length > 0) {
          setOngkirTiers(list);
        }
      } catch (err) {
        console.warn('Failed to load global chatbot settings:', err);
      } finally {
        setLoading(false);
      }
    }
    loadSettings();
  }, []);

  const loadAiRouterConfig = async () => {
    try {
      const res = await apiRequest('/api/admin/ai-router');
      const d = res?.data;
      if (d) {
        setAiRouterEnabled(d.enabled ?? true);
        setAiRouterShadowMode(d.shadowMode ?? true);
      }
    } catch (err) {
      console.warn('Failed to load AI Router config:', err);
    }
  };

  const loadAiScopeConfig = async () => {
    try {
      const res = await apiRequest('/api/admin/ai-rollout-scope');
      const d = res?.data;
      if (d) {
        setAiScope(d.ai_customer_scope === 'ALL' ? 'ALL' : 'NEW_ONLY');
        if (d.ai_scope_cutoff_at) {
          const dt = new Date(d.ai_scope_cutoff_at);
          const y = dt.getFullYear();
          const m = String(dt.getMonth() + 1).padStart(2, '0');
          const day = String(dt.getDate()).padStart(2, '0');
          setAiScopeCutoffAt(`${y}-${m}-${day}`);
        }
      }
      if (res?.summary) setAiScopeSummary(res.summary);
    } catch (err) {
      console.warn('Failed to load AI Rollout Scope config:', err);
    }
  };

  const handleUpdateAiScope = async (newScope?: 'NEW_ONLY' | 'ALL', newCutoffDate?: string) => {
    const targetScope = newScope !== undefined ? newScope : aiScope;
    const targetCutoff = newCutoffDate !== undefined ? newCutoffDate : aiScopeCutoffAt;

    if (newScope !== undefined) setAiScope(newScope);
    if (newCutoffDate !== undefined) setAiScopeCutoffAt(newCutoffDate);

    setSavingAiScope(true);
    try {
      const body: any = { aiCustomerScope: targetScope };
      if (targetCutoff) {
        const dt = new Date(`${targetCutoff}T00:00:00`);
        if (!isNaN(dt.getTime())) {
          body.aiScopeCutoffAt = dt.toISOString();
        }
      }
      const res = await apiRequest('/api/admin/ai-rollout-scope', { method: 'PATCH', body });
      const d = res?.data;
      if (d?.ai_scope_cutoff_at) {
        const dt = new Date(d.ai_scope_cutoff_at);
        const y = dt.getFullYear();
        const m = String(dt.getMonth() + 1).padStart(2, '0');
        const day = String(dt.getDate()).padStart(2, '0');
        setAiScopeCutoffAt(`${y}-${m}-${day}`);
      }
      if (res?.summary) setAiScopeSummary(res.summary);
      toast(res?.message || 'AI Rollout Scope tersimpan.', 'success');
      if (targetScope === 'ALL') {
        toast('Semua customer kini eligible AI. Conversation legacy yang tersenyap tetap di HUMAN_HANDLING — release manual via panel per-customer.', 'info');
      }
    } catch (err: any) {
      toast(`Gagal menyimpan AI Rollout Scope: ${err.message}`, 'error');
    } finally {
      setSavingAiScope(false);
    }
  };

  const loadCapiConfig = async () => {
    try {
      const res = await apiRequest('/api/admin/capi-config');
      const d = res?.data;
      if (d) {
        setMetaPixelId(d.metaPixelId || '');
        setCapiConfigured(!!d.hasCapiAccessToken);
        setCapiSource(d.capiTokenSource || 'none');
        setCapiAccessToken(d.hasCapiAccessToken ? CAPI_TOKEN_MASK : '');
      }
    } catch (err) {
      console.warn('Failed to load Meta Pixel & CAPI config:', err);
    }
  };

  const handleSaveCapiConfig = async () => {
    setSavingCapi(true);
    try {
      const body: any = {};
      if (metaPixelId !== '') body.metaPixelId = metaPixelId;
      if (capiAccessToken !== '' && capiAccessToken !== CAPI_TOKEN_MASK) body.capiAccessToken = capiAccessToken;
      const res = await apiRequest('/api/admin/capi-config', { method: 'PATCH', body: JSON.stringify(body) });
      setCapiConfigured(!!res?.data?.hasCapiAccessToken);
      setMetaPixelId(res?.data?.metaPixelId || metaPixelId);
      setCapiAccessToken(CAPI_TOKEN_MASK);
      setCapiSource('db');
      toast(res?.message || 'Konfigurasi Meta Pixel & CAPI tersimpan.', 'success');
    } catch (err: any) {
      toast(`Gagal menyimpan config Meta Pixel & CAPI: ${err.message}`, 'error');
    } finally {
      setSavingCapi(false);
    }
  };

  const loadWhatsAppProvider = async () => {
    try {
      const res = await apiRequest('/api/admin/whatsapp-provider');
      const d = res?.data;
      if (d) {
        setProvider(d.provider || 'WAHA');
        setWahaStatus(d.wahaStatus || 'UNKNOWN');
        setWahaSessionId(d.wahaSessionId || 'default');
        setWabaConfigured(!!d.waba?.configured);
        setWabaPhoneNumberId(d.waba?.phoneNumberId || '');
        setWabaBusinessAccountId(d.waba?.businessAccountId || '');
        setWabaWebhookVerifyToken(d.waba?.hasWebhookVerifyToken ? d.waba.webhookVerifyToken : '');
        if (Array.isArray(d.templates)) setWabaTemplates(d.templates);
      }
    } catch (err) {
      console.warn('Failed to load WhatsApp provider config:', err);
    }
  };

  // Fitur 1: muat QR + status session WAHA per-tenant dari GET /api/admin/whatsapp-provider/qr
  const loadQr = async () => {
    setLoadingQr(true);
    try {
      const res = await apiRequest('/api/admin/whatsapp-provider/qr');
      const d = res?.data;
      if (d) {
        setQrStatus(d.status || 'UNKNOWN');
        setQrMessage(d.message || '');
        setQrData(d.qr || null);
        if (d.sessionId) setWahaSessionId(d.sessionId);
        if (d.status) setWahaStatus(d.status);
      } else {
        setQrData(null);
        setQrStatus('UNKNOWN');
      }
    } catch (err: any) {
      setQrData(null);
      setQrStatus('UNKNOWN');
      setQrMessage(`Gagal mengambil QR: ${err.message}`);
    } finally {
      setLoadingQr(false);
    }
  };

  // Fitur 1: tombol "Mulai Session" saat status STOPPED/STOPPING/FAILED (POST .../session/start)
  const handleStartSession = async () => {
    setStartingSession(true);
    try {
      const res = await apiRequest('/api/admin/whatsapp-provider/session/start', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const d = res?.data;
      if (d) {
        setQrStatus(d.status || 'UNKNOWN');
        setQrMessage(d.message || '');
        setQrData(d.qr || null);
        if (d.sessionId) setWahaSessionId(d.sessionId);
        if (d.status) setWahaStatus(d.status);
      }
      toast(d?.message || 'Session WAHA dimulai.', 'success');
    } catch (err: any) {
      toast(`Gagal memulai session WAHA: ${err.message}`, 'error');
    } finally {
      setStartingSession(false);
    }
  };

  // Tombol start berguna saat session mati/terputus; WORKING/SCAN_QR_CODE tidak perlu.
  const canStartSession = ['STOPPED', 'STOPPING', 'FAILED', 'DISCONNECTED', 'UNKNOWN'].includes(qrStatus);
  // Session FAILED yang sudah-paired tidak bisa di-recover hanya dengan start
  // (Noise Handshake failure baileys) — butuh reset penuh (delete → create → start).
  const canResetSession = qrStatus === 'FAILED';

  // Fitur 1: tombol "Reset Session" saat status FAILED — delete → create ulang (webhook dipertahankan) → start → QR baru.
  const handleResetSession = async () => {
    const ok = await confirm({
      title: 'Reset Session WhatsApp?',
      message:
        'Session FAILED akan dihapus dan dibuat ulang, lalu muncul QR baru untuk dipindai ulang. ' +
        'Perangkat WhatsApp lama akan terlepas dari session ini. Lanjutkan?',
      confirmText: 'Reset & Scan Ulang',
      cancelText: 'Batal',
      danger: true,
    });
    if (!ok) return;

    setResettingSession(true);
    try {
      const res = await apiRequest('/api/admin/whatsapp-provider/session/reset', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const d = res?.data;
      if (d) {
        setQrStatus(d.status || 'UNKNOWN');
        setQrMessage(d.message || '');
        setQrData(d.qr || null);
        if (d.sessionId) setWahaSessionId(d.sessionId);
        if (d.status) setWahaStatus(d.status);
      }
      toast(d?.message || 'Session WAHA berhasil di-reset. Pindai QR baru untuk menghubungkan ulang.', 'success');
    } catch (err: any) {
      toast(`Gagal mereset session WAHA: ${err.message}`, 'error');
    } finally {
      setResettingSession(false);
    }
  };

  const [disconnectingSession, setDisconnectingSession] = useState(false);

  const handleDisconnectSession = async () => {
    const ok = await confirm({
      title: 'Putuskan Koneksi WAHA?',
      message:
        'Koneksi WhatsApp WAHA akan terputus (logout/stop session). ' +
        'Bot tidak akan bisa menerima/mengirim pesan WAHA sampai session dihubungkan kembali via Scan QR.',
      confirmText: 'Putuskan Koneksi',
      cancelText: 'Batal',
      danger: true,
    });
    if (!ok) return;

    setDisconnectingSession(true);
    try {
      const res = await apiRequest('/api/admin/whatsapp-provider/session/disconnect', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const d = res?.data;
      if (d) {
        setQrStatus(d.status || 'STOPPED');
        setQrMessage(d.message || 'Session terputus.');
        setQrData(null);
        if (d.status) setWahaStatus(d.status);
      }
      toast('Koneksi WAHA berhasil diputuskan (Disconnected).', 'success');
      await loadQr();
    } catch (err: any) {
      toast(`Gagal memutuskan koneksi WAHA: ${err.message}`, 'error');
    } finally {
      setDisconnectingSession(false);
    }
  };

  // Auto-refresh QR hanya saat tab WAHA aktif dan status masih SCAN_QR_CODE
  // (QR ~20 detik kedaluwarsa — polling jangan membebani saat session WORKING).
  useEffect(() => {
    qrStatusRef.current = qrStatus;
  }, [qrStatus]);

  useEffect(() => {
    if (providerTab !== 'WAHA') return;
    const interval = setInterval(() => {
      if (qrStatusRef.current === 'SCAN_QR_CODE') loadQr();
    }, 15000);
    return () => clearInterval(interval);
  }, [providerTab]);

  const handleToggleProvider = async (val: 'WAHA' | 'WABA') => {
    setSavingProvider(true);
    try {
      const body: any = { provider: val };
      if (val === 'WABA' && wabaPhoneNumberId) body.waba_phone_number_id = wabaPhoneNumberId;
      if (val === 'WABA' && wabaBusinessAccountId) body.waba_business_account_id = wabaBusinessAccountId;
      if (val === 'WABA' && wabaAccessToken) body.waba_access_token = wabaAccessToken;
      if (val === 'WABA' && wabaWebhookVerifyToken) body.waba_webhook_verify_token = wabaWebhookVerifyToken;

      await apiRequest('/api/admin/whatsapp-provider', {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setProvider(val);
      toast(`WhatsApp provider switched to ${val}`, 'success');
      await loadWhatsAppProvider();
    } catch (err: any) {
      toast(`Failed to switch provider: ${err.message}`, 'error');
    } finally {
      setSavingProvider(false);
    }
  };

  const handleToggleAiRouter = async (val: 'enabled' | 'shadowMode', next: boolean) => {
    setSavingAiRouter(true);
    try {
      await apiRequest('/api/admin/ai-router', {
        method: 'PATCH',
        body: JSON.stringify(val === 'enabled' ? { enabled: next } : { shadowMode: next }),
      });
      if (val === 'enabled') {
        setAiRouterEnabled(next);
        toast(`AI Router Engine ${next ? 'diaktifkan' : 'dinonaktifkan'}`, 'success');
      } else {
        setAiRouterShadowMode(next);
        toast(`AI Router Shadow Mode ${next ? 'diaktifkan' : 'dinonaktifkan (full mode)'}`, 'success');
      }
    } catch (err: any) {
      toast(`Failed to update AI Router config: ${err.message}`, 'error');
    } finally {
      setSavingAiRouter(false);
    }
  };

  const handleSaveWabaConfig = async () => {
    setSavingProvider(true);
    try {
      const body: any = {
        waba_phone_number_id: wabaPhoneNumberId,
        waba_business_account_id: wabaBusinessAccountId,
        waba_webhook_verify_token: wabaWebhookVerifyToken,
      };
      if (wabaAccessToken) body.waba_access_token = wabaAccessToken;

      await apiRequest('/api/admin/whatsapp-provider', {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setWabaAccessToken('');
      toast('WABA credentials saved securely (AES-256 encrypted)', 'success');
      await loadWhatsAppProvider();
    } catch (err: any) {
      toast(`Failed to save WABA config: ${err.message}`, 'error');
    } finally {
      setSavingProvider(false);
    }
  };

  const handleSaveWabaTemplate = async (type: string, variant: number, templateName: string) => {
    try {
      await apiRequest('/api/admin/waba-templates', {
        method: 'POST',
        body: JSON.stringify({ type, variant, templateName }),
      });
      toast(`WABA template mapping ${type} saved`, 'success');
      await loadWhatsAppProvider();
    } catch (err: any) {
      toast(`Failed to save template mapping: ${err.message}`, 'error');
    }
  };

  const handleSaveGlobalToggle = async (val: boolean) => {
    try {
      await apiRequest('/api/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify({ globalBotActive: val })
      });
      setGlobalBotActive(val);
      toast(`Chatbot status changed to: ${val ? 'ACTIVE (ON)' : 'DISABLED (OFF)'}`, 'success');
    } catch (err: any) {
      toast(`Failed to change bot status: ${err.message}`, 'error');
    }
  };

  const handleSaveBranch = () => {
    localStorage.setItem('kala_branch_settings', JSON.stringify({
      lat,
      lng,
      name: branchName
    }));
    toast('Branch coordinates updated successfully!', 'success');
  };

  const handleSaveOngkirTiers = async () => {
    try {
      await apiRequest('/api/admin/delivery-tiers', {
        method: 'POST',
        body: JSON.stringify({ tiers: ongkirTiers })
      });
      toast('Delivery fee tierings updated successfully on server!', 'success');
    } catch (err: any) {
      toast(`Failed to save delivery fee tierings: ${err.message}`, 'error');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-[#111b21] flex items-center space-x-2">
          <SettingsIcon className="text-[#008069]" size={22} />
          <span>Operational Settings</span>
        </h2>
        <p className="text-xs text-[#667781] mt-0.5">Konfigurasi WhatsApp provider, AI router, Meta Pixel/CAPI, dan operasional bot</p>
      </div>

      {/* WhatsApp Gateway — channel utama + sub-tab WAHA/WABA */}
      <WhatsAppProviderPanel
        provider={provider}
        providerTab={providerTab}
        setProviderTab={setProviderTab}
        savingProvider={savingProvider}
        handleToggleProvider={handleToggleProvider}
        loadWhatsAppProvider={loadWhatsAppProvider}
        wahaStatus={wahaStatus}
        wahaSessionId={wahaSessionId}
        qrData={qrData}
        qrStatus={qrStatus}
        qrMessage={qrMessage}
        loadingQr={loadingQr}
        startingSession={startingSession}
        resettingSession={resettingSession}
        disconnectingSession={disconnectingSession}
        canStartSession={canStartSession}
        canResetSession={canResetSession}
        loadQr={loadQr}
        handleDisconnectSession={handleDisconnectSession}
        handleStartSession={handleStartSession}
        handleResetSession={handleResetSession}
        wabaConfigured={wabaConfigured}
        wabaPhoneNumberId={wabaPhoneNumberId}
        setWabaPhoneNumberId={setWabaPhoneNumberId}
        wabaBusinessAccountId={wabaBusinessAccountId}
        setWabaBusinessAccountId={setWabaBusinessAccountId}
        wabaAccessToken={wabaAccessToken}
        setWabaAccessToken={setWabaAccessToken}
        wabaWebhookVerifyToken={wabaWebhookVerifyToken}
        setWabaWebhookVerifyToken={setWabaWebhookVerifyToken}
        handleSaveWabaConfig={handleSaveWabaConfig}
        wabaTemplates={wabaTemplates}
        handleSaveWabaTemplate={handleSaveWabaTemplate}
      />

      {/* AI Router Engine & AI Rollout Scope */}
      <AiRouterPanel
        aiRouterEnabled={aiRouterEnabled}
        aiRouterShadowMode={aiRouterShadowMode}
        savingAiRouter={savingAiRouter}
        handleToggleAiRouter={handleToggleAiRouter}
        aiScope={aiScope}
        aiScopeCutoffAt={aiScopeCutoffAt}
        aiScopeSummary={aiScopeSummary}
        savingAiScope={savingAiScope}
        handleUpdateAiScope={handleUpdateAiScope}
      />

      {/* Meta Pixel & CAPI Settings */}
      <MetaCapiPanel
        metaPixelId={metaPixelId}
        setMetaPixelId={setMetaPixelId}
        capiAccessToken={capiAccessToken}
        setCapiAccessToken={setCapiAccessToken}
        capiConfigured={capiConfigured}
        capiSource={capiSource}
        savingCapi={savingCapi}
        handleSaveCapi={handleSaveCapiConfig}
        autoSendPurchaseCapi={autoSendPurchaseCapi}
        savingPurchaseModeration={savingPurchaseModeration}
        handleTogglePurchaseModeration={handleSavePurchaseModeration}
      />

      {/* Pricelist, MQL Automation & Media Retention Settings */}
      <MqlSettingsPanel
        initialPricelistUrl={pricelistImageUrl}
        onPricelistSaved={loadPricelistImage}
        mqlThresholdBubbles={mqlThresholdBubbles}
        setMqlThresholdBubbles={setMqlThresholdBubbles}
        mqlAutoLeadEnabled={mqlAutoLeadEnabled}
        setMqlAutoLeadEnabled={setMqlAutoLeadEnabled}
        savingMql={savingMql}
        handleSaveMql={handleSaveMqlSettings}
        mediaRetentionDays={mediaRetentionDays}
        setMediaRetentionDays={setMediaRetentionDays}
        mediaEnvFallbackDays={mediaEnvFallbackDays}
        savingMediaRetention={savingMediaRetention}
        handleSaveMediaRetention={handleSaveMediaRetention}
      />

      {/* Daily Ops Report Settings Panel */}
      <DailyReportPanel />

      {/* Remaining panels: Global Toggle + Branch Picker + Delivery Tiers + Broadcast */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Left column: Install App + Global Bot Toggle + Branch picker */}
        <div className="space-y-6">

          {/* Install App (PWA) — setengah lebar, di atas Global Chatbot Toggle */}
          <InstallAppPanel />

          {/* Bot ON/OFF Toggle */}
          <div className="bg-white border border-[#e9edef] rounded-2xl p-5 space-y-3 shadow-xs">
            <h3 className="text-sm font-bold text-[#111b21] flex items-center space-x-2">
              <ShieldCheck className="text-[#008069]" size={16} />
              <span>Global Chatbot Toggle</span>
            </h3>
            <p className="text-xs text-[#667781] leading-relaxed">
              Aktifkan atau nonaktifkan bot AI secara global. Saat dinonaktifkan, semua pesan WhatsApp masuk akan otomatis dialihkan ke antrian manusia (Staff / Bidan).
            </p>
            <div className="flex items-center justify-between p-3.5 rounded-xl bg-[#f8fafc] border border-[#e9edef] mt-2">
              <span className="text-xs font-semibold text-[#111b21]">AI Auto-Responder Bot</span>
              <button
                onClick={() => handleSaveGlobalToggle(!globalBotActive)}
                className={`w-12 h-6 rounded-full transition-all relative ${globalBotActive ? 'bg-[#008069]' : 'bg-[#d1d7db]'}`}
              >
                <div className={`absolute top-0.5 left-0.5 bg-white h-5 w-5 rounded-full transition-all ${globalBotActive ? 'translate-x-6' : ''}`}></div>
              </button>
            </div>
          </div>

          {/* Coordinate picker & Branch Map */}
          <div className="bg-white border border-[#e9edef] rounded-2xl p-5 space-y-3 shadow-xs">
            <h3 className="text-sm font-bold text-[#111b21] flex items-center space-x-2">
              <MapPin className="text-[#008069]" size={16} />
              <span>Branch Coordinate Picker (Map)</span>
            </h3>

            {/* Out of scope Alert banner */}
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 flex items-start space-x-2 text-xs">
              <AlertTriangle className="flex-shrink-0 mt-0.5 text-amber-600" size={14} />
              <div>
                <p className="font-bold">UI Demo Only (Belum Tersambung Backend Tier 2.4)</p>
                <p className="mt-0.5 text-[11px] text-amber-700">
                  Data koordinat cabang yang diinput di sini hanya tersimpan lokal di browser.
                </p>
              </div>
            </div>

            <p className="text-xs text-[#667781]">
              Atur titik lokasi GPS cabang klinik untuk perhitungan estimasi jarak ongkir homecare.
            </p>

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-[#111b21]">Nama Cabang</label>
                <input
                  type="text"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  className="w-full p-2.5 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-[#111b21]">Latitude</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={lat}
                    onChange={(e) => setLat(parseFloat(e.target.value))}
                    className="w-full p-2.5 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-[#111b21]">Longitude</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={lng}
                    onChange={(e) => setLng(parseFloat(e.target.value))}
                    className="w-full p-2.5 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
                  />
                </div>
              </div>

              {/* Simulated Map */}
              <div className="h-36 rounded-xl bg-[#f8fafc] border border-[#e9edef] relative overflow-hidden flex items-center justify-center">
                <Map className="absolute text-[#d1d7db] w-full h-full opacity-30" />
                <div className="relative text-center space-y-0.5">
                  <MapPin className="mx-auto text-[#008069] animate-bounce" size={22} />
                  <p className="text-xs text-[#111b21] font-semibold">{branchName}</p>
                  <p className="text-[10px] text-[#8696a0]">[{lat}, {lng}]</p>
                </div>
              </div>

              <button
                onClick={handleSaveBranch}
                className="px-3.5 py-2 bg-[#008069] hover:bg-[#00a884] text-white rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 shadow-xs"
              >
                <Check size={13} />
                <span>Simpan Koordinat Lokasi</span>
              </button>
            </div>
          </div>

        </div>

        {/* Right column: Tiering Ongkir & Broadcast Engine */}
        <div className="space-y-6">

          {/* Delivery fee tiering */}
          <div className="bg-white border border-[#e9edef] rounded-2xl p-5 space-y-3 shadow-xs">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold text-[#111b21] flex items-center space-x-2">
                <Truck className="text-[#008069]" size={16} />
                <span>Delivery Fee Tiering (Homecare)</span>
              </h3>
              <span className="px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-[10px] font-bold">
                Haversine Active
              </span>
            </div>

            <p className="text-xs text-[#667781] leading-relaxed">
              Tentukan tarif biaya pengiriman (ongkir) normal dan potongan promo berdasarkan jarak haversine rute dari koordinat spa ke lokasi customer. Editor lengkap dengan simulasi ada di menu <span className="text-[#008069] font-bold">Delivery Fee</span>.
            </p>

            <div className="space-y-2.5">
              {ongkirTiers.map((tier, idx) => (
                <div key={tier.id} className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
                  <div className="space-y-1">
                    <label className="text-[10px] text-[#667781] block uppercase font-bold">Max Dist (km)</label>
                    <input
                      type="number"
                      value={tier.maxDist}
                      onChange={(e) => {
                        const newTiers = [...ongkirTiers];
                        newTiers[idx].maxDist = parseFloat(e.target.value);
                        setOngkirTiers(newTiers);
                      }}
                      className="w-full p-2 bg-white border border-[#d1d7db] rounded-lg text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-[#667781] block uppercase font-bold">Tarif (Rp)</label>
                    <input
                      type="number"
                      value={tier.fee}
                      onChange={(e) => {
                        const newTiers = [...ongkirTiers];
                        newTiers[idx].fee = parseInt(e.target.value);
                        setOngkirTiers(newTiers);
                      }}
                      className="w-full p-2 bg-white border border-[#d1d7db] rounded-lg text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-[#667781] block uppercase font-bold">Promo (Rp)</label>
                    <input
                      type="number"
                      value={tier.promoDiscount !== undefined ? tier.promoDiscount : 0}
                      onChange={(e) => {
                        const newTiers = [...ongkirTiers];
                        newTiers[idx].promoDiscount = parseInt(e.target.value) || 0;
                        setOngkirTiers(newTiers);
                      }}
                      className="w-full p-2 bg-white border border-[#d1d7db] rounded-lg text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-[#667781] block uppercase font-bold">Ongkir Jadi (Rp)</label>
                    <div
                      className={`w-full p-2 rounded-lg text-xs font-bold text-center shadow-xs ${
                        (tier.fee || 0) - (tier.promoDiscount || 0) <= 0
                          ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                          : 'bg-[#e8f5f2] border border-[#c2e7e0] text-[#008069]'
                      }`}
                    >
                      {Math.max(0, (tier.fee || 0) - (tier.promoDiscount || 0)) === 0
                        ? 'GRATIS'
                        : (tier.fee || 0) - (tier.promoDiscount || 0) >= 1000000
                        ? `Rp ${((tier.fee || 0) - (tier.promoDiscount || 0)) / 1000000}jt`
                        : `Rp ${Math.max(0, (tier.fee || 0) - (tier.promoDiscount || 0))}`}
                    </div>
                  </div>
                  <div className="flex space-x-2 items-end pb-1">
                    <button
                      onClick={() => { setOngkirTiers(ongkirTiers.filter(t => t.id !== tier.id)); }}
                      className="p-1.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-600 hover:bg-rose-100 transition flex justify-center items-center shadow-xs"
                      title="Hapus Tier"
                    >
                      <Trash size={12} />
                    </button>
                  </div>
                </div>
              ))}

              <div className="pt-2 flex justify-between">
                <button
                  onClick={() => { setOngkirTiers([...ongkirTiers, { id: Date.now(), maxDist: 20, fee: 30000, promoDiscount: 5000 }]); }}
                  className="px-3 py-1.5 bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] rounded-lg text-xs font-semibold text-[#111b21] flex items-center space-x-1 shadow-xs"
                >
                  <Plus size={11} />
                  <span>+ Tambah Tier</span>
                </button>

                <button
                  onClick={handleSaveOngkirTiers}
                  className="px-3.5 py-1.5 bg-[#008069] hover:bg-[#00a884] text-white rounded-lg text-xs font-semibold transition flex items-center space-x-1 shadow-xs"
                >
                  <Check size={12} />
                  <span>Simpan Tiers</span>
                </button>
              </div>
            </div>
          </div>

          {/* Broadcast & Quiet Hours with Alert Banner */}
          <div className="bg-white border border-[#e9edef] rounded-2xl p-5 space-y-4 shadow-xs">

            {/* Out of scope Alert banner */}
            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 flex items-start space-x-2 text-xs">
              <AlertTriangle className="flex-shrink-0 mt-0.5 text-amber-600" size={15} />
              <div>
                <p className="font-bold">Broadcast &amp; Quiet Hours Engine</p>
                <p className="mt-0.5 text-[11px] text-amber-700">
                  Fitur broadcast campaign terjadwal saat ini bersifat antrian manual.
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-bold text-[#111b21] flex items-center space-x-2">
                <Volume2 className="text-[#008069]" size={16} />
                <span>Broadcast Message Editor</span>
              </h3>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-[#111b21]">Broadcast Teks</label>
                <textarea
                  rows={3}
                  value={broadcastText}
                  onChange={(e) => setBroadcastText(e.target.value)}
                  placeholder="Kirim promo bulanan ke pelanggan loyal..."
                  className="w-full p-2.5 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] resize-none shadow-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-[#111b21]">Random Delay (detik)</label>
                  <input
                    type="number"
                    value={randomDelay}
                    onChange={(e) => setRandomDelay(parseInt(e.target.value))}
                    className="w-full p-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-[#111b21]">Quiet Hours (Mulai - Selesai)</label>
                  <div className="flex space-x-1.5 items-center">
                    <input
                      type="text"
                      value={quietHoursStart}
                      onChange={(e) => setQuietHoursStart(e.target.value)}
                      className="w-full p-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] text-center focus:outline-none focus:border-[#008069] shadow-xs"
                    />
                    <span className="text-[#8696a0]">-</span>
                    <input
                      type="text"
                      value={quietHoursEnd}
                      onChange={(e) => setQuietHoursEnd(e.target.value)}
                      className="w-full p-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] text-center focus:outline-none focus:border-[#008069] shadow-xs"
                    />
                  </div>
                </div>
              </div>

              <button
                disabled
                className="w-full py-2 bg-[#f0f2f5] border border-[#e9edef] text-[#8696a0] rounded-xl text-xs font-semibold cursor-not-allowed flex items-center justify-center space-x-1"
                title="Menunggu broadcast scheduler"
              >
                <span>Antrikan Broadcast Campaign</span>
              </button>
            </div>

          </div>

        </div>

      </div>
    </div>
  );
};
