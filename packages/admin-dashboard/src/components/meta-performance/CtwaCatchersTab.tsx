import React, { useCallback, useEffect, useState } from 'react';
import {
  Target,
  Plus,
  Pencil,
  Trash2,
  Loader,
  X,
  RefreshCw,
  CheckCircle2,
  XCircle,
  FlaskConical,
  ShieldCheck,
} from 'lucide-react';
import {
  fetchCtwaCatchers,
  createCtwaCatcher,
  updateCtwaCatcher,
  deleteCtwaCatcher,
  testCtwaCatcherSimulator,
  type CtwaCatcher,
} from '../../services/api';
import { useUiFeedback } from '../common/UiFeedback';

interface SimulatorResult {
  matched: boolean;
  bestMatch: { campaignName: string | null; source: string | null; templateIndex: number } | null;
  similarityScore: number;
  effectiveScore: number;
  anchorCheckPassed: boolean;
  anchorBypassed: boolean;
  diagnostics: Array<{ template: string; score: number }>;
}

const SOURCE_OPTIONS = ['instagram', 'facebook', 'tiktok', 'meta'];

const pct = (n: number) => `${Math.round((n || 0) * 100)}%`;

// ---------------------------------------------------------------- Tag Input
const TagInput: React.FC<{
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  multiline?: boolean;
}> = ({ values, onChange, placeholder, multiline }) => {
  const [draft, setDraft] = useState('');
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (!values.includes(v)) onChange([...values, v]);
    setDraft('');
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        {multiline ? (
          <textarea
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                add();
              }
            }}
            placeholder={placeholder}
            className="flex-1 text-xs border border-[#e9edef] rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-[#008069]"
          />
        ) : (
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            placeholder={placeholder}
            className="flex-1 text-xs border border-[#e9edef] rounded-lg px-3 py-2 focus:outline-none focus:border-[#008069]"
          />
        )}
        <button
          type="button"
          onClick={add}
          className="px-3 py-2 bg-[#008069] hover:bg-[#00a884] text-white rounded-lg text-xs font-semibold transition"
        >
          <Plus size={14} />
        </button>
      </div>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {values.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-[11px]"
            >
              <span className="max-w-[240px] truncate">{v}</span>
              <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} className="hover:text-red-600">
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------- Tab
export const CtwaCatchersTab: React.FC = () => {
  const { toast, confirm } = useUiFeedback();
  const [rows, setRows] = useState<CtwaCatcher[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [fCampaign, setFCampaign] = useState('');
  const [fSource, setFSource] = useState('instagram');
  const [fGreetings, setFGreetings] = useState<string[]>([]);
  const [fAnchors, setFAnchors] = useState<string[]>([]);
  const [fThreshold, setFThreshold] = useState(70);
  const [fActive, setFActive] = useState(true);

  const [simText, setSimText] = useState('');
  const [simResult, setSimResult] = useState<SimulatorResult | null>(null);
  const [simLoading, setSimLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchCtwaCatchers();
      setRows(res?.data || []);
    } catch (err: any) {
      toast(`Gagal memuat Greeting Catchers: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const resetForm = () => {
    setEditingId(null);
    setFCampaign('');
    setFSource('instagram');
    setFGreetings([]);
    setFAnchors([]);
    setFThreshold(70);
    setFActive(true);
  };

  const openCreate = () => {
    resetForm();
    setModalOpen(true);
  };

  const openEdit = (row: CtwaCatcher) => {
    setEditingId(row.id);
    setFCampaign(row.campaign_name);
    setFSource(row.source || 'instagram');
    setFGreetings([...(row.greetings || [])]);
    setFAnchors([...(row.anchor_keywords || [])]);
    setFThreshold(Math.round((row.similarity_threshold || 0.7) * 100));
    setFActive(row.is_active);
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (fCampaign.trim().length < 2) {
      toast('Nama kampanye minimal 2 karakter.', 'error');
      return;
    }
    if (fGreetings.length < 1) {
      toast('Minimal 1 template sapaan wajib diisi.', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        campaign_name: fCampaign.trim(),
        source: fSource,
        greetings: fGreetings,
        anchor_keywords: fAnchors,
        similarity_threshold: fThreshold / 100,
        is_active: fActive,
      };
      if (editingId) {
        await updateCtwaCatcher(editingId, payload);
        toast('Kampanye catcher diperbarui.', 'success');
      } else {
        await createCtwaCatcher(payload);
        toast('Kampanye catcher ditambahkan.', 'success');
      }
      setModalOpen(false);
      resetForm();
      await load();
    } catch (err: any) {
      toast(`Gagal menyimpan: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row: CtwaCatcher) => {
    const ok = await confirm({
      title: 'Hapus Kampanye Catcher?',
      message: `Kampanye "${row.campaign_name}" akan dihapus. Atribusi fuzzy untuk kampanye ini berhenti.`,
      confirmText: 'Ya, Hapus',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteCtwaCatcher(row.id);
      toast('Kampanye catcher dihapus.', 'success');
      await load();
    } catch (err: any) {
      toast(`Gagal menghapus: ${err.message}`, 'error');
    }
  };

  const handleSimulate = async () => {
    if (!simText.trim()) {
      toast('Ketik dulu contoh pesan pasien.', 'error');
      return;
    }
    setSimLoading(true);
    setSimResult(null);
    try {
      const res = await testCtwaCatcherSimulator(simText);
      setSimResult(res?.data || null);
    } catch (err: any) {
      toast(`Gagal menguji: ${err.message}`, 'error');
    } finally {
      setSimLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-[#111b21] flex items-center gap-2">
            <Target size={16} className="text-[#008069]" /> Greeting Catchers CTWA
          </h3>
          <p className="text-xs text-[#667781] mt-0.5 max-w-2xl">
            Petakan kalimat pembuka iklan Click-to-WhatsApp ke nama kampanye. Berguna saat metadata
            referral Meta hilang di jalan — pencocokan tahan typo &amp; slang, dengan guard kata kunci jangkar.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            className="px-3 py-2 border border-[#e9edef] rounded-xl text-xs font-semibold text-[#667781] hover:bg-[#f0f2f5] flex items-center gap-1.5"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Muat Ulang
          </button>
          <button
            onClick={openCreate}
            className="px-3.5 py-2 bg-[#008069] hover:bg-[#00a884] text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-xs"
          >
            <Plus size={13} /> Tambah Kampanye
          </button>
        </div>
      </div>

      {/* Campaign list */}
      {loading ? (
        <div className="bg-white border border-[#e9edef] rounded-2xl p-10 flex items-center justify-center text-[#8696a0]">
          <Loader size={16} className="animate-spin text-[#008069] mr-2" /> Memuat kampanye...
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white border border-dashed border-[#e9edef] rounded-2xl p-10 text-center text-[#8696a0] text-sm">
          Belum ada kampanye catcher. Tambahkan untuk mulai mencocokkan kalimat iklan.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {rows.map((row) => (
            <div key={row.id} className="bg-white border border-[#e9edef] rounded-2xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-[#111b21]">{row.campaign_name}</span>
                    <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-sky-50 text-sky-800 border border-sky-200">
                      {row.source}
                    </span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full border ${
                        row.is_active
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          : 'bg-slate-100 text-slate-600 border-slate-200'
                      }`}
                    >
                      {row.is_active ? 'Aktif' : 'Nonaktif'}
                    </span>
                  </div>
                  <div className="text-[11px] text-[#667781] mt-1">
                    Sensitivitas: <span className="font-semibold text-[#111b21]">{pct(row.similarity_threshold)}</span>
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => openEdit(row)}
                    title="Edit"
                    className="w-8 h-8 rounded-lg border border-[#e9edef] text-[#667781] hover:text-[#008069] hover:bg-[#f0f2f5] flex items-center justify-center"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => handleDelete(row)}
                    title="Hapus"
                    className="w-8 h-8 rounded-lg border border-[#e9edef] text-[#667781] hover:text-red-600 hover:bg-red-50 flex items-center justify-center"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#8696a0] mb-1">Template Sapaan</div>
                <div className="flex flex-wrap gap-1.5">
                  {row.greetings.map((g, i) => (
                    <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-[#f0f2f5] text-[#111b21] border border-[#e9edef] max-w-full truncate">
                      {g}
                    </span>
                  ))}
                </div>
              </div>

              {row.anchor_keywords?.length > 0 && (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[#8696a0] mb-1 flex items-center gap-1">
                    <ShieldCheck size={11} /> Kata Kunci Jangkar
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {row.anchor_keywords.map((a, i) => (
                      <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                        {a}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Simulator */}
      <div className="bg-white border border-[#e9edef] rounded-2xl p-4 space-y-3">
        <h4 className="text-sm font-bold text-[#111b21] flex items-center gap-2">
          <FlaskConical size={15} className="text-[#008069]" /> Simulator Interaktif
        </h4>
        <p className="text-xs text-[#667781]">
          Ketik contoh pesan calon pasien untuk melihat kampanye yang tertangkap &amp; skor kemiripan.
        </p>
        <div className="flex gap-2">
          <input
            value={simText}
            onChange={(e) => setSimText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSimulate();
            }}
            placeholder="cth: halo min mau tny prmo baby spa sby"
            className="flex-1 text-xs border border-[#e9edef] rounded-lg px-3 py-2 focus:outline-none focus:border-[#008069]"
          />
          <button
            onClick={handleSimulate}
            disabled={simLoading}
            className="px-4 py-2 bg-[#008069] hover:bg-[#00a884] text-white rounded-lg text-xs font-semibold disabled:opacity-50 flex items-center gap-1.5"
          >
            {simLoading ? <Loader size={13} className="animate-spin" /> : <FlaskConical size={13} />} Uji
          </button>
        </div>

        {simResult && (
          <div className="space-y-2 border-t border-[#e9edef] pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${
                  simResult.matched
                    ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                    : 'bg-slate-100 text-slate-700 border-slate-200'
                }`}
              >
                {simResult.matched ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                {simResult.matched ? `Match: ${simResult.bestMatch?.campaignName || '-'}` : 'Tidak Match'}
              </span>
              <span className="text-xs text-[#667781]">
                Skor: <span className="font-bold text-[#111b21]">{pct(simResult.similarityScore)}</span>
                {' '}(efektif {pct(simResult.effectiveScore)})
              </span>
              <span
                className={`text-[11px] px-2 py-0.5 rounded-full border ${
                  simResult.anchorCheckPassed
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : 'bg-amber-50 text-amber-800 border-amber-200'
                }`}
              >
                {simResult.anchorCheckPassed ? 'Anchor lolos' : 'Anchor gagal'}
                {simResult.anchorBypassed ? ' (bypass skor tinggi)' : ''}
              </span>
            </div>

            {simResult.diagnostics?.length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#8696a0]">Diagnostik per Template</div>
                {simResult.diagnostics.map((d, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    <div className="h-1.5 rounded-full bg-[#008069]" style={{ width: `${Math.max(2, d.score * 100)}px` }} />
                    <span className="text-[#667781] w-12 shrink-0">{pct(d.score)}</span>
                    <span className="text-[#111b21] truncate">{d.template}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto border border-[#e9edef]">
            <div className="flex items-start justify-between border-b border-[#e9edef] pb-3">
              <h4 className="text-base font-bold text-[#111b21]">
                {editingId ? 'Edit Kampanye Catcher' : 'Tambah Kampanye Catcher'}
              </h4>
              <button
                onClick={() => setModalOpen(false)}
                className="w-8 h-8 rounded-xl bg-[#f0f2f5] hover:bg-[#e9edef] text-[#667781] flex items-center justify-center"
              >
                <X size={15} />
              </button>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-[#111b21]">Nama Kampanye</label>
              <input
                value={fCampaign}
                onChange={(e) => setFCampaign(e.target.value)}
                placeholder="cth: IG-BABYSPA"
                className="w-full text-xs border border-[#e9edef] rounded-lg px-3 py-2 focus:outline-none focus:border-[#008069]"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-[#111b21]">Platform</label>
              <select
                value={fSource}
                onChange={(e) => setFSource(e.target.value)}
                className="w-full text-xs border border-[#e9edef] rounded-lg px-3 py-2 focus:outline-none focus:border-[#008069]"
              >
                {SOURCE_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-[#111b21]">Template Sapaan (multi)</label>
              <TagInput
                values={fGreetings}
                onChange={setFGreetings}
                placeholder="Tulis 1 kalimat sapaan iklan lalu Enter..."
                multiline
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-[#111b21]">Kata Kunci Jangkar (opsional)</label>
              <TagInput
                values={fAnchors}
                onChange={setFAnchors}
                placeholder="cth: baby spa, surabaya"
              />
              <p className="text-[11px] text-[#8696a0]">
                Kosongkan bila ingin catcher generik (murni andalkan kemiripan teks).
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-[#111b21]">
                Sensitivitas Kemiripan: <span className="text-[#008069]">{fThreshold}%</span>
              </label>
              <input
                type="range"
                min={50}
                max={95}
                value={fThreshold}
                onChange={(e) => setFThreshold(Number(e.target.value))}
                className="w-full accent-[#008069]"
              />
              <div className="flex justify-between text-[10px] text-[#8696a0]">
                <span>50% (longgar)</span>
                <span>95% (ketat)</span>
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs font-semibold text-[#111b21]">
              <input type="checkbox" checked={fActive} onChange={(e) => setFActive(e.target.checked)} className="accent-[#008069]" />
              Aktif
            </label>

            <div className="flex justify-end gap-2 border-t border-[#e9edef] pt-3">
              <button
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 border border-[#e9edef] rounded-xl text-xs font-semibold text-[#667781] hover:bg-[#f0f2f5]"
              >
                Batal
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 bg-[#008069] hover:bg-[#00a884] text-white rounded-xl text-xs font-semibold disabled:opacity-50 flex items-center gap-1.5"
              >
                {saving && <Loader size={13} className="animate-spin" />} Simpan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CtwaCatchersTab;
