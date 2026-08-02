import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../../components/common/UiFeedback';
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
  Save
} from 'lucide-react';

export const Settings: React.FC = () => {
  const { toast } = useUiFeedback();
  const [globalBotActive, setGlobalBotActive] = useState(true);
  const [loading, setLoading] = useState(true);
  
  // Coordinates & branch picker (persisted locally)
  const [lat, setLat] = useState(-7.2758);
  const [lng, setLng] = useState(112.7913);
  const [branchName, setBranchName] = useState('Kala Moms & Baby Spa — Mulyosari');

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
  const [wabaConfigured, setWabaConfigured] = useState(false);
  const [wabaPhoneNumberId, setWabaPhoneNumberId] = useState('');
  const [wabaBusinessAccountId, setWabaBusinessAccountId] = useState('');
  const [wabaAccessToken, setWabaAccessToken] = useState('');
  const [wabaWebhookVerifyToken, setWabaWebhookVerifyToken] = useState('');
  const [wabaTemplates, setWabaTemplates] = useState<Array<{
    type: string; variant: number; templateName: string; category: string; status: string; isActive: boolean; isDefault: boolean;
  }>>([]);
  const [savingProvider, setSavingProvider] = useState(false);

  useEffect(() => {
    async function loadSettings() {
      try {
        const data = await apiRequest('/api/admin/settings');
        setGlobalBotActive(data.globalBotActive);
        
        // Load branch from localStorage if available
        const localBranch = localStorage.getItem('kala_branch_settings');
        if (localBranch) {
          const parsed = JSON.parse(localBranch);
          setLat(parsed.lat);
          setLng(parsed.lng);
          setBranchName(parsed.name);
        }
        
        // Fetch tiers from backend API
        const tiersRes = await apiRequest('/api/admin/delivery-tiers');
        const list = Array.isArray(tiersRes) ? tiersRes : (tiersRes?.data || []);
        if (list.length > 0) {
          setOngkirTiers(list);
        }

        // Fetch WhatsApp provider status (Fase 5)
        await loadWhatsAppProvider();
      } catch (err) {
        console.warn('Failed to load global chatbot settings:', err);
      } finally {
        setLoading(false);
      }
    }
    loadSettings();
  }, []);

  const loadWhatsAppProvider = async () => {
    try {
      const res = await apiRequest('/api/admin/whatsapp-provider');
      const d = res?.data;
      if (d) {
        setProvider(d.provider || 'WAHA');
        setWahaStatus(d.wahaStatus || 'UNKNOWN');
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

      {/* WhatsApp Provider Panel (Fase 5) */}
      <div className="glass-panel border border-white/5 rounded-2xl p-6 space-y-5">
        <div className="flex justify-between items-center">
          <h3 className="text-base font-bold text-white flex items-center space-x-2">
            <MessageCircle className="text-pink-400" />
            <span>WhatsApp Provider</span>
          </h3>
          <button
            onClick={loadWhatsAppProvider}
            className="px-3 py-1.5 bg-white/5 border border-white/5 rounded-lg text-[10px] font-bold text-slate-400 hover:text-white flex items-center space-x-1"
          >
            <RefreshCw size={10} />
            <span>Refresh</span>
          </button>
        </div>
        <p className="text-xs text-slate-400 leading-relaxed">
          Pilih channel pengiriman WhatsApp untuk tenant ini. <span className="text-pink-400 font-semibold">WAHA</span> (session self-hosted, teks bebas) atau <span className="text-pink-400 font-semibold">WABA</span> (Meta Cloud API, wajib HSM template patuh regulasi). Safety net default tetap WAHA.
        </p>

        {/* Status indicator */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="p-3 rounded-xl bg-slate-950 border border-white/5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-bold text-slate-500">Provider Aktif</span>
              <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${provider === 'WABA' ? 'bg-pink-500/20 text-pink-300' : 'bg-emerald-500/20 text-emerald-300'}`}>
                {provider}
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-1 font-semibold">{provider === 'WABA' ? 'Meta Cloud API v25.0' : 'WAHA Self-Hosted'}</p>
          </div>
          <div className="p-3 rounded-xl bg-slate-950 border border-white/5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-bold text-slate-500">WAHA Session</span>
              <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${wahaStatus === 'WORKING' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`}>
                {wahaStatus}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">{wahaStatus === 'WORKING' ? 'Session terhubung' : 'Cek status WAHA'}</p>
          </div>
          <div className="p-3 rounded-xl bg-slate-950 border border-white/5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-bold text-slate-500">WABA Config</span>
              <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${wabaConfigured ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}>
                {wabaConfigured ? 'CONFIGURED' : 'NOT CONFIGURED'}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">{wabaConfigured ? 'Token + Phone Number ID siap' : 'Lengkapi kredensial WABA dulu'}</p>
          </div>
        </div>

        {/* Provider toggle */}
        <div className="flex items-center justify-between p-4 rounded-xl bg-slate-950 border border-white/5">
          <div>
            <p className="text-sm font-semibold text-slate-300">Channel Outbound Utama</p>
            <p className="text-[10px] text-slate-500 mt-0.5">Toggle ini memengaruhi follow-up &amp; reminder engine (per tenant)</p>
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

        {/* WABA credentials */}
        <div className="space-y-3 p-4 rounded-xl bg-slate-950/50 border border-white/5">
          <h4 className="text-xs font-bold text-white flex items-center space-x-2">
            <KeyRound size={12} className="text-pink-400" />
            <span>Kredensial WABA (token terenkripsi AES-256)</span>
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
                  placeholder="Kirim promo bulanan Kala Spa ke pelanggan loyal..."
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
