import React, { useEffect, useState, useRef, useMemo } from 'react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../../components/common/UiFeedback';
import {
  MessageSquareText,
  Save,
  RotateCcw,
  RefreshCw,
  Check,
  FileText,
  Search,
  Baby,
  Tag,
  X,
  Layers,
  Clock,
  HeartHandshake,
  CalendarHeart,
  UserCheck,
  Users
} from 'lucide-react';

interface TemplateItem {
  id: string | null;
  type: string;
  variant: number;
  text: string;
  isDefault: boolean;
}

const TYPE_CONFIG: Record<string, { label: string; category: string; description: string }> = {
  REMINDER_H0: {
    label: 'Reminder Hari-H (Tanpa Jam)',
    category: 'REMINDER',
    description: 'Terkirim otomatis pagi hari treatment untuk mengingatkan jadwal kunjungan bidan / kedatangan pasien (tanpa patokan jam spesifik).',
  },
  STAFF_OTW: {
    label: 'Pesan Bidan OTW (Menuju Lokasi)',
    category: 'REMINDER',
    description: 'Pesan konfirmasi keberangkatan bidan menuju rumah pasien (home care).',
  },
  STAFF_ARRIVAL: {
    label: 'Pesan Bidan Sudah Sampai (Tiba di Lokasi)',
    category: 'REMINDER',
    description: 'Pesan otomatis saat bidan menandai tiba di lokasi pasien. Placeholder: {patientName}, {therapistName}, {clinicName}.',
  },
  STAFF_TRIP_STATUS: {
    label: 'Status Perjalanan Bidan (Jawaban CS)',
    category: 'REMINDER',
    description: 'Teks siap kirim untuk CS saat pasien bertanya posisi bidan. Placeholder: {name}, {areaName}, {etaMinutes}.',
  },
  REVIEW_H1_BABY: {
    label: 'Review H+1 Pasca Treatment Baby',
    category: 'REVIEW',
    description: 'Menanyakan kabar & kondisi si kecil setelah treatment baby massage / terapi.',
  },
  REVIEW_H1_MOMS: {
    label: 'Review H+1 Pasca Treatment Moms',
    category: 'REVIEW',
    description: 'Menanyakan kenyamanan dan kebugaran bunda pasca prenatal / postnatal treatment.',
  },
  NO_PURCHASE_1: {
    label: 'Follow-Up Belum Reservasi — Hari ke-3',
    category: 'NO_PURCHASE',
    description: 'Sentuhan ramah hari ke-3 bagi pelanggan yang sudah berkonsultasi tapi belum reservasi.',
  },
  NO_PURCHASE_2: {
    label: 'Follow-Up Belum Reservasi — Hari ke-7',
    category: 'NO_PURCHASE',
    description: 'Edukasi manfaat layanan hari ke-7 untuk menumbuhkan minat reservasi.',
  },
  NO_PURCHASE_3: {
    label: 'Follow-Up Belum Reservasi — Hari ke-14',
    category: 'NO_PURCHASE',
    description: 'Tawaran penutup ramah hari ke-14 sebelum percakapan diarsipkan.',
  },
  NEXT_TREATMENT_1: {
    label: 'Treatment Lanjutan — Bulan ke-1',
    category: 'NEXT_TREATMENT',
    description: 'Reminder treatment rutin bulan ke-1 untuk menjaga kesehatan & perkembangan si kecil/bunda.',
  },
  NEXT_TREATMENT_2: {
    label: 'Treatment Lanjutan — Bulan ke-2',
    category: 'NEXT_TREATMENT',
    description: 'Reminder treatment berkala bulan ke-2 pasca kunjungan sebelumnya.',
  },
  NEXT_TREATMENT_3: {
    label: 'Treatment Lanjutan — Bulan ke-3',
    category: 'NEXT_TREATMENT',
    description: 'Reminder treatment berkala bulan ke-3 untuk evaluasi kebugaran berkala.',
  },
  MILESTONE_3M: {
    label: 'Milestone 3 Bulan — Tummy Time',
    category: 'MILESTONE',
    description: 'Edukasi stimulasi tummy time & pijat bayi usia 3 bulan.',
  },
  MILESTONE_6M: {
    label: 'Milestone 6 Bulan — Duduk & Merangkak',
    category: 'MILESTONE',
    description: 'Edukasi milestone duduk & merangkak usia 6 bulan.',
  },
  MILESTONE_9M: {
    label: 'Milestone 9 Bulan — Berdiri',
    category: 'MILESTONE',
    description: 'Edukasi milestone berdiri & merambat usia 9 bulan.',
  },
  MILESTONE_12M: {
    label: 'Milestone 12 Bulan — Berjalan',
    category: 'MILESTONE',
    description: 'Edukasi milestone berjalan & MPASI usia 12 bulan.',
  },
  WINBACK_60D: {
    label: 'Re-engagement Pelanggan Lama (>60 Hari)',
    category: 'WINBACK',
    description: 'Sapaan silaturahmi untuk pelanggan MQL / riwayat lama yang sudah lebih dari 60 hari tidak berinteraksi.',
  },
};

const CATEGORIES = [
  { id: 'ALL', label: 'Semua Template', icon: Layers },
  { id: 'REMINDER', label: 'Hari-H & OTW', icon: Clock },
  { id: 'REVIEW', label: 'Review H+1', icon: HeartHandshake },
  { id: 'NO_PURCHASE', label: 'Belum Reservasi', icon: CalendarHeart },
  { id: 'NEXT_TREATMENT', label: 'Treatment Rutin', icon: UserCheck },
  { id: 'MILESTONE', label: 'Milestone Usia Bayi', icon: Baby },
  { id: 'WINBACK', label: 'Re-engagement', icon: Users },
];

const AVAILABLE_PLACEHOLDERS = [
  { tag: '{name}', label: 'Nama Pelanggan', desc: 'Contoh: Bunda Rina' },
  { tag: '{time}', label: 'Jam Treatment', desc: 'Contoh: 10:00 WIB' },
  { tag: '{babyName}', label: 'Nama Bayi / Anak', desc: 'Contoh: Adek Kenzo' },
];

export const FollowUpTemplates: React.FC = () => {
  const { toast, confirm } = useUiFeedback();
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [originalTexts, setOriginalTexts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedSuccessKey, setSavedSuccessKey] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Refs to textareas to support cursor-based placeholder insertion
  const textareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  const loadTemplates = async (isInitial = false) => {
    if (isInitial) setLoading(true);
    else setRefreshing(true);

    try {
      const res = await apiRequest('follow-up-templates');
      const data: TemplateItem[] = res?.data || [];
      setTemplates(data);

      const originals: Record<string, string> = {};
      data.forEach((t) => {
        originals[`${t.type}#${t.variant}`] = t.text;
      });
      setOriginalTexts(originals);
    } catch (err: any) {
      toast(`Gagal memuat template: ${err.message || 'Error jaringan'}`, 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadTemplates(true);
  }, []);

  const updateText = (type: string, variant: number, text: string) => {
    setTemplates((prev) =>
      prev.map((t) => (t.type === type && t.variant === variant ? { ...t, text } : t))
    );
  };

  const insertPlaceholder = (type: string, variant: number, placeholder: string) => {
    const key = `${type}#${variant}`;
    const textarea = textareaRefs.current[key];
    const currentItem = templates.find((t) => t.type === type && t.variant === variant);
    if (!currentItem) return;

    if (textarea) {
      const start = textarea.selectionStart || 0;
      const end = textarea.selectionEnd || 0;
      const original = currentItem.text || '';
      const newText = original.substring(0, start) + placeholder + original.substring(end);
      updateText(type, variant, newText);

      // Restore focus and cursor position after insertion
      setTimeout(() => {
        textarea.focus();
        const nextPos = start + placeholder.length;
        textarea.setSelectionRange(nextPos, nextPos);
      }, 50);
    } else {
      updateText(type, variant, (currentItem.text || '') + ' ' + placeholder);
    }
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

      // Update state in-place without unmounting or jumping scroll position
      setTemplates((prev) =>
        prev.map((t) => (t.type === type && t.variant === variant ? { ...t, isDefault: false } : t))
      );
      setOriginalTexts((prev) => ({ ...prev, [key]: item.text }));

      // Temporary visual success indicator on the button
      setSavedSuccessKey(key);
      setTimeout(() => {
        setSavedSuccessKey((curr) => (curr === key ? null : curr));
      }, 2500);

      toast('Template berhasil disimpan!', 'success');

      // Silent background revalidation (zero unmount, zero scroll reset)
      loadTemplates(false);
    } catch (err: any) {
      toast(`Gagal menyimpan template: ${err.message || 'Kesalahan server'}`, 'error');
    } finally {
      setSavingKey(null);
    }
  };

  const handleReset = async (type: string, variant: number) => {
    const typeLabel = TYPE_CONFIG[type]?.label || type;
    const confirmed = await confirm({
      title: 'Reset Template ke Default?',
      message: `Template "${typeLabel} (Varian #${variant})" akan dikembalikan ke teks standar bawaan klinik. Teks kustom yang ada saat ini akan terhapus.`,
      confirmText: 'Ya, Kembalikan ke Default',
      cancelText: 'Batal',
      danger: true,
    });

    if (!confirmed) return;

    const key = `${type}#${variant}`;
    setSavingKey(key);
    try {
      await apiRequest(`follow-up-templates/${type}/${variant}`, { method: 'DELETE' });
      toast('Template dikembalikan ke pengaturan default.', 'success');
      await loadTemplates(false);
    } catch (err: any) {
      toast(`Gagal mereset template: ${err.message || 'Kesalahan server'}`, 'error');
    } finally {
      setSavingKey(null);
    }
  };

  // Group templates by type
  const grouped = useMemo(() => {
    return templates.reduce<Record<string, TemplateItem[]>>((acc, t) => {
      (acc[t.type] = acc[t.type] || []).push(t);
      return acc;
    }, {});
  }, [templates]);

  // Filtered types according to selected category and search query
  const filteredTypes = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return Object.keys(grouped).filter((type) => {
      const config = TYPE_CONFIG[type];
      const matchCategory =
        selectedCategory === 'ALL' || (config && config.category === selectedCategory);

      if (!matchCategory) return false;

      if (!q) return true;

      const labelMatch = (config?.label || type).toLowerCase().includes(q);
      const descMatch = (config?.description || '').toLowerCase().includes(q);
      const contentMatch = grouped[type]?.some((item) => item.text.toLowerCase().includes(q));

      return labelMatch || descMatch || contentMatch;
    });
  }, [grouped, selectedCategory, searchQuery]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-16">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-surface p-5 rounded-2xl border border-divider shadow-xs">
        <div>
          <div className="flex items-center space-x-2.5">
            <div className="w-10 h-10 rounded-xl bg-accent-soft border border-divider flex items-center justify-center text-accent">
              <MessageSquareText size={22} />
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-tight text-ink">
                Rolling Template Follow-Up & Reminder
              </h2>
              <p className="text-xs text-ink-2 mt-0.5">
                Kelola variasi pesan otomatis WhatsApp. Tersedia 3 varian dinamis per skenario untuk rotasi anti-bot & personalisasi ramah.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => loadTemplates(false)}
            disabled={refreshing || loading}
            className="h-10 px-4 rounded-xl bg-surface hover:bg-fill-1 border border-divider text-ink transition-all duration-150 active:scale-[0.98] flex items-center space-x-2 text-xs font-semibold shadow-xs disabled:opacity-60"
            title="Muat ulang template dari database"
          >
            <RefreshCw
              size={14}
              className={`text-accent ${refreshing ? 'animate-spin' : ''}`}
            />
            <span>{refreshing ? 'Menyinkronkan...' : 'Sinkronkan Data'}</span>
          </button>
        </div>
      </div>

      {/* Quick Guide & Interactive Placeholder Library */}
      <div className="bg-surface-2 border border-divider dark:border-accent/25 rounded-2xl p-4.5 shadow-xs">
        <div className="flex flex-col sm:flex-row items-start justify-between gap-3">
          <div className="flex items-start space-x-3">
            <div className="p-2 rounded-xl bg-white/80 dark:bg-fill-1 border border-divider dark:border-accent/30 text-accent mt-0.5 shadow-xs">
              <Tag size={16} />
            </div>
            <div>
              <h4 className="text-xs font-bold text-ink uppercase tracking-wide flex items-center gap-1.5">
                <span>Variabel Pintar (Placeholder)</span>
                <span className="text-[10px] font-normal text-ink-2 normal-case bg-surface px-2 py-0.5 rounded-full border border-divider dark:border-accent/30">
                  Klik chip di bawah untuk menyisipkan
                </span>
              </h4>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                {AVAILABLE_PLACEHOLDERS.map((p) => (
                  <div
                    key={p.tag}
                    className="inline-flex items-center bg-surface px-2.5 py-1.5 rounded-xl border border-divider dark:border-accent/30 shadow-xs text-xs"
                  >
                    <code className="text-accent font-bold font-mono mr-1.5">{p.tag}</code>
                    <span className="text-ink-2 text-[11px]">({p.label})</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="text-[11px] text-ink-2 bg-white/70 dark:bg-fill-1 p-2.5 rounded-xl border border-divider/60 dark:border-accent/25 max-w-sm">
            <span className="font-semibold text-ink">💡 Tips Format WhatsApp:</span> Gunakan <code className="text-accent">*tebal*</code>, <code className="text-accent">_miring_</code>, atau emoji ramah untuk meningkatkan kenyamanan pasien.
          </div>
        </div>
      </div>

      {/* Category Tabs & Filter Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
        {/* Category Pills */}
        <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const isActive = selectedCategory === cat.id;
            const count =
              cat.id === 'ALL'
                ? Object.keys(grouped).length
                : Object.keys(grouped).filter((t) => TYPE_CONFIG[t]?.category === cat.id).length;

            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`h-9 px-3.5 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition-all duration-150 whitespace-nowrap active:scale-[0.98] ${
                  isActive
                    ? 'bg-accent text-accent-ink shadow-sm font-bold'
                    : 'bg-surface border border-divider dark:border-divider text-ink-2 hover:bg-fill-1 hover:text-ink dark:hover:text-ink'
                }`}
              >
                <Icon size={14} className={isActive ? 'text-white' : 'text-ink-3'} />
                <span>{cat.label}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                    isActive ? 'bg-white/20 text-white' : 'bg-fill-1 text-ink-2'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Instant Search Bar */}
        <div className="relative min-w-[240px] sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" size={15} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari skenario / keyword..."
            className="w-full h-9 pl-9 pr-8 bg-surface border border-divider rounded-xl text-xs text-ink placeholder:text-ink-3 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent shadow-xs transition"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 bg-surface border border-divider rounded-2xl">
          <RefreshCw className="animate-spin text-accent mb-3" size={32} />
          <p className="text-xs font-semibold text-ink-2">Memuat seluruh template follow-up...</p>
        </div>
      ) : filteredTypes.length === 0 ? (
        <div className="text-center py-16 bg-surface border border-divider rounded-2xl p-6">
          <MessageSquareText size={36} className="text-ink-3 mx-auto mb-2 opacity-50" />
          <h3 className="text-sm font-bold text-ink">Tidak ada template ditemukan</h3>
          <p className="text-xs text-ink-2 mt-1 max-w-sm mx-auto">
            {searchQuery
              ? `Tidak ada hasil yang cocok dengan kata kunci "${searchQuery}". Coba gunakan istilah lain.`
              : 'Tidak ada template untuk kategori ini.'}
          </p>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="mt-3 px-3 py-1.5 rounded-lg bg-accent-soft text-accent text-xs font-bold hover:bg-accent-soft transition"
            >
              Hapus Pencarian
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {filteredTypes.map((type) => {
            const config = TYPE_CONFIG[type] || {
              label: type,
              category: 'OTHER',
              description: 'Template pesan otomatis.',
            };
            const items = grouped[type] || [];

            return (
              <div
                key={type}
                className="bg-surface border border-divider rounded-2xl p-5 md:p-6 shadow-xs hover:border-divider dark:hover:border-divider transition-colors"
              >
                {/* Skenario Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3.5 border-b border-divider">
                  <div className="space-y-0.5">
                    <div className="flex items-center space-x-2">
                      <div className="w-6 h-6 rounded-lg bg-accent-soft text-accent flex items-center justify-center">
                        <Tag size={13} />
                      </div>
                      <h3 className="text-sm font-bold text-ink">{config.label}</h3>
                      <span className="px-2 py-0.5 rounded-full bg-fill-1 text-ink-2 text-[10px] font-bold">
                        {items.length} Varian Rotasi
                      </span>
                    </div>
                    <p className="text-[11px] text-ink-2 pl-8">{config.description}</p>
                  </div>
                </div>

                {/* 3 Rotational Variants Grid / Stack */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pt-4">
                  {items.map((item) => {
                    const key = `${item.type}#${item.variant}`;
                    const isSaving = savingKey === key;
                    const isJustSaved = savedSuccessKey === key;
                    const originalText = originalTexts[key] ?? item.text;
                    const isDirty = item.text !== originalText;
                    const charCount = (item.text || '').length;

                    return (
                      <div
                        key={key}
                        className={`flex flex-col justify-between p-4 rounded-xl border transition-all ${
                          isDirty
                            ? 'bg-surface dark:bg-surface-2 border-accent/40 ring-1 ring-accent/20 shadow-xs'
                            : 'bg-surface dark:bg-surface-2 border-divider hover:border-divider dark:hover:border-divider'
                        }`}
                      >
                        {/* Variant Top Bar */}
                        <div>
                          <div className="flex items-center justify-between pb-2 mb-2 border-b border-divider dark:border-divider">
                            <div className="flex items-center space-x-2">
                              <span className="text-xs font-bold text-ink bg-surface px-2 py-0.5 rounded-md border border-divider shadow-2xs">
                                Varian #{item.variant}
                              </span>
                              {!item.isDefault ? (
                                <span className="px-2 py-0.5 rounded-full bg-success-soft border border-success-line text-success text-[9px] font-bold flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-success"></span>
                                  KUSTOM
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full bg-fill-1 border border-divider text-ink-2 text-[9px] font-semibold">
                                  DEFAULT
                                </span>
                              )}
                            </div>

                            {/* Reset Button (only shown when customized) */}
                            {!item.isDefault && (
                              <button
                                onClick={() => handleReset(item.type, item.variant)}
                                disabled={isSaving}
                                className="h-7 px-2 rounded-lg bg-surface hover:bg-danger-soft border border-divider hover:border-danger-line text-ink-2 hover:text-danger text-[11px] font-semibold transition-all flex items-center space-x-1 active:scale-[0.98] shadow-2xs disabled:opacity-50"
                                title="Kembalikan varian ini ke teks default sistem"
                              >
                                <RotateCcw size={11} />
                                <span>Reset</span>
                              </button>
                            )}
                          </div>

                          {/* Click-to-insert placeholder pills */}
                          <div className="flex flex-wrap items-center gap-1 mb-2">
                            <span className="text-[10px] text-ink-3 font-medium mr-0.5">Sisipkan:</span>
                            {AVAILABLE_PLACEHOLDERS
                              .filter((p) => !(p.tag === '{time}' && (item.type === 'REMINDER_H0' || item.type === 'REMINDER_H1')))
                              .map((p) => (
                              <button
                                key={p.tag}
                                type="button"
                                onClick={() => insertPlaceholder(item.type, item.variant, p.tag)}
                                className="px-1.5 py-0.5 bg-surface hover:bg-accent-soft border border-divider hover:border-accent text-accent rounded text-[10px] font-mono font-bold transition active:scale-95 shadow-2xs"
                                title={`Sisipkan ${p.tag} (${p.label}) ke kursor`}
                              >
                                +{p.tag}
                              </button>
                            ))}
                          </div>

                          {/* Editable Textarea */}
                          <div className="relative">
                            <textarea
                              ref={(el) => {
                                textareaRefs.current[key] = el;
                              }}
                              rows={5}
                              value={item.text}
                              onChange={(e) => updateText(item.type, item.variant, e.target.value)}
                              placeholder="Tulis draf pesan follow-up di sini..."
                              className="w-full p-3 bg-surface border border-divider rounded-xl text-xs text-ink placeholder:text-ink-3 leading-relaxed resize-none focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent shadow-2xs transition"
                            />
                          </div>
                        </div>

                        {/* Card Bottom Bar (Char Count & Action Button) */}
                        <div className="flex items-center justify-between pt-3 mt-2 border-t border-divider dark:border-divider">
                          <div className="flex items-center space-x-1.5">
                            <span className="text-[11px] text-ink-3 font-mono">{charCount} kar</span>
                            {isDirty && (
                              <span className="inline-flex items-center px-1.5 py-0.2 rounded-md bg-warning-soft text-warning text-[10px] font-semibold border border-warning-line">
                                Belum disimpan
                              </span>
                            )}
                          </div>

                          <button
                            onClick={() => handleSave(item.type, item.variant)}
                            disabled={isSaving}
                            className={`h-9 px-4 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition-all duration-150 active:scale-[0.98] shadow-xs ${
                              isJustSaved
                                ? 'bg-success text-on-solid font-bold'
                                : isDirty
                                ? 'bg-accent hover:bg-accent-hover text-accent-ink font-bold ring-2 ring-success'
                                : 'bg-accent hover:bg-accent-hover text-accent-ink'
                            }`}
                          >
                            {isSaving ? (
                              <>
                                <RefreshCw size={12} className="animate-spin" />
                                <span>Menyimpan...</span>
                              </>
                            ) : isJustSaved ? (
                              <>
                                <Check size={13} className="text-white stroke-[3]" />
                                <span>Tersimpan ✓</span>
                              </>
                            ) : (
                              <>
                                <Save size={12} />
                                <span>Simpan</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default FollowUpTemplates;
