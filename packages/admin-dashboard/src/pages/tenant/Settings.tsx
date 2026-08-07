import React, { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../../components/common/UiFeedback';
import { BRAND } from '../../config/brand';
import { WhatsAppProviderPanel } from '../../components/settings/WhatsAppProviderPanel';
import { AiRouterPanel } from '../../components/settings/AiRouterPanel';
import { MetaCapiPanel } from '../../components/settings/MetaCapiPanel';
import { MqlSettingsPanel } from '../../components/settings/MqlSettingsPanel';
import { InstallAppPanel } from '../../components/settings/InstallAppPanel';

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
  FileClock,
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

  // Live Chat Media retention (per-tenant, hari)
  const [mediaRetentionDays, setMediaRetentionDays] = useState<string>('30');
  const [mediaEnvFallbackDays, setMediaEnvFallbackDays] = useState<number>(30);
  const [savingMediaRetention, setSavingMediaRetention] = useState(false);

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
          setAiScopeCutoffAt(new Date(d.ai_scope_cutoff_at).toISOString().slice(0, 16));
        }
      }
      if (res?.summary) setAiScopeSummary(res.summary);
    } catch (err) {
      console.warn('Failed to load AI Rollout Scope config:', err);
    }
  };

  const handleSaveAiScope = async () => {
    setSavingAiScope(true);
    try {
      const body: any = { aiCustomerScope: aiScope };
      if (aiScopeCutoffAt) {
        const dt = new Date(aiScopeCutoffAt);
        if (!isNaN(dt.getTime())) body.aiScopeCutoffAt = dt.toISOString();
      }
      const res = await apiRequest('/api/admin/ai-rollout-scope', { method: 'PATCH', body });
      const d = res?.data;
      if (d?.ai_scope_cutoff_at) {
        setAiScopeCutoffAt(new Date(d.ai_scope_cutoff_at).toISOString().slice(0, 16));
      }
      if (res?.summary) setAiScopeSummary(res.summary);
      toast(res?.message || 'AI Rollout Scope tersimpan.', 'success');
      if (aiScope === 'ALL') {
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
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-extrabold tracking-tight text-white flex items-center space-x-3">
          <SettingsIcon className="text-pink-400" />
          <span>Operational Settings</span>
        </h2>
        <p className="text-slate-400">Configure coordinates, delivery tiers, active engines, and auto-responders</p>
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
        setAiScope={setAiScope}
        aiScopeCutoffAt={aiScopeCutoffAt}
        setAiScopeCutoffAt={setAiScopeCutoffAt}
        aiScopeSummary={aiScopeSummary}
        savingAiScope={savingAiScope}
        handleSaveAiScope={handleSaveAiScope}
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
      />

      {/* MQL Automation & Media Retention Settings */}
      <MqlSettingsPanel
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

      {/* Install App (PWA) */}
      <InstallAppPanel />

      {/* Remaining panels: Global Toggle + Branch Picker + Delivery Tiers + Broadcast */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

        {/* Left column: Global Bot Toggle + Branch picker */}
        <div className="space-y-8">

          {/* Bot ON/OFF Toggle */}
          <div className="glass-panel border border-white/5 rounded-2xl p-6 space-y-4">
            <h3 className="text-base font-bold text-white flex items-center space-x-2">
              <ShieldCheck className="text-pink-400" />
              <span>Global Chatbot Toggle</span>
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Enable or disable the AI responder engine globally. When disabled, all incoming WhatsApp messages are automatically bypassed and routed directly to human handling.
            </p>
            <div className="flex items-center justify-between p-4 rounded-xl bg-slate-950 border border-white/5 mt-4">
              <span className="text-sm font-semibold text-slate-300">AI Auto-Responder Bot</span>
              <button
                onClick={() => handleSaveGlobalToggle(!globalBotActive)}
                className={`w-14 h-7 rounded-full transition-all relative ${globalBotActive ? 'bg-emerald-500' : 'bg-rose-500'}`}
              >
                <div className={`absolute top-1 left-1 bg-white h-5 w-5 rounded-full transition-all ${globalBotActive ? 'translate-x-7' : ''}`}></div>
              </button>
            </div>
          </div>

          {/* Coordinate picker & Branch Map */}
          <div className="glass-panel border border-white/5 rounded-2xl p-6 space-y-4">
            <h3 className="text-base font-bold text-white flex items-center space-x-2">
              <MapPin className="text-pink-400" />
              <span>Branch Coordinate Picker (Map)</span>
            </h3>

            {/* Out of scope Alert banner */}
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-start space-x-2 text-[10px]">
              <AlertTriangle className="flex-shrink-0 mt-0.5" size={14} />
              <div>
                <p className="font-bold">UI Demo Only (Belum Tersambung Backend Tier 2.4)</p>
                <p className="mt-0.5 text-amber-500/80">
                  Data koordinat cabang yang diinput di sini hanya tersimpan lokal di browser dan belum terintegrasi dengan backend delivery.service.ts.
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-400">
              Set the GPS location of the clinic branch. This is the starting point for calculating distance-based homecare delivery fees.
            </p>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Branch Name</label>
                <input
                  type="text"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  className="w-full p-2.5 bg-slate-950 border border-white/5 rounded-xl text-xs text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400">Latitude</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={lat}
                    onChange={(e) => setLat(parseFloat(e.target.value))}
                    className="w-full p-2.5 bg-slate-950 border border-white/5 rounded-xl text-xs text-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400">Longitude</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={lng}
                    onChange={(e) => setLng(parseFloat(e.target.value))}
                    className="w-full p-2.5 bg-slate-950 border border-white/5 rounded-xl text-xs text-white"
                  />
                </div>
              </div>

              {/* Simulated Map */}
              <div className="h-40 rounded-xl bg-slate-950 border border-white/5 relative overflow-hidden flex items-center justify-center">
                <Map className="absolute text-slate-800 w-full h-full opacity-20" />
                <div className="relative text-center space-y-1">
                  <MapPin className="mx-auto text-pink-400 animate-bounce" size={24} />
                  <p className="text-[10px] text-slate-400 font-semibold">{branchName}</p>
                  <p className="text-[9px] text-slate-500">[{lat}, {lng}]</p>
                </div>
              </div>

              <button
                onClick={handleSaveBranch}
                className="px-4 py-2 bg-pink-500 hover:bg-pink-600 text-white rounded-xl text-xs font-bold transition flex items-center space-x-1.5"
              >
                <Check size={14} />
                <span>Save Location Coordinates</span>
              </button>
            </div>
          </div>

        </div>

        {/* Right column: Tiering Ongkir & Broadcast Engine */}
        <div className="space-y-8">

          {/* Delivery fee tiering */}
          <div className="glass-panel border border-white/5 rounded-2xl p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-base font-bold text-white flex items-center space-x-2">
                <Truck className="text-pink-400" />
                <span>Delivery Fee Tiering (Homecare)</span>
              </h3>
              <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[9px] font-bold">
                Haversine Active
              </span>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Tentukan tarif biaya pengiriman (ongkir) normal dan potongan promo berdasarkan jarak haversine rute dari koordinat spa ke lokasi customer. Editor lengkap dengan simulasi ada di menu <span className="text-pink-400 font-semibold">Delivery Fee</span>.
            </p>

            <div className="space-y-3">
              {ongkirTiers.map((tier, idx) => (
                <div key={tier.id} className="grid grid-cols-4 gap-2 items-end">
                  <div className="space-y-1">
                    <label className="text-[9px] text-slate-500 block uppercase font-bold">Max Dist (km)</label>
                    <input
                      type="number"
                      value={tier.maxDist}
                      onChange={(e) => {
                        const newTiers = [...ongkirTiers];
                        newTiers[idx].maxDist = parseFloat(e.target.value);
                        setOngkirTiers(newTiers);
                      }}
                      className="w-full p-2 bg-slate-950 border border-white/5 rounded-lg text-xs text-white"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] text-slate-500 block uppercase font-bold">Normal Fee (Rp)</label>
                    <input
                      type="number"
                      value={tier.fee}
                      onChange={(e) => {
                        const newTiers = [...ongkirTiers];
                        newTiers[idx].fee = parseInt(e.target.value);
                        setOngkirTiers(newTiers);
                      }}
                      className="w-full p-2 bg-slate-950 border border-white/5 rounded-lg text-xs text-white"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] text-slate-500 block uppercase font-bold">Promo Disc (Rp)</label>
                    <input
                      type="number"
                      value={tier.promoDiscount !== undefined ? tier.promoDiscount : 0}
                      onChange={(e) => {
                        const newTiers = [...ongkirTiers];
                        newTiers[idx].promoDiscount = parseInt(e.target.value) || 0;
                        setOngkirTiers(newTiers);
                      }}
                      className="w-full p-2 bg-slate-950 border border-white/5 rounded-lg text-xs text-white"
                    />
                  </div>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => { setOngkirTiers(ongkirTiers.filter(t => t.id !== tier.id)); }}
                      className="p-2 w-full rounded bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500 hover:text-white transition flex justify-center items-center"
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
                  className="px-3 py-1.5 bg-white/5 border border-white/5 rounded-lg text-[10px] font-bold text-slate-400 hover:text-white flex items-center space-x-1"
                >
                  <Plus size={10} />
                  <span>Add Tier</span>
                </button>

                <button
                  onClick={handleSaveOngkirTiers}
                  className="px-4 py-1.5 bg-pink-500 hover:bg-pink-600 text-white rounded-lg text-[10px] font-bold transition flex items-center space-x-1"
                >
                  <Check size={10} />
                  <span>Save Tiers</span>
                </button>
              </div>
            </div>
          </div>

          {/* Broadcast & Quiet Hours with Alert Banner */}
          <div className="glass-panel border border-white/5 rounded-2xl p-6 space-y-6">

            {/* Out of scope Alert banner */}
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-start space-x-3 text-xs">
              <AlertTriangle className="flex-shrink-0 mt-0.5" size={16} />
              <div>
                <p className="font-bold">Broadcast &amp; Quiet Hours Engine</p>
                <p className="mt-0.5 text-[10px] text-amber-500/80">
                  ⚠️ **PEMBERITAHUAN:** Fitur backend Tier 3 belum aktif. Tampilan di bawah ini bersifat mockup UI mandiri.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-base font-bold text-white flex items-center space-x-2">
                <Volume2 className="text-pink-400" />
                <span>Broadcast message editor</span>
              </h3>

              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Broadcast Teks</label>
                <textarea
                  rows={3}
                  value={broadcastText}
                  onChange={(e) => setBroadcastText(e.target.value)}
                  placeholder="Kirim promo bulanan ke pelanggan loyal..."
                  className="w-full p-3 bg-slate-950 border border-white/5 rounded-xl text-xs text-white resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400">Random delay interval (sec)</label>
                  <input
                    type="number"
                    value={randomDelay}
                    onChange={(e) => setRandomDelay(parseInt(e.target.value))}
                    className="w-full p-2 bg-slate-950 border border-white/5 rounded-xl text-xs text-white"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400">Quiet Hours (Start - End)</label>
                  <div className="flex space-x-2 items-center">
                    <input
                      type="text"
                      value={quietHoursStart}
                      onChange={(e) => setQuietHoursStart(e.target.value)}
                      className="w-full p-2 bg-slate-950 border border-white/5 rounded-xl text-xs text-white text-center"
                    />
                    <span className="text-slate-500">-</span>
                    <input
                      type="text"
                      value={quietHoursEnd}
                      onChange={(e) => setQuietHoursEnd(e.target.value)}
                      className="w-full p-2 bg-slate-950 border border-white/5 rounded-xl text-xs text-white text-center"
                    />
                  </div>
                </div>
              </div>

              <button
                disabled
                className="w-full py-2 bg-white/5 border border-white/5 text-slate-500 rounded-xl text-xs font-semibold cursor-not-allowed flex items-center justify-center space-x-1"
                title="Menunggu backend Tier 3"
              >
                <span>Queue Broadcast Campaign (Waiting Backend Tier 3)</span>
              </button>
            </div>

          </div>

        </div>

      </div>
    </div>
  );
};
