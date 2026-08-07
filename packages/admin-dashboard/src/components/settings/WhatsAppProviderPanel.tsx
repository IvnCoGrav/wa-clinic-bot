import React from 'react';
import { 
  MessageCircle, 
  RefreshCw, 
  QrCode, 
  Power, 
  Play, 
  Check, 
  AlertTriangle,
  KeyRound,
  ShieldCheck,
  FileCheck,
  FileClock,
  FileX
} from 'lucide-react';

interface Props {
  provider: 'WAHA' | 'WABA';
  providerTab: 'WAHA' | 'WABA';
  setProviderTab: (tab: 'WAHA' | 'WABA') => void;
  savingProvider: boolean;
  handleToggleProvider: (p: 'WAHA' | 'WABA') => void;
  loadWhatsAppProvider: () => void;
  wahaStatus: string;
  wahaSessionId: string;
  qrData: { mimetype: string; data: string } | null;
  qrStatus: string;
  qrMessage: string;
  loadingQr: boolean;
  startingSession: boolean;
  resettingSession: boolean;
  disconnectingSession: boolean;
  canStartSession: boolean;
  canResetSession: boolean;
  loadQr: () => void;
  handleDisconnectSession: () => void;
  handleStartSession: () => void;
  handleResetSession: () => void;
  wabaConfigured: boolean;
  wabaPhoneNumberId: string;
  setWabaPhoneNumberId: (val: string) => void;
  wabaBusinessAccountId: string;
  setWabaBusinessAccountId: (val: string) => void;
  wabaAccessToken: string;
  setWabaAccessToken: (val: string) => void;
  wabaWebhookVerifyToken: string;
  setWabaWebhookVerifyToken: (val: string) => void;
  handleSaveWabaConfig: () => void;
  wabaTemplates: Array<{
    type: string;
    variant: number;
    templateName: string;
    category: string;
    status: string;
    isActive: boolean;
    isDefault: boolean;
  }>;
  handleSaveWabaTemplate: (type: string, variant: number, templateName: string) => void;
}

export const WhatsAppProviderPanel: React.FC<Props> = ({
  provider,
  providerTab,
  setProviderTab,
  savingProvider,
  handleToggleProvider,
  loadWhatsAppProvider,
  wahaStatus,
  wahaSessionId,
  qrData,
  qrStatus,
  qrMessage,
  loadingQr,
  startingSession,
  resettingSession,
  disconnectingSession,
  canStartSession,
  canResetSession,
  loadQr,
  handleDisconnectSession,
  handleStartSession,
  handleResetSession,
  wabaConfigured,
  wabaPhoneNumberId,
  setWabaPhoneNumberId,
  wabaBusinessAccountId,
  setWabaBusinessAccountId,
  wabaAccessToken,
  setWabaAccessToken,
  wabaWebhookVerifyToken,
  setWabaWebhookVerifyToken,
  handleSaveWabaConfig,
  wabaTemplates,
  handleSaveWabaTemplate,
}) => {
  return (
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

          {/* Konek WhatsApp via QR */}
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
                Outbound wajib memakai <span className="text-pink-400 font-semibold">HSM template</span>. Kredensial disimpan terenkripsi AES-256.
              </p>
            </div>
            <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold ${wabaConfigured ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
              {wabaConfigured ? 'Terorganisasi' : 'Belum Dikonfigurasi'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] uppercase font-bold text-slate-400 flex items-center space-x-1 mb-1">
                <KeyRound size={10} />
                <span>Phone Number ID</span>
              </label>
              <input
                type="text"
                value={wabaPhoneNumberId}
                onChange={(e) => setWabaPhoneNumberId(e.target.value)}
                placeholder="100982736451234"
                className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-pink-500"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase font-bold text-slate-400 flex items-center space-x-1 mb-1">
                <KeyRound size={10} />
                <span>Business Account ID</span>
              </label>
              <input
                type="text"
                value={wabaBusinessAccountId}
                onChange={(e) => setWabaBusinessAccountId(e.target.value)}
                placeholder="200192837465123"
                className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-pink-500"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase font-bold text-slate-400 flex items-center space-x-1 mb-1">
                <ShieldCheck size={10} />
                <span>Access Token (Permanent / System User)</span>
              </label>
              <input
                type="password"
                value={wabaAccessToken}
                onChange={(e) => setWabaAccessToken(e.target.value)}
                placeholder={wabaConfigured ? '•••••••• (kosongkan bila tidak diubah)' : 'EAA... System User Token'}
                className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-pink-500"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase font-bold text-slate-400 flex items-center space-x-1 mb-1">
                <ShieldCheck size={10} />
                <span>Webhook Verify Token</span>
              </label>
              <input
                type="text"
                value={wabaWebhookVerifyToken}
                onChange={(e) => setWabaWebhookVerifyToken(e.target.value)}
                placeholder="Token rahasia webhook Meta Cloud"
                className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-pink-500"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleSaveWabaConfig}
              disabled={savingProvider}
              className="px-4 py-2 bg-pink-500 hover:bg-pink-600 text-white rounded-xl text-xs font-bold transition flex items-center space-x-2 disabled:opacity-50"
            >
              <span>{savingProvider ? 'Menyimpan...' : 'Simpan Kredensial WABA'}</span>
            </button>
          </div>

          {/* Pemetaan Template HSM */}
          <div className="space-y-3 pt-2">
            <h4 className="text-xs font-bold text-white flex items-center space-x-2">
              <FileCheck size={12} className="text-pink-400" />
              <span>Pemetaan Template HSM Meta</span>
            </h4>
            <div className="space-y-2">
              {wabaTemplates.map((tmpl) => (
                <div key={`${tmpl.type}_${tmpl.variant}`} className="p-3 rounded-xl bg-slate-950 border border-white/5 flex items-center justify-between">
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-bold text-white">{tmpl.type} (Variant {tmpl.variant})</span>
                      <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${tmpl.status === 'APPROVED' ? 'bg-emerald-500/20 text-emerald-300' : tmpl.status === 'REJECTED' ? 'bg-rose-500/20 text-rose-300' : 'bg-amber-500/20 text-amber-300'}`}>
                        {tmpl.status}
                      </span>
                    </div>
                  </div>
                  <input
                    type="text"
                    defaultValue={tmpl.templateName}
                    onBlur={(e) => handleSaveWabaTemplate(tmpl.type, tmpl.variant, e.target.value)}
                    className="bg-slate-900 border border-white/10 rounded-lg px-2.5 py-1 text-xs text-white placeholder-slate-600 w-64 focus:outline-none focus:border-pink-500"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
