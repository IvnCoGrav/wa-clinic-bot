import React, { useState } from 'react';
import { useUiFeedback } from '../common/UiFeedback';
import {
  X,
  Copy,
  Check,
  Code,
  Info,
  Link2,
  Smartphone,
  MousePointerClick,
  ShieldCheck,
  AlertTriangle,
  ArrowRight,
  Braces,
} from 'lucide-react';

interface ExternalIntegrationModalProps {
  open: boolean;
  onClose: () => void;
}

function SnippetBlock({ title, code }: { title: string; code: string }) {
  const { toast } = useUiFeedback();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // Fallback untuk browser/konteks tanpa Clipboard API (mis. http non-localhost)
      try {
        const ta = document.createElement('textarea');
        ta.value = code;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {
        toast('Gagal menyalin kode.', 'error');
        return;
      }
    }
    setCopied(true);
    toast(`${title} disalin ke clipboard!`, 'success');
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="glass-panel border border-white/5 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/5 bg-slate-900/40">
        <span className="text-[9px] uppercase font-black text-slate-400 flex items-center gap-2">
          <Braces size={12} className="text-pink-400" />
          {title}
        </span>
        <button
          onClick={handleCopy}
          className={`flex items-center gap-1 text-[9px] font-bold px-2 py-1 rounded-lg border transition ${
            copied
              ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10'
              : 'text-slate-300 border-white/10 bg-white/5 hover:bg-pink-500/10 hover:text-pink-300'
          }`}
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? 'Tersalin!' : 'Salin'}
        </button>
      </div>
      <pre className="p-4 text-[10px] leading-relaxed font-mono text-slate-300 bg-slate-950/70 overflow-x-auto whitespace-pre-wrap break-all">
        {code}
      </pre>
    </div>
  );
}

const PARAM_GROUPS: { group: string; params: string[] }[] = [
  { group: 'Meta / Facebook & Instagram', params: ['fbclid', 'fbp', 'fbc'] },
  { group: 'Google Ads', params: ['gclid', 'gclsrc', 'wbraid', 'gbraid'] },
  { group: 'Microsoft / Bing Ads', params: ['msclkid'] },
  { group: 'TikTok Ads', params: ['ttclid'] },
  { group: 'UTM standar', params: ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id'] },
  { group: 'Lainnya', params: ['igshid'] },
];

export const ExternalIntegrationModal: React.FC<ExternalIntegrationModalProps> = ({ open, onClose }) => {
  const { toast } = useUiFeedback();
  const [copiedMain, setCopiedMain] = useState(false);

  if (!open) return null;

  const origin = window.location.origin.replace(/\/$/, '');
  const scriptSnippet = `<script src="${origin}/assets/external-tracker.js" defer></script>`;
  const ctaSnippet = `${origin}/cta?slug=SLUG_ANDA`;

  const handleCopyMain = async () => {
    try {
      await navigator.clipboard.writeText(scriptSnippet);
    } catch {
      toast('Gagal menyalin kode.', 'error');
      return;
    }
    setCopiedMain(true);
    toast('Script embed disalin ke clipboard!', 'success');
    setTimeout(() => setCopiedMain(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
      <div className="glass-panel border border-white/10 rounded-2xl w-full max-w-3xl overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-white/5 flex justify-between items-center bg-slate-900/50">
          <div>
            <h3 className="font-bold text-white text-sm flex items-center gap-2">
              <Link2 className="text-pink-400" size={16} />
              Integrasi Landing Page Eksternal
            </h3>
            <p className="text-[10px] text-slate-500 mt-0.5">
              Skema 2 (URL Redirect) — hubungkan Landing Page luar ke atribusi &amp; WhatsApp bot.
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition" aria-label="Tutup">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
          {/* Alur singkat */}
          <div className="space-y-2">
            <p className="text-[9px] uppercase font-black text-slate-500 tracking-wider">Cara kerja</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              {[
                { icon: <Link2 size={14} />, txt: 'Ganti tombol CTA ke /cta?slug=...' },
                { icon: <Code size={14} />, txt: 'Tanam satu baris script embed' },
                { icon: <MousePointerClick size={14} />, txt: 'Atribusi iklan tertangkap otomatis' },
                { icon: <Smartphone size={14} />, txt: 'Redirect WA + trackingCode tercatat' },
              ].map((s, i) => (
                <div key={i} className="glass-panel border border-white/5 rounded-xl px-3 py-2.5 flex items-start gap-2">
                  <span className="text-pink-400 flex-shrink-0 mt-0.5">{s.icon}</span>
                  <div>
                    <div className="text-[8px] text-slate-600 font-black">LANGKAH {i + 1}</div>
                    <div className="text-[10px] text-slate-300 leading-snug">{s.txt}</div>
                  </div>
                  {i < 3 && <ArrowRight size={12} className="text-slate-600 hidden lg:block ml-auto mt-1" />}
                </div>
              ))}
            </div>
          </div>

          {/* Snippet utama */}
          <div className="space-y-2">
            <p className="text-[11px] uppercase font-black text-slate-500 tracking-wider">Script embed (satu baris)</p>
            <div className="glass-panel border border-white/5 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/5 bg-slate-900/40">
                <span className="text-[9px] uppercase font-black text-slate-400 flex items-center gap-2">
                  <Code size={12} className="text-pink-400" />
                  Pasang di <b>&lt;/body&gt;</b> Landing Page Eksternal
                </span>
                <button
                  onClick={handleCopyMain}
                  className={`flex items-center gap-1 text-[9px] font-bold px-2 py-1 rounded-lg border transition ${
                    copiedMain
                      ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10'
                      : 'text-slate-300 border-white/10 bg-white/5 hover:bg-pink-500/10 hover:text-pink-300'
                  }`}
                >
                  {copiedMain ? <Check size={11} /> : <Copy size={11} />}
                  {copiedMain ? 'Tersalin!' : 'Salin'}
                </button>
              </div>
              <pre className="p-4 text-[10px] leading-relaxed font-mono text-emerald-300 bg-slate-950/70 overflow-x-auto whitespace-pre-wrap break-all">
                {scriptSnippet}
              </pre>
            </div>
            <p className="text-[9px] text-slate-500 flex items-start gap-1.5">
              <Info size={11} className="text-pink-400 flex-shrink-0 mt-0.5" />
              Domain diambil otomatis dari dashboard ini. Tombol CTA Anda harus dimulai dengan{' '}
              <code className="text-pink-400 font-mono">{ctaSnippet}</code> agar di-link ke atribusi bot.
            </p>
          </div>

          {/* Contoh link CTA */}
          <div className="space-y-2">
            <p className="text-[11px] uppercase font-black text-slate-500 tracking-wider">Contoh link tombol CTA</p>
            <SnippetBlock
              title="HTML link CTA + script embed"
              code={`<a href="${ctaSnippet}" class="btn-cta">Chat WhatsApp Sekarang</a>\n\n<script src="${origin}/assets/external-tracker.js" defer></script>`}
            />
          </div>

          {/* Per platform */}
          <div className="space-y-2">
            <p className="text-[11px] uppercase font-black text-slate-500 tracking-wider">Petunjuk per platform</p>
            <div className="space-y-3">
              <SnippetBlock
                title="Landing statis / HTML polos"
                code={`<!-- 1. Tombol CTA -->\n<a href="${ctaSnippet}" class="btn-cta">Chat WhatsApp</a>\n\n<!-- 2. Script embed -->\n${scriptSnippet}`}
              />
              <SnippetBlock
                title="Elementor / WordPress"
                code={`1) Widget Button → Link: ${ctaSnippet}\n2) Theme Builder → Footer → widget HTML:\n   ${scriptSnippet}`}
              />
              <SnippetBlock
                title="WordPress (functions.php)"
                code={`add_action('wp_footer', function () {\n    echo '${scriptSnippet}';\n});`}
              />
            </div>
          </div>

          {/* Tabel whitelist */}
          <div className="space-y-3">
            <p className="text-[11px] uppercase font-black text-slate-500 tracking-wider">
              Parameter atribusi yang disalin otomatis
            </p>
            <div className="glass-panel border border-white/5 rounded-xl overflow-hidden">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-white/5 bg-slate-900/40">
                    <th className="px-4 py-2.5 text-[9px] uppercase font-black text-slate-500">Kategori</th>
                    <th className="px-4 py-2.5 text-[9px] uppercase font-black text-slate-500">Param</th>
                  </tr>
                </thead>
                <tbody>
                  {PARAM_GROUPS.map((row, i) => (
                    <tr key={i} className="border-b border-white/5 last:border-0">
                      <td className="px-4 py-2.5 text-[10px] text-slate-400">{row.group}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {row.params.map((p) => (
                            <span
                              key={p}
                              className="px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20 text-[9px] font-mono font-bold"
                            >
                              {p}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[9px] text-slate-500 flex items-start gap-1.5">
              <AlertTriangle size={11} className="text-amber-400 flex-shrink-0 mt-0.5" />
              Param sistem bot (<b>slug</b>, p, phone, msg, greetings) sengaja TIDAK ikut disalin dan tidak pernah ditimpa.
              Cookie <code className="text-slate-400 font-mono">_fbp/_fbc</code> bersifat per-domain — jika ingin dedup penuh, sertakan
              <code className="text-slate-400 font-mono"> ?fbp=&amp;fbc=</code> di URL LP.
            </p>
          </div>

          {/* Keamanan */}
          <div className="space-y-2">
            <p className="text-[11px] uppercase font-black text-slate-500 tracking-wider">Keamanan</p>
            <div className="glass-panel border border-amber-500/20 bg-amber-500/[0.03] rounded-xl px-4 py-3 space-y-2">
              <div className="flex items-center gap-2 text-[10px] font-bold text-amber-300">
                <ShieldCheck size={14} />
                <span>Script jembatan bersifat read-only &amp; fail-open</span>
              </div>
              <ul className="space-y-1.5 text-[10px] text-slate-400 list-none">
                <li className="flex items-start gap-1.5">
                  <Info size={11} className="text-amber-400 flex-shrink-0 mt-0.5" />
                  Hanya menambah query string pada link ber-path <code className="text-pink-400 font-mono">/cta</code>. Link lain tidak diubah.
                </li>
                <li className="flex items-start gap-1.5">
                  <Info size={11} className="text-amber-400 flex-shrink-0 mt-0.5" />
                  Error apa pun di-swallow: tombol CTA tetap berfungsi normal.
                </li>
                <li className="flex items-start gap-1.5">
                  <Info size={11} className="text-amber-400 flex-shrink-0 mt-0.5" />
                  Nomor WhatsApp selalu diambil dari pengaturan Tenant — param <code className="text-pink-400 font-mono">phone</code> di
                  URL di-ignore untuk mencegah penyalahgunaan.
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-white/5 flex justify-end bg-slate-900/50">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-white/5 hover:bg-white/10 text-slate-300 rounded-xl text-xs font-bold transition flex items-center gap-1.5"
          >
            <X size={14} />
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
};