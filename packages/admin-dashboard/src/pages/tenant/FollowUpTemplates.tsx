import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../services/api';
import {
  MessageSquareText,
  Save,
  RotateCcw,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  XCircle,
  FileText
} from 'lucide-react';

interface TemplateItem {
  id: string | null;
  type: string;
  variant: number;
  text: string;
  isDefault: boolean;
}

const TYPE_LABELS: Record<string, string> = {
  REMINDER_H0: 'Reminder Hari-H (Jam Treatment)',
  REVIEW_H1_BABY: 'Review H+1 (Baby)',
  REVIEW_H1_MOMS: 'Review H+1 (Moms)',
  NO_PURCHASE_1: 'Belum Purchase — Hari ke-3',
  NO_PURCHASE_2: 'Belum Purchase — Hari ke-7',
  NO_PURCHASE_3: 'Belum Purchase — Hari ke-14',
  NEXT_TREATMENT_1: 'Treatment Lanjutan — Bulan ke-1',
  NEXT_TREATMENT_2: 'Treatment Lanjutan — Bulan ke-2',
  NEXT_TREATMENT_3: 'Treatment Lanjutan — Bulan ke-3',
};

export const FollowUpTemplates: React.FC = () => {
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const res = await apiRequest('follow-up-templates');
      setTemplates(res?.data || []);
    } catch (err: any) {
      setToastMsg({ type: 'error', text: `Gagal load template: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTemplates();
  }, []);

  const updateText = (type: string, variant: number, text: string) => {
    setTemplates(templates.map((t) => (t.type === type && t.variant === variant ? { ...t, text } : t)));
  };

  const handleSave = async (type: string, variant: number) => {
    const item = templates.find((t) => t.type === type && t.variant === variant);
    if (!item) return;
    const key = `${type}#${variant}`;
    setSavingKey(key);
    try {
      await apiRequest('follow-up-templates', {
        method: 'PUT',
        body: JSON.stringify({ type, variant, text: item.text }),
      });
      setToastMsg({ type: 'success', text: 'Template berhasil disimpan!' });
      loadTemplates();
    } catch (err: any) {
      setToastMsg({ type: 'error', text: `Gagal simpan: ${err.message}` });
    } finally {
      setSavingKey(null);
    }
  };

  const handleReset = async (type: string, variant: number) => {
    try {
      await apiRequest(`follow-up-templates/${type}/${variant}`, { method: 'DELETE' });
      setToastMsg({ type: 'success', text: 'Template dikembalikan ke default.' });
      loadTemplates();
    } catch (err: any) {
      setToastMsg({ type: 'error', text: `Gagal reset: ${err.message}` });
    }
  };

  const grouped = templates.reduce<Record<string, TemplateItem[]>>((acc, t) => {
    (acc[t.type] = acc[t.type] || []).push(t);
    return acc;
  }, {});

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-3xl font-extrabold tracking-tight text-white flex items-center space-x-3">
            <MessageSquareText className="text-pink-400" />
            <span>Rolling Template Follow-Up</span>
          </h2>
          <p className="text-slate-400 mt-1">
            Edit pesan follow-up & reminder. Gunakan placeholder <code className="text-pink-400">{"{name}"}</code>, <code className="text-pink-400">{"{time}"}</code>, <code className="text-pink-400">{"{babyName}"}</code>. Tersedia 3 varian per tipe untuk rotasi anti-bot.
          </p>
        </div>
        <button
          onClick={loadTemplates}
          className="p-2.5 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white transition flex items-center space-x-1.5"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          <span className="text-xs font-bold">Refresh</span>
        </button>
      </div>

      {/* Placeholder Info */}
      <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-start space-x-2 text-[11px]">
        <FileText className="flex-shrink-0 mt-0.5" size={14} />
        <div>
          <p className="font-bold">Placeholder yang tersedia:</p>
          <p className="mt-0.5">
            <code className="text-blue-300">{"{name}"}</code> = Nama Customer &nbsp;·&nbsp;
            <code className="text-blue-300">{"{time}"}</code> = Jam Treatment &nbsp;·&nbsp;
            <code className="text-blue-300">{"{babyName}"}</code> = Nama Bayi
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center items-center py-20">
          <RefreshCw className="animate-spin text-pink-400" size={36} />
        </div>
      ) : (
        <div className="space-y-8">
          {Object.entries(grouped).map(([type, items]) => (
            <div key={type} className="glass-panel border border-white/5 rounded-2xl p-6 space-y-4">
              <h3 className="text-base font-bold text-white flex items-center space-x-2">
                <MessageSquareText className="text-pink-400" size={16} />
                <span>{TYPE_LABELS[type] || type}</span>
                <span className="px-2 py-0.5 rounded bg-white/5 border border-white/10 text-slate-400 text-[9px] font-bold">
                  {items.length} varian
                </span>
              </h3>

              <div className="space-y-3">
                {items.map((item) => (
                  <div key={`${item.type}-${item.variant}`} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] text-slate-400 uppercase font-bold flex items-center space-x-1.5">
                        <span>Varian #{item.variant}</span>
                        {!item.isDefault && (
                          <span className="px-1.5 py-0.5 rounded bg-pink-500/10 border border-pink-500/20 text-pink-400 text-[9px] font-bold">
                            CUSTOM
                          </span>
                        )}
                      </label>
                      <div className="flex items-center space-x-1">
                        <button
                          onClick={() => handleSave(item.type, item.variant)}
                          disabled={savingKey === `${item.type}#${item.variant}`}
                          className="px-2.5 py-1 rounded-lg bg-pink-500 hover:bg-pink-600 text-white text-[10px] font-bold flex items-center space-x-1 transition"
                        >
                          {savingKey === `${item.type}#${item.variant}` ? <RefreshCw size={11} className="animate-spin" /> : <Save size={11} />}
                          <span>Simpan</span>
                        </button>
                        {!item.isDefault && (
                          <button
                            onClick={() => handleReset(item.type, item.variant)}
                            className="p-1.5 rounded-lg bg-white/5 hover:bg-rose-500/10 text-slate-400 hover:text-rose-400 text-[10px] font-bold transition"
                            title="Reset ke default"
                          >
                            <RotateCcw size={11} />
                          </button>
                        )}
                      </div>
                    </div>
                    <textarea
                      rows={3}
                      value={item.text}
                      onChange={(e) => updateText(item.type, item.variant, e.target.value)}
                      className="w-full p-3 bg-slate-950 border border-white/10 rounded-xl text-xs text-white leading-relaxed resize-none"
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Toast */}
      {toastMsg && (
        <div className={`fixed bottom-6 right-6 z-[70] px-4 py-3 rounded-xl border text-xs font-bold shadow-xl flex items-center space-x-2 ${
          toastMsg.type === 'success'
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
            : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
        }`}>
          {toastMsg.type === 'success' ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
          <span>{toastMsg.text}</span>
          <button onClick={() => setToastMsg(null)} className="ml-2 text-slate-500 hover:text-white">
            <XCircle size={12} />
          </button>
        </div>
      )}
    </div>
  );
};

export default FollowUpTemplates;
