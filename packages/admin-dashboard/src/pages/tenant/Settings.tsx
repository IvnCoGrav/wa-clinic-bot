import React, { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../../components/common/UiFeedback';
import { BRAND } from '../../config/brand';

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
      <div className="glass-panel border border-white/5 rounded-2xl p-6 space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-base font-bold text-white flex items-center space-x-2">
            <MessageCircle className="text-pink-400" />
            <span>WhatsApp Gateway</span>
          </h3>
          <button
            onClick={loadWhatsAppProvider}
            className="px-3 py-1.5 bg-white/5 border border-white/5 rounded-lg text-[10px] font-bold text-slate-400 hover:text-white flex items-center space-x-1"
          >
            <RefreshCw size={10} />
            <span>Refresh</span>
          </button>
        </div>

        {/* Channel aktif + toggle */}
        <div className="flex items-center justify-between p-4 rounded-xl bg-slate-950 border border-white/5">
          <div className="flex items-center space-x-3">
            <span className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${provider === 'WABA' ? 'bg-pink-500/20 text-pink-300' : 'bg-emerald-500/20 text-emerald-300'}`}>
              {provider === 'WABA' ? 'Meta Cloud API v25.0' : 'WAHA Self-Hosted'}
            </span>
            <p className="text-[10px] text-slate-500">Channel outbound aktif untuk follow-up &amp; reminder engine. Safety net default WAHA.</p>
          </div>
          <div className="flex space-x-2">
            <button
              onClick={() => handleToggleProvider('WAHA')}
              disabled={savingProvider || provider === 'WAHA'}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition ${provider === 'WAHA' ? 'bg-emerald-500 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`}
            >
              WAHA
            </button>
            <button
              onClick={() => handleToggleProvider('WABA')}
              disabled={savingProvider || provider === 'WABA'}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition ${provider === 'WABA' ? 'bg-pink-500 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`}
            >
              WABA
            </button>
          </div>
        </div>

        {/* Sub-tab WAHA / WABA */}
        <div className="flex space-x-1 p-1 rounded-xl bg-slate-950 border border-white/5 w-fit">
          <button
            onClick={() => setProviderTab('WAHA')}
            className={`px-4 py-1.5 rounded-lg text-[11px] font-bold transition flex items-center space-x-1.5 ${providerTab === 'WAHA' ? 'bg-emerald-500 text-white' : 'text-slate-400 hover:bg-white/5'}`}
          >
            <MessageCircle size={12} />
            <span>WAHA</span>
          </button>
          <button
            onClick={() => setProviderTab('WABA')}
            className={`px-4 py-1.5 rounded-lg text-[11px] font-bold transition flex items-center space-x-1.5 ${providerTab === 'WABA' ? 'bg-pink-500 text-white' : 'text-slate-400 hover:bg-white/5'}`}
          >
            <MessageCircle size={12} />
            <span>WABA</span>
          </button>
        </div>

        {/* Tab WAHA */}
        {providerTab === 'WAHA' && (
          <div className="space-y-3 p-4 rounded-xl bg-slate-950/50 border border-white/5">
            <h4 className="text-xs font-bold text-emerald-300 flex items-center space-x-2">
              <MessageCircle size={12} />
              <span>WAHA Session (Self-Hosted)</span>
            </h4>
            <p className="text-[10px] text-slate-400 leading-relaxed">
              Gateway WhatsApp self-hosted via WAHA. Kirim teks bebas (tidak terikat HSM template Meta), cocok untuk percakapan dalam 24h window.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-slate-950 border border-white/5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold text-slate-500">Status Session</span>
                  <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${wahaStatus === 'WORKING' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`}>
                    {wahaStatus}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1">{wahaStatus === 'WORKING' ? 'Session terhubung' : 'Cek dashboard WAHA — mungkin butuh re-scan QR'}</p>
              </div>
              <div className="p-3 rounded-xl bg-slate-950 border border-white/5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold text-slate-500">Session ID</span>
                  <span className="text-[11px] font-mono text-slate-300">{wahaSessionId}</span>
                </div>
                <p className="text-xs text-slate-400 mt-1">WAHA dashboard: <span className="text-slate-300">port 3001</span></p>
              </div>
            </div>

            {/* Fitur 1: Konek WhatsApp via QR — scan QR dari Admin UI tanpa perlu dashboard WAHA */}
            <div className="space-y-3 p-4 rounded-xl bg-slate-950/50 border border-white/5">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-emerald-300 flex items-center space-x-2">
                  <QrCode size={12} />
                  <span>Koneksi WhatsApp (Scan QR)</span>
                </h4>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={loadQr}
                    disabled={loadingQr}
                    className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/5 text-[9px] font-bold text-slate-300 hover:text-white flex items-center space-x-1 disabled:opacity-50"
                  >
                    <RefreshCw size={9} className={loadingQr ? 'animate-spin' : ''} />
                    <span>Segarkan</span>
                  </button>

                  <button
                    onClick={handleDisconnectSession}
                    disabled={disconnectingSession || resettingSession || startingSession}
                    className="px-2.5 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/30 text-rose-300 text-[9px] font-bold flex items-center space-x-1 disabled:opacity-50"
                    title="Putuskan koneksi WAHA (Logout / Stop Session)"
                  >
                    <Power size={9} />
                    <span>{disconnectingSession ? 'Memutuskan...' : 'Putuskan Koneksi'}</span>
                  </button>
                  {canStartSession && (
                    <button
                      onClick={canResetSession ? handleResetSession : handleStartSession}
                      disabled={resettingSession || startingSession}
                      className={`px-2.5 py-1 rounded-lg text-white text-[9px] font-bold flex items-center space-x-1 disabled:opacity-50 ${
                        canResetSession ? 'bg-rose-500 hover:bg-rose-600' : 'bg-emerald-500 hover:bg-emerald-600'
                      }`}
                    >
                      <Play size={9} fill="currentColor" />
                      <span>
                        {canResetSession
                          ? resettingSession
                            ? 'Mereset...'
                            : 'Reset & Scan Ulang'
                          : startingSession
                            ? 'Memulai...'
                            : 'Mulai Session / Scan QR Baru'}
                      </span>
                    </button>
                  )}
                </div>
              </div>

              {loadingQr && !qrData ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw size={20} className="animate-spin text-emerald-400" />
                </div>
              ) : qrData && qrStatus === 'SCAN_QR_CODE' ? (
                <div className="flex flex-col items-center gap-3">
                  <div className="p-3 bg-white rounded-xl w-fit">
                    <img
                      src={`data:${qrData.mimetype};base64,${qrData.data}`}
                      alt="QR WhatsApp Session"
                      className="w-72 h-72"
                    />
                  </div>
                  <p className="text-[10px] text-slate-400 text-center leading-relaxed">
                    Pindai dengan <span className="text-emerald-300 font-semibold">WhatsApp &gt; Setelan &gt; Perangkat Tertaut &gt; Tautkan Perangkat</span>.
                    QR kedaluwarsa otomatis (~20 detik) — klik <span className="text-slate-300">Segarkan</span> untuk QR baru.
                  </p>
                </div>
              ) : qrStatus === 'WORKING' ? (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[11px]">
                  <Check size={14} />
                  <span>Session terhubung — WhatsApp aktif. QR tidak diperlukan.</span>
                </div>
              ) : (
                <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[10px] leading-relaxed">
                  <div className="flex items-start space-x-2">
                    <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                    <span>{qrMessage || 'Session WAHA terputus / belum terhubung.'}</span>
                  </div>
                  {canStartSession && (
                    <p className="mt-2 text-amber-400/80">
                      {canResetSession
                        ? 'Session FAILED sudah-paired tidak bisa dipulihkan dengan start biasa. Klik <span className="font-bold">Reset &amp; Scan Ulang</span> untuk membuat session baru dan memunculkan QR.'
                        : 'Klik tombol <span className="font-bold font-mono text-emerald-300">Mulai Session / Scan QR Baru</span> di atas untuk menghubungkan nomor WhatsApp baru.'}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab WABA */}
        {providerTab === 'WABA' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/50 border border-white/5">
              <div>
                <h4 className="text-xs font-bold text-pink-300 flex items-center space-x-2">
                  <MessageCircle size={12} />
                  <span>WABA (Meta Cloud API)</span>
                </h4>
                <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                  Outbound wajib memakai <span className="text-pink-400 font-semibold">HSM template</span> (patuh regulasi, hanya dalam 24h window percakapan). Kredensial disimpan terenkripsi AES-256.
                </p>
              </div>
              <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${wabaConfigured ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}>
                {wabaConfigured ? 'CONFIGURED' : 'NOT CONFIGURED'}
              </span>
            </div>

            {/* Kredensial WABA */}
            <div className="space-y-3 p-4 rounded-xl bg-slate-950/50 border border-white/5">
              <h4 className="text-xs font-bold text-white flex items-center space-x-2">
                <KeyRound size={12} className="text-pink-400" />
                <span>Kredensial WABA</span>
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-bold">Phone Number ID</label>
                  <input
                    type="text"
                    value={wabaPhoneNumberId}
                    onChange={(e) => setWabaPhoneNumberId(e.target.value)}
                    placeholder="123456789"
                    className="w-full p-2 bg-slate-950 border border-white/5 rounded-lg text-xs text-white"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-bold">Business Account ID</label>
                  <input
                    type="text"
                    value={wabaBusinessAccountId}
                    onChange={(e) => setWabaBusinessAccountId(e.target.value)}
                    placeholder="000000000000000"
                    className="w-full p-2 bg-slate-950 border border-white/5 rounded-lg text-xs text-white"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-bold">Access Token (isi hanya saat ganti)</label>
                  <input
                    type="password"
                    value={wabaAccessToken}
                    onChange={(e) => setWabaAccessToken(e.target.value)}
                    placeholder="EAA..."
                    className="w-full p-2 bg-slate-950 border border-white/5 rounded-lg text-xs text-white"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-bold">Webhook Verify Token</label>
                  <input
                    type="text"
                    value={wabaWebhookVerifyToken}
                    onChange={(e) => setWabaWebhookVerifyToken(e.target.value)}
                    placeholder="verify_token"
                    className="w-full p-2 bg-slate-950 border border-white/5 rounded-lg text-xs text-white"
                  />
                </div>
              </div>
              <button
                onClick={handleSaveWabaConfig}
                disabled={savingProvider}
                className="px-4 py-2 bg-pink-500 hover:bg-pink-600 text-white rounded-xl text-xs font-bold transition flex items-center space-x-1.5 disabled:opacity-50"
              >
                <Save size={12} />
                <span>{savingProvider ? 'Saving...' : 'Save WABA Config'}</span>
              </button>
            </div>

            {/* Template status */}
            <div className="space-y-3 p-4 rounded-xl bg-slate-950/50 border border-white/5">
              <h4 className="text-xs font-bold text-white flex items-center space-x-2">
                <FileCheck size={12} className="text-pink-400" />
                <span>Status Template HSM (9 stage follow-up)</span>
              </h4>
              {wabaTemplates.length === 0 ? (
                <p className="text-[10px] text-slate-500">Belum ada data template. Refresh untuk memuat.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  {wabaTemplates.map((t) => (
                    <div key={t.type} className="p-2.5 rounded-lg bg-slate-950 border border-white/5 flex items-center justify-between space-x-2">
                      <div className="min-w-0">
                        <p className="text-[10px] text-slate-300 font-semibold truncate">{t.type}</p>
                        <p className="text-[9px] text-slate-500 truncate">{t.templateName}</p>
                        <div className="flex items-center space-x-1 mt-1">
                          <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${t.category === 'MARKETING' ? 'bg-amber-500/20 text-amber-300' : 'bg-sky-500/20 text-sky-300'}`}>
                            {t.category}
                          </span>
                          {t.status === 'APPROVED' ? (
                            <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-emerald-500/20 text-emerald-300 flex items-center space-x-0.5">
                              <FileCheck size={8} /> APPROVED
                            </span>
                          ) : t.status === 'PENDING' ? (
                            <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-amber-500/20 text-amber-300 flex items-center space-x-0.5">
                              <FileClock size={8} /> PENDING
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-rose-500/20 text-rose-300 flex items-center space-x-0.5">
                              <FileX size={8} /> {t.status}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[9px] text-slate-500">
                Edit mapping &amp; status template di menu <span className="text-pink-400">Follow-Up Templates</span>. Template belum APPROVED akan otomatis di-skip follow-up WABA (aman patuh Meta).
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Meta Pixel & CAPI — konversi iklan, berlaku utk semua provider (WAHA & WABA) */}
      <div className="glass-panel border border-white/5 rounded-2xl p-6 space-y-4">
        <div className="flex justify-between items-center">
          <div>
            <h3 className="text-base font-bold text-white flex items-center space-x-2">
              <BarChart3 className="text-pink-400" />
              <span>Meta Pixel &amp; CAPI (Konversi Iklan)</span>
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed mt-1">
              Berlaku untuk semua provider WhatsApp (<span className="text-emerald-400 font-semibold">WAHA</span> &amp; <span className="text-pink-400 font-semibold">WABA</span>). Digunakan landing page (Pixel) &amp; server-side event Lead/Purchase ke Meta (CAPI).
            </p>
          </div>
          <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold ${capiSource === 'db' && capiConfigured ? 'bg-emerald-500/20 text-emerald-300' : capiSource === 'db' ? 'bg-amber-500/20 text-amber-300' : capiSource === 'env' ? 'bg-sky-500/20 text-sky-300' : 'bg-rose-500/20 text-rose-300'}`}>
            {capiSource === 'db' && capiConfigured ? 'CONFIGURED'
              : capiSource === 'db' ? 'PARTIAL'
              : capiSource === 'env' ? 'ENV FALLBACK'
              : 'NOT CONFIGURED'}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-4 rounded-xl bg-slate-950/50 border border-white/5">
          <div className="space-y-1">
            <label className="text-[10px] text-slate-400 uppercase font-bold">Meta Pixel ID</label>
            <input
              type="text"
              value={metaPixelId}
              onChange={(e) => setMetaPixelId(e.target.value)}
              placeholder="123456789012345"
              className="w-full p-2 bg-slate-950 border border-white/5 rounded-lg text-xs text-white"
            />
            <p className="text-[9px] text-slate-500">ID Pixel Facebook (dipakai tracking landing &amp; ad clicks).</p>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-slate-400 uppercase font-bold">CAPI Access Token (isi hanya saat ganti)</label>
            <input
              type="password"
              value={capiAccessToken}
              onChange={(e) => setCapiAccessToken(e.target.value)}
              placeholder="EAA..."
              className="w-full p-2 bg-slate-950 border border-white/5 rounded-lg text-xs text-white"
            />
            <p className="text-[9px] text-slate-500">{capiConfigured ? 'Token tersimpan (terenkripsi). Kosongkan utk tidak mengubah.' : 'Belum ada token. Disimpan terenkripsi AES-256.'}</p>
          </div>
        </div>

        <button
          onClick={handleSaveCapiConfig}
          disabled={savingCapi}
          className="px-4 py-2 bg-pink-500 hover:bg-pink-600 text-white rounded-xl text-xs font-bold transition flex items-center space-x-1.5 disabled:opacity-50"
        >
          <Save size={12} />
          <span>{savingCapi ? 'Saving...' : 'Save Meta Pixel & CAPI'}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* Left column: Bot Toggle & Branch picker */}
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
              <span className="text-sm font-semibold text-slate-300">
                AI Auto-Responder Bot
              </span>
              <button
                onClick={() => handleSaveGlobalToggle(!globalBotActive)}
                className={`w-14 h-7 rounded-full transition-all relative ${globalBotActive ? 'bg-emerald-500' : 'bg-rose-500'}`}
              >
                <div className={`absolute top-1 left-1 bg-white h-5 w-5 rounded-full transition-all ${globalBotActive ? 'translate-x-7' : ''}`}></div>
              </button>
            </div>
          </div>

          {/* AI Router Engine Toggle */}
          <div className="glass-panel border border-white/5 rounded-2xl p-6 space-y-4">
            <h3 className="text-base font-bold text-white flex items-center space-x-2">
              <ShieldCheck className="text-pink-400" />
              <span>AI Router Engine</span>
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Default <span className="text-emerald-400 font-semibold">ON</span> (shadow mode aman). Aktifkan untuk mengevaluasi intent via LLM router.
              Matikan shadow mode (<span className="text-amber-400 font-semibold">full mode</span>) hanya setelah 3 gate akurasi di README lolos.
            </p>

            <div className="space-y-3">
              <div className="flex items-center justify-between p-4 rounded-xl bg-slate-950 border border-white/5">
                <div>
                  <span className="text-sm font-semibold text-slate-300">AI Router Engine</span>
                  <p className="text-[10px] text-slate-500">Klasifikasi intent via LLM router per pesan</p>
                </div>
                <button
                  onClick={() => handleToggleAiRouter('enabled', !aiRouterEnabled)}
                  disabled={savingAiRouter}
                  className={`w-14 h-7 rounded-full transition-all relative disabled:opacity-50 ${aiRouterEnabled ? 'bg-emerald-500' : 'bg-slate-600'}`}
                >
                  <div className={`absolute top-1 left-1 bg-white h-5 w-5 rounded-full transition-all ${aiRouterEnabled ? 'translate-x-7' : ''}`}></div>
                </button>
              </div>

              <div className="flex items-center justify-between p-4 rounded-xl bg-slate-950 border border-white/5">
                <div>
                  <span className="text-sm font-semibold text-slate-300">Shadow Mode</span>
                  <p className="text-[10px] text-slate-500">{aiRouterShadowMode ? 'Hanya LOG perbandingan, tidak ubah keputusan produksi' : 'Full mode: keputusan router dapat mengubah alur produksi'}</p>
                </div>
                <button
                  onClick={() => handleToggleAiRouter('shadowMode', !aiRouterShadowMode)}
                  disabled={savingAiRouter || !aiRouterEnabled}
                  className={`w-14 h-7 rounded-full transition-all relative disabled:opacity-50 ${aiRouterShadowMode ? 'bg-amber-500' : 'bg-slate-600'}`}
                >
                  <div className={`absolute top-1 left-1 bg-white h-5 w-5 rounded-full transition-all ${aiRouterShadowMode ? 'translate-x-7' : ''}`}></div>
                </button>
              </div>
            </div>
          </div>

          {/* AI Rollout Scope — AI hanya untuk customer baru */}
          <div className="glass-panel border border-white/5 rounded-2xl p-6 space-y-4">
            <h3 className="text-base font-bold text-white flex items-center space-x-2">
              <ShieldCheck className="text-pink-400" />
              <span>AI Rollout Scope</span>
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Batasi AI hanya untuk customer <span className="text-emerald-400 font-semibold">baru</span> (created_at &gt;= cutoff).
              Customer <span className="text-amber-400 font-semibold">legacy</span> otomatis di-senyapkan &amp; dirutekan ke human handling
              pada state idle/reset (sesi percakapan berjalan tidak dipotong). Berlaku utk pesan setelah simpan.
            </p>

            <div className="space-y-3">
              <div className="flex items-center justify-between p-4 rounded-xl bg-slate-950 border border-white/5">
                <div>
                  <span className="text-sm font-semibold text-slate-300">Cakupan AI</span>
                  <p className="text-[10px] text-slate-500">
                    {aiScope === 'NEW_ONLY' ? 'Hanya customer baru dapat AI (rollout bertahap)' : 'Semua customer dapat AI (rollout penuh)'}
                  </p>
                </div>
                <button
                  onClick={() => setAiScope(aiScope === 'NEW_ONLY' ? 'ALL' : 'NEW_ONLY')}
                  disabled={savingAiScope}
                  className={`w-14 h-7 rounded-full transition-all relative disabled:opacity-50 ${aiScope === 'ALL' ? 'bg-emerald-500' : 'bg-amber-500'}`}
                >
                  <div className={`absolute top-1 left-1 bg-white h-5 w-5 rounded-full transition-all ${aiScope === 'ALL' ? 'translate-x-7' : ''}`}></div>
                </button>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">Cutoff Rollout (created_at &lt; cutoff = legacy)</label>
                <input
                  type="datetime-local"
                  value={aiScopeCutoffAt}
                  onChange={(e) => setAiScopeCutoffAt(e.target.value)}
                  className="w-full p-2.5 bg-slate-950 border border-white/5 rounded-xl text-xs text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="p-3 rounded-xl bg-slate-950 border border-white/5">
                  <div className="text-[9px] uppercase tracking-wider text-slate-500">Total</div>
                  <div className="text-lg font-bold text-white">{aiScopeSummary.totalCustomers}</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-white/5">
                  <div className="text-[9px] uppercase tracking-wider text-slate-500">Baru (AI)</div>
                  <div className="text-lg font-bold text-emerald-400">{aiScopeSummary.newCustomers}</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-white/5">
                  <div className="text-[9px] uppercase tracking-wider text-slate-500">Legacy</div>
                  <div className="text-lg font-bold text-amber-400">{aiScopeSummary.legacyCustomers}</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-white/5">
                  <div className="text-[9px] uppercase tracking-wider text-slate-500">Tersenyapkan</div>
                  <div className="text-lg font-bold text-pink-400">{aiScopeSummary.silencedByScope}</div>
                </div>
              </div>
            </div>

            <button
              onClick={handleSaveAiScope}
              disabled={savingAiScope}
              className="px-4 py-2 bg-pink-500 hover:bg-pink-600 text-white rounded-xl text-xs font-bold transition flex items-center space-x-1.5 disabled:opacity-50"
            >
              <Save size={12} />
              <span>{savingAiScope ? 'Saving...' : 'Simpan AI Rollout Scope'}</span>
            </button>
          </div>

          {/* MQL Automation & Lead Event Configuration */}
          <div className="glass-panel border border-white/5 rounded-2xl p-6 space-y-4">
            <h3 className="text-base font-bold text-white flex items-center space-x-2">
              <BarChart3 className="text-pink-400" />
              <span>MQL Automation & Trigger Event Lead</span>
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Kualifikasi customer otomatis menjadi <span className="text-emerald-400 font-semibold">Minimum Qualified Lead (MQL)</span> ketika jumlah pesan/bubble chat dari customer mencapai ambang batas yang ditentukan.
            </p>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">Target Bubble Chat ke- (Threshold MQL)</label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={mqlThresholdBubbles}
                  onChange={(e) => setMqlThresholdBubbles(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  className="w-full p-2.5 bg-slate-950 border border-white/5 rounded-xl text-xs text-white"
                  placeholder="Contoh: 5"
                />
                <p className="text-[10px] text-slate-500">Saat customer mengirim bubble ke-{mqlThresholdBubbles}, status customer otomatis berubah menjadi MQL.</p>
              </div>

              <div className="flex items-center justify-between p-4 rounded-xl bg-slate-950 border border-white/5">
                <div>
                  <span className="text-sm font-semibold text-slate-300">Auto-Trigger Event 'Lead' (Meta CAPI)</span>
                  <p className="text-[10px] text-slate-500">Kirim event Lead otomatis ke Meta CAPI 1x saat customer mencapai status MQL</p>
                </div>
                <button
                  onClick={() => setMqlAutoLeadEnabled(!mqlAutoLeadEnabled)}
                  className={`w-14 h-7 rounded-full transition-all relative ${mqlAutoLeadEnabled ? 'bg-emerald-500' : 'bg-slate-600'}`}
                >
                  <div className={`absolute top-1 left-1 bg-white h-5 w-5 rounded-full transition-all ${mqlAutoLeadEnabled ? 'translate-x-7' : ''}`}></div>
                </button>
              </div>

              <button
                onClick={handleSaveMqlSettings}
                disabled={savingMql}
                className="px-4 py-2 bg-pink-500 hover:bg-pink-600 text-white rounded-xl text-xs font-bold transition flex items-center space-x-1.5 disabled:opacity-50"
              >
                <Save size={14} />
                <span>{savingMql ? 'Memproses...' : 'Simpan Pengaturan MQL'}</span>
              </button>
            </div>
          </div>

          {/* Live Chat Media — retensi file gambar outbound/inbound */}
          <div className="glass-panel border border-white/5 rounded-2xl p-6 space-y-4">
            <h3 className="text-base font-bold text-white flex items-center space-x-2">
              <ImageIcon className="text-pink-400" />
              <span>Live Chat Media (Retensi Gambar)</span>
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Gambar yang dikirim admin (outbound) &amp; dari customer (inbound) disimpan di <span className="text-slate-300 font-mono">storage/media</span>.
              File kadaluarsa dihapus otomatis oleh cron cleanup setelah melewati masa retensi ini.
            </p>

            <div className="space-y-3 p-4 rounded-xl bg-slate-950 border border-white/5">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">Masa Retensi (hari)</label>
                <input
                  type="number"
                  min="1"
                  max="3650"
                  value={mediaRetentionDays}
                  onChange={(e) => setMediaRetentionDays(e.target.value)}
                  className="w-full p-2.5 bg-slate-950 border border-white/5 rounded-xl text-xs text-white"
                  placeholder="Contoh: 30"
                />
                <p className="text-[10px] text-slate-500">
                  Simpan per-tenant (kolom <span className="text-slate-300 font-mono">tenants.media_retention_days</span>).
                  Fallback global env: <span className="text-slate-300 font-mono">{mediaEnvFallbackDays}</span> hari.
                </p>
              </div>

              <button
                onClick={handleSaveMediaRetention}
                disabled={savingMediaRetention}
                className="px-4 py-2 bg-pink-500 hover:bg-pink-600 text-white rounded-xl text-xs font-bold transition flex items-center space-x-1.5 disabled:opacity-50"
              >
                <Save size={14} />
                <span>{savingMediaRetention ? 'Memproses...' : 'Simpan Retensi Media'}</span>
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
                      onClick={() => {
                        setOngkirTiers(ongkirTiers.filter(t => t.id !== tier.id));
                      }}
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
                  onClick={() => {
                    setOngkirTiers([...ongkirTiers, { id: Date.now(), maxDist: 20, fee: 30000, promoDiscount: 5000 }]);
                  }}
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
                <p className="font-bold">Broadcast & Quiet Hours Engine</p>
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
