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
  STAFF_OTW: 'Pesan Terapis OTW (Menuju Lokasi Pasien)',
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-[#111b21] flex items-center space-x-2">
            <MessageSquareText className="text-[#008069]" size={22} />
            <span>Rolling Template Follow-Up</span>
          </h2>
          <p className="text-xs text-[#667781] mt-0.5">
            Edit pesan follow-up & reminder. Gunakan placeholder <code className="text-[#008069] font-bold">{"{name}"}</code>, <code className="text-[#008069] font-bold">{"{time}"}</code>, <code className="text-[#008069] font-bold">{"{babyName}"}</code>. Tersedia 3 varian per tipe untuk rotasi anti-bot.
          </p>
        </div>
        <button
          onClick={loadTemplates}
          className="px-3.5 py-2 rounded-xl bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#111b21] transition flex items-center space-x-1.5 shadow-xs"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin text-[#008069]' : 'text-[#667781]'} />
          <span className="text-xs font-semibold">Refresh</span>
        </button>
      </div>

      {/* Placeholder Info */}
      <div className="p-3.5 rounded-xl bg-[#e8f5f2] border border-[#c2e7e0] text-[#008069] flex items-start space-x-2 text-xs shadow-xs">
        <FileText className="flex-shrink-0 mt-0.5 text-[#008069]" size={15} />
        <div>
          <p className="font-bold">Placeholder yang tersedia:</p>
          <p className="mt-0.5 text-xs text-[#111b21]">
            <code className="bg-white px-1.5 py-0.5 rounded border border-[#c2e7e0] text-[#008069] font-mono text-[11px]">{"{name}"}</code> = Nama Customer &nbsp;·&nbsp;
            <code className="bg-white px-1.5 py-0.5 rounded border border-[#c2e7e0] text-[#008069] font-mono text-[11px]">{"{time}"}</code> = Jam Treatment &nbsp;·&nbsp;
            <code className="bg-white px-1.5 py-0.5 rounded border border-[#c2e7e0] text-[#008069] font-mono text-[11px]">{"{babyName}"}</code> = Nama Bayi
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center items-center py-20">
          <RefreshCw className="animate-spin text-[#008069]" size={32} />
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([type, items]) => (
            <div key={type} className="bg-white border border-[#e9edef] rounded-2xl p-5 space-y-4 shadow-xs">
              <h3 className="text-sm font-bold text-[#111b21] flex items-center space-x-2">
                <MessageSquareText className="text-[#008069]" size={16} />
                <span>{TYPE_LABELS[type] || type}</span>
                <span className="px-2 py-0.5 rounded-full bg-[#f0f2f5] border border-[#e9edef] text-[#54656f] text-[10px] font-bold">
                  {items.length} varian
                </span>
              </h3>

              <div className="space-y-3">
                {items.map((item) => (
                  <div key={`${item.type}-${item.variant}`} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] text-[#667781] uppercase font-bold flex items-center space-x-1.5">
                        <span>Varian #{item.variant}</span>
                        {!item.isDefault && (
                          <span className="px-1.5 py-0.5 rounded-full bg-amber-100 border border-amber-200 text-amber-800 text-[9px] font-bold">
                            CUSTOM
                          </span>
                        )}
                      </label>
                      <div className="flex items-center space-x-1">
                        <button
                          onClick={() => handleSave(item.type, item.variant)}
                          disabled={savingKey === `${item.type}#${item.variant}`}
                          className="px-3 py-1 rounded-lg bg-[#008069] hover:bg-[#00a884] text-white text-xs font-semibold flex items-center space-x-1 transition shadow-xs"
                        >
                          {savingKey === `${item.type}#${item.variant}` ? <RefreshCw size={11} className="animate-spin" /> : <Save size={11} />}
                          <span>Simpan</span>
                        </button>
                        {!item.isDefault && (
                          <button
                            onClick={() => handleReset(item.type, item.variant)}
                            className="p-1 rounded-lg bg-white hover:bg-rose-50 border border-[#d1d7db] text-[#667781] hover:text-rose-600 text-xs font-bold transition shadow-xs"
                            title="Reset ke default"
                          >
                            <RotateCcw size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                    <textarea
                      rows={3}
                      value={item.text}
                      onChange={(e) => updateText(item.type, item.variant, e.target.value)}
                      className="w-full p-3 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] leading-relaxed resize-none focus:outline-none focus:border-[#008069] shadow-xs"
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
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : 'bg-rose-50 border-rose-200 text-rose-800'
        }`}>
          {toastMsg.type === 'success' ? <CheckCircle size={14} className="text-emerald-600" /> : <AlertCircle size={14} className="text-rose-600" />}
          <span>{toastMsg.text}</span>
          <button onClick={() => setToastMsg(null)} className="ml-2 text-[#8696a0] hover:text-[#111b21]">
            <XCircle size={13} />
          </button>
        </div>
      )}
    </div>
  );
};

export default FollowUpTemplates;
