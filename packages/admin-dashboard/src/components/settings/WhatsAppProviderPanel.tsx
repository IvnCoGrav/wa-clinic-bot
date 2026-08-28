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
  ShieldAlert,
  ZapOff,
  Zap,
  FileCheck,
  FileClock,
  FileX
} from 'lucide-react';
import { ToggleSwitch } from '../common/ToggleSwitch';

interface Props {
  provider: 'WAHA' | 'WABA';
  providerTab: 'WAHA' | 'WABA';
  setProviderTab: (tab: 'WAHA' | 'WABA') => void;
  savingProvider: boolean;
  handleToggleProvider: (p: 'WAHA' | 'WABA') => void;
  loadWhatsAppProvider: () => void;
  wahaStatus: string;
  wahaSessionId: string;
  wahaOutboundCutoff?: boolean;
  togglingCutoff?: boolean;
  handleToggleOutboundCutoff?: (val: boolean) => void;
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
  wahaOutboundCutoff = false,
  togglingCutoff = false,
  handleToggleOutboundCutoff,
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
    <div className="bg-white border border-[#e9edef] rounded-2xl p-5 space-y-4 shadow-xs">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-bold text-[#111b21] flex items-center space-x-2">
          <MessageCircle className="text-[#008069]" size={16} />
          <span>WhatsApp Gateway</span>
        </h3>
        <button
          onClick={loadWhatsAppProvider}
          className="px-3 py-1.5 bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] rounded-lg text-xs font-semibold text-[#111b21] flex items-center space-x-1 shadow-xs"
        >
          <RefreshCw size={11} className="text-[#667781]" />
          <span>Refresh</span>
        </button>
      </div>

      {/* Channel aktif + toggle */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3.5 rounded-xl bg-[#f8fafc] border border-[#e9edef] gap-3">
        <div className="flex items-center space-x-2.5">
          <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${provider === 'WABA' ? 'bg-sky-50 text-sky-800 border border-sky-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200'}`}>
            {provider === 'WABA' ? 'Meta Cloud API v25.0' : 'WAHA Self-Hosted'}
          </span>
          <p className="text-xs text-[#667781]">Channel outbound aktif untuk follow-up &amp; reminder. Safety net default WAHA.</p>
        </div>
        <div className="flex space-x-1.5">
          <button
            onClick={() => handleToggleProvider('WAHA')}
            disabled={savingProvider || provider === 'WAHA'}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition shadow-xs ${provider === 'WAHA' ? 'bg-[#008069] text-white' : 'bg-white border border-[#d1d7db] text-[#54656f] hover:bg-[#f0f2f5]'}`}
          >
            WAHA
          </button>
          <button
            onClick={() => handleToggleProvider('WABA')}
            disabled={savingProvider || provider === 'WABA'}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition shadow-xs ${provider === 'WABA' ? 'bg-[#008069] text-white' : 'bg-white border border-[#d1d7db] text-[#54656f] hover:bg-[#f0f2f5]'}`}
          >
            WABA
          </button>
        </div>
      </div>

      {/* Sub-tab WAHA / WABA */}
      <div className="flex space-x-1 p-1 rounded-xl bg-[#f0f2f5] border border-[#e9edef] w-fit">
        <button
          onClick={() => setProviderTab('WAHA')}
          className={`px-3.5 py-1 rounded-lg text-xs font-bold transition flex items-center space-x-1.5 ${providerTab === 'WAHA' ? 'bg-[#008069] text-white shadow-xs' : 'text-[#54656f] hover:text-[#111b21]'}`}
        >
          <MessageCircle size={12} />
          <span>WAHA</span>
        </button>
        <button
          onClick={() => setProviderTab('WABA')}
          className={`px-3.5 py-1 rounded-lg text-xs font-bold transition flex items-center space-x-1.5 ${providerTab === 'WABA' ? 'bg-[#008069] text-white shadow-xs' : 'text-[#54656f] hover:text-[#111b21]'}`}
        >
          <MessageCircle size={12} />
          <span>WABA</span>
        </button>
      </div>

      {/* Tab WAHA */}
      {providerTab === 'WAHA' && (
        <div className="space-y-3 p-4 rounded-xl bg-[#f8fafc] border border-[#e9edef]">
          <h4 className="text-xs font-bold text-[#008069] flex items-center space-x-1.5">
            <MessageCircle size={13} />
            <span>WAHA Session (Self-Hosted)</span>
          </h4>
          <p className="text-xs text-[#667781] leading-relaxed">
            Gateway WhatsApp self-hosted via WAHA. Kirim teks bebas (tidak terikat HSM template Meta), cocok untuk percakapan dalam 24h window.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="p-3 rounded-xl bg-white border border-[#e9edef] shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-bold text-[#667781]">Status Session</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${wahaStatus === 'WORKING' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : 'bg-amber-100 text-amber-800 border border-amber-200'}`}>
                  {wahaStatus}
                </span>
              </div>
              <p className="text-xs text-[#54656f] mt-1">{wahaStatus === 'WORKING' ? 'Session terhubung' : 'Cek dashboard WAHA — mungkin butuh re-scan QR'}</p>
            </div>
            <div className="p-3 rounded-xl bg-white border border-[#e9edef] shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-bold text-[#667781]">Session ID</span>
                <span className="text-xs font-mono font-semibold text-[#111b21]">{wahaSessionId}</span>
              </div>
              <p className="text-xs text-[#54656f] mt-1">WAHA dashboard: <span className="text-[#111b21] font-mono">port 3001</span></p>
            </div>
          </div>

          {/* Internal Outbound Cut-Off (Emergency Kill-Switch) */}
          <div className={`p-4 rounded-xl border transition shadow-xs space-y-3 ${
            wahaOutboundCutoff
              ? 'bg-rose-50/80 border-rose-200'
              : 'bg-white border-[#e9edef]'
          }`}>
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="space-y-0.5">
                <h4 className="text-xs font-bold text-[#111b21] flex items-center space-x-1.5">
                  {wahaOutboundCutoff ? (
                    <ShieldAlert size={14} className="text-rose-600" />
                  ) : (
                    <ShieldCheck size={14} className="text-[#008069]" />
                  )}
                  <span>Internal Outbound Cut-Off (Emergency Kill-Switch)</span>
                </h4>
                <p className="text-[11px] text-[#667781] leading-relaxed">
                  {wahaOutboundCutoff
                    ? 'Pengiriman pesan bot keluar ke WAHA sedang DIPUTUS secara internal. Sesi WhatsApp di HP tetap login dan aman (tanpa perlu scan QR ulang).'
                    : 'Koneksi aliran pesan bot ke WAHA normal. Putuskan darurat jika ingin menahan semua pengiriman pesan keluar seketika.'}
                </p>
              </div>

              <div className="flex items-center gap-3 flex-shrink-0">
                {handleToggleOutboundCutoff && (
                  <ToggleSwitch
                    checked={wahaOutboundCutoff}
                    onChange={(next) => handleToggleOutboundCutoff(next)}
                    disabled={togglingCutoff}
                    loading={togglingCutoff}
                    variant="rose"
                    onLabel="CUT-OFF AKTIF (TERPUTUS)"
                    offLabel="NORMAL (TERHUBUNG)"
                    size="md"
                    title="Toggle Internal Outbound Cut-Off"
                  />
                )}
              </div>
            </div>
          </div>

          {/* Konek WhatsApp via QR */}
          <div className="space-y-3 p-4 rounded-xl bg-white border border-[#e9edef] shadow-xs">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
              <h4 className="text-xs font-bold text-[#008069] flex items-center space-x-1.5">
                <QrCode size={13} />
                <span>Koneksi WhatsApp (Scan QR)</span>
              </h4>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  onClick={loadQr}
                  disabled={loadingQr}
                  className="px-2.5 py-1 rounded-lg bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-xs font-semibold text-[#111b21] flex items-center space-x-1 disabled:opacity-50 shadow-xs"
                >
                  <RefreshCw size={11} className={loadingQr ? 'animate-spin text-[#008069]' : 'text-[#667781]'} />
                  <span>Segarkan</span>
                </button>

                <button
                  onClick={handleDisconnectSession}
                  disabled={disconnectingSession || resettingSession || startingSession}
                  className="px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 text-xs font-semibold flex items-center space-x-1 disabled:opacity-50 shadow-xs"
                  title="Putuskan koneksi WAHA (Logout / Stop Session)"
                >
                  <Power size={11} />
                  <span>{disconnectingSession ? 'Memutuskan...' : 'Putuskan Koneksi'}</span>
                </button>
                {canStartSession && (
                  <button
                    onClick={canResetSession ? handleResetSession : handleStartSession}
                    disabled={resettingSession || startingSession}
                    className={`px-2.5 py-1 rounded-lg text-white text-xs font-semibold flex items-center space-x-1 disabled:opacity-50 shadow-xs ${
                      canResetSession ? 'bg-rose-600 hover:bg-rose-700' : 'bg-[#008069] hover:bg-[#00a884]'
                    }`}
                  >
                    <Play size={11} fill="currentColor" />
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
                <RefreshCw size={20} className="animate-spin text-[#008069]" />
              </div>
            ) : qrData && qrStatus === 'SCAN_QR_CODE' ? (
              <div className="flex flex-col items-center gap-3 p-4 bg-[#f8fafc] rounded-xl border border-[#e9edef]">
                <div className="p-3 bg-white rounded-xl border border-[#d1d7db] shadow-xs">
                  <img
                    src={`data:${qrData.mimetype};base64,${qrData.data}`}
                    alt="QR WhatsApp Session"
                    className="w-64 h-64"
                  />
                </div>
                <p className="text-xs text-[#667781] text-center leading-relaxed">
                  Pindai dengan <span className="text-[#008069] font-bold">WhatsApp &gt; Setelan &gt; Perangkat Tertaut &gt; Tautkan Perangkat</span>.
                </p>
              </div>
            ) : qrStatus === 'WORKING' ? (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs">
                <Check size={14} className="text-emerald-600" />
                <span>Session terhubung — WhatsApp aktif. QR tidak diperlukan.</span>
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs leading-relaxed">
                <div className="flex items-start space-x-2">
                  <AlertTriangle size={13} className="mt-0.5 flex-shrink-0 text-amber-600" />
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
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-[#f8fafc] border border-[#e9edef]">
            <div>
              <h4 className="text-xs font-bold text-[#111b21] flex items-center space-x-1.5">
                <MessageCircle size={13} className="text-[#008069]" />
                <span>WABA (Meta Cloud API)</span>
              </h4>
              <p className="text-xs text-[#667781] mt-0.5 leading-relaxed">
                Outbound wajib memakai <span className="text-[#008069] font-semibold">HSM template</span>. Kredensial disimpan terenkripsi AES-256.
              </p>
            </div>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${wabaConfigured ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : 'bg-slate-100 text-slate-700 border border-slate-200'}`}>
              {wabaConfigured ? 'Terorganisasi' : 'Belum Dikonfigurasi'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-[#111b21] flex items-center space-x-1">
                <KeyRound size={11} className="text-[#008069]" />
                <span>Phone Number ID</span>
              </label>
              <input
                type="text"
                value={wabaPhoneNumberId}
                onChange={(e) => setWabaPhoneNumberId(e.target.value)}
                placeholder="100982736451234"
                className="w-full bg-white border border-[#d1d7db] rounded-xl px-3 py-2 text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069] shadow-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-[#111b21] flex items-center space-x-1">
                <KeyRound size={11} className="text-[#008069]" />
                <span>Business Account ID</span>
              </label>
              <input
                type="text"
                value={wabaBusinessAccountId}
                onChange={(e) => setWabaBusinessAccountId(e.target.value)}
                placeholder="200192837465123"
                className="w-full bg-white border border-[#d1d7db] rounded-xl px-3 py-2 text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069] shadow-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-[#111b21] flex items-center space-x-1">
                <ShieldCheck size={11} className="text-[#008069]" />
                <span>Access Token (Permanent / System User)</span>
              </label>
              <input
                type="password"
                value={wabaAccessToken}
                onChange={(e) => setWabaAccessToken(e.target.value)}
                placeholder={wabaConfigured ? '•••••••• (kosongkan bila tidak diubah)' : 'EAA... System User Token'}
                className="w-full bg-white border border-[#d1d7db] rounded-xl px-3 py-2 text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069] shadow-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-[#111b21] flex items-center space-x-1">
                <ShieldCheck size={11} className="text-[#008069]" />
                <span>Webhook Verify Token</span>
              </label>
              <input
                type="text"
                value={wabaWebhookVerifyToken}
                onChange={(e) => setWabaWebhookVerifyToken(e.target.value)}
                placeholder="Token rahasia webhook Meta Cloud"
                className="w-full bg-white border border-[#d1d7db] rounded-xl px-3 py-2 text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069] shadow-xs"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleSaveWabaConfig}
              disabled={savingProvider}
              className="px-4 py-2 bg-[#008069] hover:bg-[#00a884] text-white rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 disabled:opacity-50 shadow-xs"
            >
              <span>{savingProvider ? 'Menyimpan...' : 'Simpan Kredensial WABA'}</span>
            </button>
          </div>

          {/* Pemetaan Template HSM */}
          <div className="space-y-3 pt-2 border-t border-[#e9edef]">
            <h4 className="text-xs font-bold text-[#111b21] flex items-center space-x-1.5">
              <FileCheck size={13} className="text-[#008069]" />
              <span>Pemetaan Template HSM Meta</span>
            </h4>
            <div className="space-y-2">
              {wabaTemplates.map((tmpl) => (
                <div key={`${tmpl.type}_${tmpl.variant}`} className="p-3.5 rounded-xl bg-white border border-[#e9edef] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shadow-xs">
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-bold text-[#111b21]">{tmpl.type} (Variant {tmpl.variant})</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${tmpl.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : tmpl.status === 'REJECTED' ? 'bg-rose-100 text-rose-800 border border-rose-200' : 'bg-amber-100 text-amber-800 border border-amber-200'}`}>
                        {tmpl.status}
                      </span>
                    </div>
                  </div>
                  <input
                    type="text"
                    defaultValue={tmpl.templateName}
                    onBlur={(e) => handleSaveWabaTemplate(tmpl.type, tmpl.variant, e.target.value)}
                    className="bg-white border border-[#d1d7db] rounded-xl px-3 py-1.5 text-xs text-[#111b21] placeholder-[#8696a0] w-full sm:w-64 focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069] shadow-xs"
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
