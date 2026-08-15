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
      // Fallback untuk browser/konteks tanpa Clipboard API
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
    <div className="bg-white border border-[#e9edef] rounded-xl overflow-hidden shadow-xs">
      <div className="flex items-center justify-between px-3.5 py-2 border-b border-[#e9edef] bg-[#f8fafc]">
        <span className="text-[11px] uppercase font-bold text-[#111b21] flex items-center gap-1.5">
          <Braces size={12} className="text-[#008069]" />
          {title}
        </span>
        <button
          onClick={handleCopy}
          className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg border transition shadow-xs ${
            copied
              ? 'text-emerald-800 border-emerald-300 bg-emerald-100'
              : 'text-[#111b21] border-[#d1d7db] bg-white hover:bg-[#f0f2f5]'
          }`}
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? 'Tersalin!' : 'Salin'}
        </button>
      </div>
      <pre className="p-3.5 text-xs leading-relaxed font-mono text-[#008069] bg-[#f8fafc] overflow-x-auto whitespace-pre-wrap break-all">
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="bg-white border border-[#e9edef] rounded-2xl w-full max-w-3xl overflow-hidden flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-[#e9edef] flex justify-between items-center bg-[#f8fafc]">
          <div>
            <h3 className="font-bold text-[#111b21] text-sm flex items-center gap-2">
              <Link2 className="text-[#008069]" size={16} />
              <span>Integrasi Landing Page Eksternal</span>
            </h3>
            <p className="text-xs text-[#667781] mt-0.5">
              Skema 2 (URL Redirect) — hubungkan Landing Page luar ke atribusi &amp; WhatsApp bot.
            </p>
          </div>
          <button onClick={onClose} className="text-[#8696a0] hover:text-[#111b21] transition" aria-label="Tutup">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
          {/* Alur singkat */}
          <div className="space-y-2">
            <p className="text-[11px] uppercase font-bold text-[#111b21] tracking-wider">Cara kerja</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              {[
                { icon: <Link2 size={14} />, txt: 'Ganti tombol CTA ke /cta?slug=...' },
                { icon: <Code size={14} />, txt: 'Tanam satu baris script embed' },
                { icon: <MousePointerClick size={14} />, txt: 'Atribusi iklan tertangkap otomatis' },
                { icon: <Smartphone size={14} />, txt: 'Redirect WA + trackingCode tercatat' },
              ].map((s, i) => (
                <div key={i} className="bg-[#f8fafc] border border-[#e9edef] rounded-xl px-3 py-2.5 flex items-start gap-2 shadow-xs">
                  <span className="text-[#008069] flex-shrink-0 mt-0.5">{s.icon}</span>
                  <div>
                    <div className="text-[9px] text-[#8696a0] font-bold">LANGKAH {i + 1}</div>
                    <div className="text-xs text-[#111b21] font-medium leading-snug">{s.txt}</div>
                  </div>
                  {i < 3 && <ArrowRight size={12} className="text-[#8696a0] hidden lg:block ml-auto mt-1" />}
                </div>
              ))}
            </div>
          </div>

          {/* Snippet utama */}
          <div className="space-y-2">
            <p className="text-[11px] uppercase font-bold text-[#111b21] tracking-wider">Script embed (satu baris)</p>
            <div className="bg-white border border-[#e9edef] rounded-xl overflow-hidden shadow-xs">
              <div className="flex items-center justify-between px-3.5 py-2 border-b border-[#e9edef] bg-[#f8fafc]">
                <span className="text-[11px] uppercase font-bold text-[#111b21] flex items-center gap-1.5">
                  <Code size={13} className="text-[#008069]" />
                  <span>Pasang di <b>&lt;/body&gt;</b> Landing Page Eksternal</span>
                </span>
                <button
                  onClick={handleCopyMain}
                  className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg border transition shadow-xs ${
                    copiedMain
                      ? 'text-emerald-800 border-emerald-300 bg-emerald-100'
                      : 'text-[#111b21] border-[#d1d7db] bg-white hover:bg-[#f0f2f5]'
                  }`}
                >
                  {copiedMain ? <Check size={11} /> : <Copy size={11} />}
                  {copiedMain ? 'Tersalin!' : 'Salin'}
                </button>
              </div>
              <pre className="p-3.5 text-xs leading-relaxed font-mono text-[#008069] bg-[#f8fafc] overflow-x-auto whitespace-pre-wrap break-all">
                {scriptSnippet}
              </pre>
            </div>
            <p className="text-xs text-[#667781] flex items-start gap-1.5">
              <Info size={12} className="text-[#008069] flex-shrink-0 mt-0.5" />
              <span>
                Domain diambil otomatis dari dashboard ini. Tombol CTA Anda harus dimulai dengan{' '}
                <code className="text-[#008069] font-mono font-semibold">{ctaSnippet}</code> agar terhubung ke atribusi bot.
              </span>
            </p>
          </div>

          {/* Contoh link CTA */}
          <div className="space-y-2">
            <p className="text-[11px] uppercase font-bold text-[#111b21] tracking-wider">Contoh link tombol CTA</p>
            <SnippetBlock
              title="HTML link CTA + script embed"
              code={`<a href="${ctaSnippet}" class="btn-cta">Chat WhatsApp Sekarang</a>\n\n<script src="${origin}/assets/external-tracker.js" defer></script>`}
            />
          </div>

          {/* Per platform */}
          <div className="space-y-2">
            <p className="text-[11px] uppercase font-bold text-[#111b21] tracking-wider">Petunjuk per platform</p>
            <div className="space-y-2.5">
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
          <div className="space-y-2.5">
            <p className="text-[11px] uppercase font-bold text-[#111b21] tracking-wider">
              Parameter atribusi yang disalin otomatis
            </p>
            <div className="bg-white border border-[#e9edef] rounded-xl overflow-hidden shadow-xs">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-[#e9edef] bg-[#f8fafc]">
                    <th className="px-4 py-2.5 text-[11px] uppercase font-bold text-[#667781]">Kategori</th>
                    <th className="px-4 py-2.5 text-[11px] uppercase font-bold text-[#667781]">Param</th>
                  </tr>
                </thead>
                <tbody>
                  {PARAM_GROUPS.map((row, i) => (
                    <tr key={i} className="border-b border-[#e9edef] last:border-0">
                      <td className="px-4 py-2 text-xs font-semibold text-[#111b21]">{row.group}</td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap gap-1">
                          {row.params.map((p) => (
                            <span
                              key={p}
                              className="px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200 text-[10px] font-mono font-bold"
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
            <p className="text-xs text-[#667781] flex items-start gap-1.5">
              <AlertTriangle size={12} className="text-amber-600 flex-shrink-0 mt-0.5" />
              <span>
                Param sistem bot (<b>slug</b>, p, phone, msg, greetings) sengaja TIDAK ikut disalin dan tidak pernah ditimpa.
                Cookie <code className="text-[#111b21] font-mono">_fbp/_fbc</code> bersifat per-domain — jika ingin dedup penuh, sertakan
                <code className="text-[#111b21] font-mono"> ?fbp=&amp;fbc=</code> di URL LP.
              </span>
            </p>
          </div>

          {/* Keamanan */}
          <div className="space-y-2">
            <p className="text-[11px] uppercase font-bold text-[#111b21] tracking-wider">Keamanan</p>
            <div className="border border-amber-200 bg-amber-50 rounded-xl px-4 py-3 space-y-2 shadow-xs">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-900">
                <ShieldCheck size={14} className="text-amber-700" />
                <span>Script jembatan bersifat read-only &amp; fail-open</span>
              </div>
              <ul className="space-y-1 text-xs text-amber-800 list-none">
                <li className="flex items-start gap-1.5">
                  <Info size={12} className="text-amber-700 flex-shrink-0 mt-0.5" />
                  <span>Hanya menambah query string pada link ber-path <code className="font-mono font-bold">/cta</code>. Link lain tidak diubah.</span>
                </li>
                <li className="flex items-start gap-1.5">
                  <Info size={12} className="text-amber-700 flex-shrink-0 mt-0.5" />
                  <span>Error apa pun di-swallow: tombol CTA tetap berfungsi normal.</span>
                </li>
                <li className="flex items-start gap-1.5">
                  <Info size={12} className="text-amber-700 flex-shrink-0 mt-0.5" />
                  <span>Nomor WhatsApp selalu diambil dari pengaturan Tenant — param <code className="font-mono font-bold">phone</code> di URL di-ignore untuk mencegah penyalahgunaan.</span>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-[#e9edef] flex justify-end bg-[#f8fafc]">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#111b21] rounded-xl text-xs font-semibold transition flex items-center gap-1.5 shadow-xs"
          >
            <X size={14} />
            <span>Tutup</span>
          </button>
        </div>
      </div>
    </div>
  );
};