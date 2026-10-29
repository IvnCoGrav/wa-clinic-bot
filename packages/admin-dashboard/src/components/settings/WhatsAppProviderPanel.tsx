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
    <div className="bg-surface border border-divider rounded-2xl p-5 space-y-4 shadow-xs">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-bold text-ink flex items-center space-x-2">
          <MessageCircle className="text-accent" size={16} />
          <span>WhatsApp Gateway</span>
        </h3>
        <button
          onClick={loadWhatsAppProvider}
          className="px-3 py-1.5 bg-surface hover:bg-fill-1 border border-divider rounded-lg text-xs font-semibold text-ink flex items-center space-x-1 shadow-xs"
        >
          <RefreshCw size={11} className="text-ink-3" />
          <span>Refresh</span>
        </button>
      </div>

      {/* Channel aktif + toggle */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3.5 rounded-xl bg-surface-2 border border-divider gap-3">
        <div className="flex items-center space-x-2.5">
          <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${provider === 'WABA' ? 'bg-sky-50 dark:bg-sky-950/40 text-sky-800 dark:text-info border border-sky-200 dark:border-sky-800' : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-accent border border-emerald-200 dark:border-emerald-800'}`}>
            {provider === 'WABA' ? 'Meta Cloud API v25.0' : 'WAHA Self-Hosted'}
          </span>
          <p className="text-xs text-ink-3">Channel outbound aktif untuk follow-up &amp; reminder. Safety net default WAHA.</p>
        </div>
        <div className="flex space-x-1.5">
          <button
            onClick={() => handleToggleProvider('WAHA')}
            disabled={savingProvider || provider === 'WAHA'}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition shadow-xs ${provider === 'WAHA' ? 'bg-accent text-accent-ink' : 'bg-surface border border-divider text-ink-2 hover:bg-fill-1'}`}
          >
            WAHA
          </button>
          <button
            onClick={() => handleToggleProvider('WABA')}
            disabled={savingProvider || provider === 'WABA'}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition shadow-xs ${provider === 'WABA' ? 'bg-accent text-accent-ink' : 'bg-surface border border-divider text-ink-2 hover:bg-fill-1'}`}
          >
            WABA
          </button>
        </div>
      </div>

      {/* Sub-tab WAHA / WABA */}
      <div className="flex space-x-1 p-1 rounded-xl bg-fill-1 dark:bg-surface border border-divider w-fit">
        <button
          onClick={() => setProviderTab('WAHA')}
          className={`px-3.5 py-1 rounded-lg text-xs font-bold transition flex items-center space-x-1.5 ${providerTab === 'WAHA' ? 'bg-accent text-accent-ink shadow-xs' : 'text-ink-2 hover:text-ink dark:hover:text-ink'}`}
        >
          <MessageCircle size={12} />
          <span>WAHA</span>
        </button>
        <button
          onClick={() => setProviderTab('WABA')}
          className={`px-3.5 py-1 rounded-lg text-xs font-bold transition flex items-center space-x-1.5 ${providerTab === 'WABA' ? 'bg-accent text-accent-ink shadow-xs' : 'text-ink-2 hover:text-ink dark:hover:text-ink'}`}
        >
          <MessageCircle size={12} />
          <span>WABA</span>
        </button>
      </div>

      {/* Tab WAHA */}
      {providerTab === 'WAHA' && (
        <div className="space-y-3 p-4 rounded-xl bg-surface-2 border border-divider">
          <h4 className="text-xs font-bold text-accent flex items-center space-x-1.5">
            <MessageCircle size={13} />
            <span>WAHA Session (Self-Hosted)</span>
          </h4>
          <p className="text-xs text-ink-3 leading-relaxed">
            Gateway WhatsApp self-hosted via WAHA. Kirim teks bebas (tidak terikat HSM template Meta), cocok untuk percakapan dalam 24h window.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="p-3 rounded-xl bg-surface border border-divider shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-bold text-ink-3">Status Session</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${wahaStatus === 'WORKING' ? 'bg-success-soft text-success border border-success-line' : 'bg-warning-soft text-warning border border-warning-line'}`}>
                  {wahaStatus}
                </span>
              </div>
              <p className="text-xs text-ink-2 mt-1">{wahaStatus === 'WORKING' ? 'Session terhubung' : 'Cek dashboard WAHA — mungkin butuh re-scan QR'}</p>
            </div>
            <div className="p-3 rounded-xl bg-surface border border-divider shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-bold text-ink-3">Session ID</span>
                <span className="text-xs font-mono font-semibold text-ink">{wahaSessionId}</span>
              </div>
              <p className="text-xs text-ink-2 mt-1">WAHA dashboard: <span className="text-ink font-mono">port 3001</span></p>
            </div>
          </div>

          {/* Internal Outbound Cut-Off (Emergency Kill-Switch) */}
          <div className={`p-4 rounded-xl border transition shadow-xs space-y-3 ${
            wahaOutboundCutoff
              ? 'bg-danger-soft/80 border-danger-line'
              : 'bg-surface border-divider'
          }`}>
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="space-y-0.5">
                <h4 className="text-xs font-bold text-ink flex items-center space-x-1.5">
                  {wahaOutboundCutoff ? (
                    <ShieldAlert size={14} className="text-danger" />
                  ) : (
                    <ShieldCheck size={14} className="text-accent" />
                  )}
                  <span>Internal Outbound Cut-Off (Emergency Kill-Switch)</span>
                </h4>
                <p className="text-[11px] text-ink-3 leading-relaxed">
                  {wahaOutboundCutoff
                    ? 'SEMUA pesan keluar sistem (Bot AI, Follow-Up, Reminder, Broadcast, & Live Chat) sedang DINONAKTIFKAN TOTAL. Sesi WhatsApp di HP tetap login dan aman.'
                    : 'Koneksi aliran pesan sistem normal. Aktifkan Cut-Off Darurat jika ingin mematikan seluruh pesan keluar sistem seketika.'}
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
          <div className="space-y-3 p-4 rounded-xl bg-surface border border-divider shadow-xs">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
              <h4 className="text-xs font-bold text-accent flex items-center space-x-1.5">
                <QrCode size={13} />
                <span>Koneksi WhatsApp (Scan QR)</span>
              </h4>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  onClick={loadQr}
                  disabled={loadingQr}
                  className="px-2.5 py-1 rounded-lg bg-surface hover:bg-fill-1 border border-divider text-xs font-semibold text-ink flex items-center space-x-1 disabled:opacity-50 shadow-xs"
                >
                  <RefreshCw size={11} className={loadingQr ? 'animate-spin text-accent' : 'text-ink-3'} />
                  <span>Segarkan</span>
                </button>

                <button
                  onClick={handleDisconnectSession}
                  disabled={disconnectingSession || resettingSession || startingSession}
                  className="px-2.5 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/30 hover:bg-rose-100 dark:hover:bg-rose-900/40 border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-danger text-xs font-semibold flex items-center space-x-1 disabled:opacity-50 shadow-xs"
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
                      canResetSession ? 'bg-danger hover:bg-danger-hover' : 'bg-accent hover:bg-accent'
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
                <RefreshCw size={20} className="animate-spin text-accent" />
              </div>
            ) : qrData && qrStatus === 'SCAN_QR_CODE' ? (
              <div className="flex flex-col items-center gap-3 p-4 bg-surface-2 rounded-xl border border-divider">
                <div className="p-3 bg-surface rounded-xl border border-divider shadow-xs">
                  <img
                    src={`data:${qrData.mimetype};base64,${qrData.data}`}
                    alt="QR WhatsApp Session"
                    className="w-64 h-64"
                  />
                </div>
                <p className="text-xs text-ink-3 text-center leading-relaxed">
                  Pindai dengan <span className="text-accent font-bold">WhatsApp &gt; Setelan &gt; Perangkat Tertaut &gt; Tautkan Perangkat</span>.
                </p>
              </div>
            ) : qrStatus === 'WORKING' ? (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-success-soft border border-success-line text-success text-xs">
                <Check size={14} className="text-success" />
                <span>Session terhubung — WhatsApp aktif. QR tidak diperlukan.</span>
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-amber-800 dark:text-amber-200 text-xs leading-relaxed">
                <div className="flex items-start space-x-2">
                  <AlertTriangle size={13} className="mt-0.5 flex-shrink-0 text-warning" />
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
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-surface-2 border border-divider">
            <div>
              <h4 className="text-xs font-bold text-ink flex items-center space-x-1.5">
                <MessageCircle size={13} className="text-accent" />
                <span>WABA (Meta Cloud API)</span>
              </h4>
              <p className="text-xs text-ink-3 mt-0.5 leading-relaxed">
                Outbound wajib memakai <span className="text-accent font-semibold">HSM template</span>. Kredensial disimpan terenkripsi AES-256.
              </p>
            </div>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${wabaConfigured ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-accent border border-emerald-200 dark:border-emerald-800' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700'}`}>
              {wabaConfigured ? 'Terorganisasi' : 'Belum Dikonfigurasi'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-ink flex items-center space-x-1">
                <KeyRound size={11} className="text-accent" />
                <span>Phone Number ID</span>
              </label>
              <input
                type="text"
                value={wabaPhoneNumberId}
                onChange={(e) => setWabaPhoneNumberId(e.target.value)}
                placeholder="100982736451234"
                className="w-full bg-surface border border-divider rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-3 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent shadow-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-ink flex items-center space-x-1">
                <KeyRound size={11} className="text-accent" />
                <span>Business Account ID</span>
              </label>
              <input
                type="text"
                value={wabaBusinessAccountId}
                onChange={(e) => setWabaBusinessAccountId(e.target.value)}
                placeholder="200192837465123"
                className="w-full bg-surface border border-divider rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-3 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent shadow-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-ink flex items-center space-x-1">
                <ShieldCheck size={11} className="text-accent" />
                <span>Access Token (Permanent / System User)</span>
              </label>
              <input
                type="password"
                value={wabaAccessToken}
                onChange={(e) => setWabaAccessToken(e.target.value)}
                placeholder={wabaConfigured ? '•••••••• (kosongkan bila tidak diubah)' : 'EAA... System User Token'}
                className="w-full bg-surface border border-divider rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-3 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent shadow-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-ink flex items-center space-x-1">
                <ShieldCheck size={11} className="text-accent" />
                <span>Webhook Verify Token</span>
              </label>
              <input
                type="text"
                value={wabaWebhookVerifyToken}
                onChange={(e) => setWabaWebhookVerifyToken(e.target.value)}
                placeholder="Token rahasia webhook Meta Cloud"
                className="w-full bg-surface border border-divider rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-3 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent shadow-xs"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleSaveWabaConfig}
              disabled={savingProvider}
              className="px-4 py-2 bg-accent hover:bg-accent-hover text-accent-ink rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 disabled:opacity-50 shadow-xs"
            >
              <span>{savingProvider ? 'Menyimpan...' : 'Simpan Kredensial WABA'}</span>
            </button>
          </div>

          {/* Pemetaan Template HSM */}
          <div className="space-y-3 pt-2 border-t border-divider">
            <h4 className="text-xs font-bold text-ink flex items-center space-x-1.5">
              <FileCheck size={13} className="text-accent" />
              <span>Pemetaan Template HSM Meta</span>
            </h4>
            <div className="space-y-2">
              {wabaTemplates.map((tmpl) => (
                <div key={`${tmpl.type}_${tmpl.variant}`} className="p-3.5 rounded-xl bg-surface border border-divider flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shadow-xs">
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-bold text-ink">{tmpl.type} (Variant {tmpl.variant})</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${tmpl.status === 'APPROVED' ? 'bg-success-soft text-success border border-success-line' : tmpl.status === 'REJECTED' ? 'bg-danger-soft text-danger border border-danger-line' : 'bg-warning-soft text-warning border border-warning-line'}`}>
                        {tmpl.status}
                      </span>
                    </div>
                  </div>
                  <input
                    type="text"
                    defaultValue={tmpl.templateName}
                    onBlur={(e) => handleSaveWabaTemplate(tmpl.type, tmpl.variant, e.target.value)}
                    className="bg-surface border border-divider rounded-xl px-3 py-1.5 text-xs text-ink placeholder:text-ink-3 w-full sm:w-64 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent shadow-xs"
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
