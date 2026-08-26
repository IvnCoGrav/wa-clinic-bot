import React, { useState, useMemo } from 'react';
import {
  X,
  Receipt,
  Copy,
  Send,
  Calendar,
  Clock,
  User,
  Phone,
  MapPin,
  Baby,
  Sparkles,
  Check,
  Truck,
  Sparkle,
} from 'lucide-react';
import { ExtractedScheduleData } from '../../utils/chatScheduleExtractor';
import { useUiFeedback } from '../common/UiFeedback';

interface InvoiceGeneratorModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialData: ExtractedScheduleData;
  clinicServices?: Array<{ id?: string; name: string; price: number; category?: string }>;
  onInsertToChat: (formattedText: string) => void;
}

export const InvoiceGeneratorModal: React.FC<InvoiceGeneratorModalProps> = ({
  isOpen,
  onClose,
  initialData,
  clinicServices = [],
  onInsertToChat,
}) => {
  const { toast } = useUiFeedback();

  // Form State
  const [dateDisplay, setDateDisplay] = useState(initialData.dateDisplay || '');
  const [timeDisplay, setTimeDisplay] = useState(initialData.timeDisplay || '12.00-12.30');
  const [bundaName, setBundaName] = useState(initialData.bundaName || '');
  const [phone, setPhone] = useState(initialData.phone || '');
  const [address, setAddress] = useState(initialData.address || '');
  const [kecamatan, setKecamatan] = useState(initialData.kecamatan || '');
  const [kota, setKota] = useState(initialData.kota || '');
  const [category, setCategory] = useState<'BABY' | 'MOMS'>(
    initialData.treatmentCategory === 'MOMS' ? 'MOMS' : 'BABY'
  );
  const [childName, setChildName] = useState(initialData.childName || 'leo');
  const [childAge, setChildAge] = useState(initialData.childAge || '3tahun 7 bulan');
  const [treatmentName, setTreatmentName] = useState(initialData.treatmentName || 'pijat ceria');
  const [treatmentPrice, setTreatmentPrice] = useState<number>(initialData.treatmentPrice || 60000);
  const [distanceKm, setDistanceKm] = useState<number>(initialData.distanceKm || 3.0);
  const [ongkir, setOngkir] = useState<number>(initialData.ongkir ?? 0);
  const [copied, setCopied] = useState(false);

  // Auto total
  const totalPrice = useMemo(() => {
    return Math.max(0, (treatmentPrice || 0) + (ongkir || 0));
  }, [treatmentPrice, ongkir]);

  // Format Ribuan Indonesia (e.g. 60.000)
  const formatRp = (num: number) => {
    return num.toLocaleString('id-ID');
  };

  // Format Jarak KM desimal koma Indonesia (e.g. 3,0 km)
  const formatKm = (km: number) => {
    return km.toFixed(1).replace('.', ',');
  };

  // Generate WhatsApp Invoice Text
  const generatedInvoiceText = useMemo(() => {
    // Normalisasi Hari dan Tanggal & Jam
    let dateTimeLine = dateDisplay.trim();
    if (timeDisplay.trim()) {
      const cleanTime = timeDisplay.trim().replace(/^jam\s*/i, '');
      dateTimeLine = `${dateTimeLine} jam ${cleanTime}`;
    }

    // Ongkir string
    const kmStr = formatKm(distanceKm);
    const ongkirStr = ongkir === 0 ? 'free' : formatRp(ongkir);

    const lines: string[] = [
      'Berikut reservasi 🐣',
      '',
      `Hari dan tanggal :  ${dateTimeLine}`,
      `Nama Bunda:  ${bundaName}`,
      `Alamat & Shareloc : ${address}`,
      `Kec : ${kecamatan}`,
      `Kota : ${kota}`,
      `No. Hp : ${phone}`,
      '',
    ];

    if (category === 'BABY') {
      lines.push(
        'Pilihan treatment (Baby & Kids)',
        '',
        `Nama Bayi : ${childName}`,
        `Usia Bayi/Anak : ${childAge}`,
        `Treatment : ${treatmentName}`
      );
    } else {
      lines.push(
        'Pilihan treatment (Moms & Hamil)',
        '',
        `Treatment : ${treatmentName}`
      );
    }

    lines.push(
      '',
      'Payment : ',
      `Treatment = ${formatRp(treatmentPrice)}`,
      `Ongkir ${kmStr} km = ${ongkirStr}`,
      `Total = ${formatRp(totalPrice)}`,
      '',
      'H-1 sebelum treatment akan kami reminder kembali bunda 🥰',
      'Terimakasih.  ☺️'
    );

    return lines.join('\n');
  }, [
    dateDisplay,
    timeDisplay,
    bundaName,
    address,
    kecamatan,
    kota,
    phone,
    category,
    childName,
    childAge,
    treatmentName,
    treatmentPrice,
    distanceKm,
    ongkir,
    totalPrice,
  ]);

  if (!isOpen) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(generatedInvoiceText);
      setCopied(true);
      toast('Format invoice WhatsApp berhasil disalin ke clipboard! 📋', 'success');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast('Gagal menyalin ke clipboard', 'error');
    }
  };

  const handleInsert = () => {
    onInsertToChat(generatedInvoiceText);
    toast('Format rincian invoice WhatsApp berhasil dimasukkan ke box chat! 🐣', 'success');
    onClose();
  };

  const handleSelectService = (s: { name: string; price: number; category?: string }) => {
    setTreatmentName(s.name);
    setTreatmentPrice(s.price);
    if (s.category) {
      const c = s.category.toUpperCase();
      if (c.includes('MOM') || c.includes('HAMIL') || c.includes('LAKTASI') || c.includes('NIFAS')) {
        setCategory('MOMS');
      } else {
        setCategory('BABY');
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl border border-[#e9edef] flex flex-col max-h-[92vh] overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 py-3.5 bg-gradient-to-r from-[#008069] to-[#00a884] text-white flex items-center justify-between shadow-xs">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center backdrop-blur-xs">
              <Receipt size={18} className="text-white" />
            </div>
            <div>
              <h3 className="font-bold text-sm sm:text-base leading-tight flex items-center gap-2">
                <span>Draft Rincian Reservasi & Invoice WA</span>
                {initialData.isExtractedFromChat && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-400 text-amber-950 font-extrabold flex items-center gap-1 shadow-2xs">
                    <Sparkles size={10} />
                    <span>Auto-Extracted dari Chat</span>
                  </span>
                )}
              </h3>
              <p className="text-[11px] text-white/80">
                Periksa & sesuaikan tanggal, jam, atau ongkir sebelum dikirim ke Bunda
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-white/20 text-white/90 hover:text-white transition active:scale-95 cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body: Two Columns */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 grid grid-cols-1 lg:grid-cols-12 gap-5 bg-[#f8fafc]">
          {/* Left Column: Form Controls (7 Cols) */}
          <div className="lg:col-span-7 space-y-4">
            {/* Section 1: Jadwal & Waktu */}
            <div className="p-3.5 bg-white rounded-xl border border-[#e9edef] shadow-2xs space-y-3">
              <div className="flex items-center space-x-2 text-[#008069] font-bold text-xs">
                <Calendar size={14} />
                <span>Jadwal Kunjungan</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-semibold text-[#54656f] mb-1">
                    Hari dan Tanggal
                  </label>
                  <input
                    type="text"
                    value={dateDisplay}
                    onChange={(e) => setDateDisplay(e.target.value)}
                    placeholder="e.g. Kamis 27 Agustus 2026"
                    className="w-full px-3 py-1.5 bg-[#f8fafc] border border-[#d1d7db] rounded-lg text-xs font-semibold text-[#111b21] focus:bg-white focus:border-[#008069] focus:outline-none transition"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[#54656f] mb-1">
                    Jam Kunjungan
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={timeDisplay}
                      onChange={(e) => setTimeDisplay(e.target.value)}
                      placeholder="e.g. 12.00-12.30"
                      className="w-full px-3 py-1.5 bg-[#f8fafc] border border-[#d1d7db] rounded-lg text-xs font-semibold text-[#111b21] focus:bg-white focus:border-[#008069] focus:outline-none transition"
                    />
                    <Clock size={13} className="absolute right-2.5 top-2.5 text-[#8696a0]" />
                  </div>
                </div>
              </div>
            </div>

            {/* Section 2: Data Bunda & Alamat */}
            <div className="p-3.5 bg-white rounded-xl border border-[#e9edef] shadow-2xs space-y-3">
              <div className="flex items-center space-x-2 text-[#008069] font-bold text-xs">
                <User size={14} />
                <span>Data Bunda & Lokasi</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-semibold text-[#54656f] mb-1">
                    Nama Bunda
                  </label>
                  <input
                    type="text"
                    value={bundaName}
                    onChange={(e) => setBundaName(e.target.value)}
                    className="w-full px-3 py-1.5 bg-[#f8fafc] border border-[#d1d7db] rounded-lg text-xs font-semibold text-[#111b21] focus:bg-white focus:border-[#008069] focus:outline-none transition"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[#54656f] mb-1">
                    No. WhatsApp
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full px-3 py-1.5 bg-[#f8fafc] border border-[#d1d7db] rounded-lg text-xs font-semibold text-[#111b21] focus:bg-white focus:border-[#008069] focus:outline-none transition font-mono"
                    />
                    <Phone size={13} className="absolute right-2.5 top-2.5 text-[#8696a0]" />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#54656f] mb-1">
                  Alamat & Shareloc
                </label>
                <textarea
                  rows={2}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Alamat lengkap / patokan..."
                  className="w-full px-3 py-1.5 bg-[#f8fafc] border border-[#d1d7db] rounded-lg text-xs text-[#111b21] focus:bg-white focus:border-[#008069] focus:outline-none transition resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-semibold text-[#54656f] mb-1">
                    Kecamatan
                  </label>
                  <input
                    type="text"
                    value={kecamatan}
                    onChange={(e) => setKecamatan(e.target.value)}
                    placeholder="e.g. Sedati"
                    className="w-full px-3 py-1.5 bg-[#f8fafc] border border-[#d1d7db] rounded-lg text-xs text-[#111b21] focus:bg-white focus:border-[#008069] focus:outline-none transition"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[#54656f] mb-1">
                    Kota
                  </label>
                  <input
                    type="text"
                    value={kota}
                    onChange={(e) => setKota(e.target.value)}
                    placeholder="e.g. Sidoarjo"
                    className="w-full px-3 py-1.5 bg-[#f8fafc] border border-[#d1d7db] rounded-lg text-xs text-[#111b21] focus:bg-white focus:border-[#008069] focus:outline-none transition"
                  />
                </div>
              </div>
            </div>

            {/* Section 3: Treatment & Anak */}
            <div className="p-3.5 bg-white rounded-xl border border-[#e9edef] shadow-2xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 text-[#008069] font-bold text-xs">
                  <Baby size={14} />
                  <span>Layanan & Pasien</span>
                </div>
                {/* Segmented Switch Category */}
                <div className="flex p-0.5 bg-[#f0f2f5] rounded-lg text-[10px] font-bold">
                  <button
                    type="button"
                    onClick={() => setCategory('BABY')}
                    className={`px-2.5 py-1 rounded-md transition ${
                      category === 'BABY'
                        ? 'bg-white text-[#008069] shadow-xs'
                        : 'text-[#667781] hover:text-[#111b21]'
                    }`}
                  >
                    Baby & Kids
                  </button>
                  <button
                    type="button"
                    onClick={() => setCategory('MOMS')}
                    className={`px-2.5 py-1 rounded-md transition ${
                      category === 'MOMS'
                        ? 'bg-white text-[#008069] shadow-xs'
                        : 'text-[#667781] hover:text-[#111b21]'
                    }`}
                  >
                    Moms & Hamil
                  </button>
                </div>
              </div>

              {category === 'BABY' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 p-2 bg-emerald-50/50 rounded-lg border border-emerald-100">
                  <div>
                    <label className="block text-[11px] font-semibold text-[#008069] mb-1">
                      Nama Bayi / Anak
                    </label>
                    <input
                      type="text"
                      value={childName}
                      onChange={(e) => setChildName(e.target.value)}
                      placeholder="e.g. leo"
                      className="w-full px-3 py-1.5 bg-white border border-[#d1d7db] rounded-lg text-xs font-bold text-[#111b21] focus:border-[#008069] focus:outline-none transition"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-[#008069] mb-1">
                      Usia Bayi / Anak
                    </label>
                    <input
                      type="text"
                      value={childAge}
                      onChange={(e) => setChildAge(e.target.value)}
                      placeholder="e.g. 3tahun 7 bulan"
                      className="w-full px-3 py-1.5 bg-white border border-[#d1d7db] rounded-lg text-xs font-bold text-[#111b21] focus:border-[#008069] focus:outline-none transition"
                    />
                  </div>
                </div>
              )}

              {/* Service Selection */}
              <div className="space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-semibold text-[#54656f] mb-1">
                      Pilihan Treatment
                    </label>
                    <input
                      type="text"
                      value={treatmentName}
                      onChange={(e) => setTreatmentName(e.target.value)}
                      placeholder="Nama treatment..."
                      className="w-full px-3 py-1.5 bg-[#f8fafc] border border-[#d1d7db] rounded-lg text-xs font-semibold text-[#111b21] focus:bg-white focus:border-[#008069] focus:outline-none transition"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-[#54656f] mb-1">
                      Harga Treatment (Rp)
                    </label>
                    <input
                      type="number"
                      value={treatmentPrice}
                      onChange={(e) => setTreatmentPrice(Number(e.target.value) || 0)}
                      step={5000}
                      className="w-full px-3 py-1.5 bg-[#f8fafc] border border-[#d1d7db] rounded-lg text-xs font-bold text-[#111b21] focus:bg-white focus:border-[#008069] focus:outline-none transition font-mono"
                    />
                  </div>
                </div>

                {/* Quick Catalog Chips */}
                {clinicServices.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {clinicServices.slice(0, 6).map((srv) => (
                      <button
                        key={srv.name}
                        type="button"
                        onClick={() => handleSelectService(srv)}
                        className={`px-2 py-0.5 rounded-md text-[10px] font-medium border transition cursor-pointer ${
                          treatmentName.toLowerCase() === srv.name.toLowerCase()
                            ? 'bg-[#008069] text-white border-[#008069]'
                            : 'bg-white text-[#54656f] border-[#d1d7db] hover:border-[#008069]'
                        }`}
                      >
                        {srv.name} (Rp {formatRp(srv.price)})
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Section 4: Ongkir & Kalkulasi Jarak */}
            <div className="p-3.5 bg-white rounded-xl border border-[#e9edef] shadow-2xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 text-[#008069] font-bold text-xs">
                  <Truck size={14} />
                  <span>Ongkos Kirim & Jarak</span>
                </div>
                <span className="text-[11px] text-[#667781] font-mono">
                  Jarak: <strong className="text-[#111b21]">{formatKm(distanceKm)} km</strong>
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-semibold text-[#54656f] mb-1">
                    Jarak Tempuh (km)
                  </label>
                  <input
                    type="number"
                    value={distanceKm}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setDistanceKm(val);
                      if (val <= 3.0) setOngkir(0);
                      else setOngkir(Math.round((val - 3.0) * 3000));
                    }}
                    step={0.5}
                    min={0}
                    className="w-full px-3 py-1.5 bg-[#f8fafc] border border-[#d1d7db] rounded-lg text-xs font-semibold text-[#111b21] focus:bg-white focus:border-[#008069] focus:outline-none transition"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[#54656f] mb-1">
                    Nominal Ongkir (Rp)
                  </label>
                  <input
                    type="number"
                    value={ongkir}
                    onChange={(e) => setOngkir(Number(e.target.value) || 0)}
                    step={5000}
                    min={0}
                    className="w-full px-3 py-1.5 bg-[#f8fafc] border border-[#d1d7db] rounded-lg text-xs font-bold text-[#111b21] focus:bg-white focus:border-[#008069] focus:outline-none transition font-mono"
                  />
                </div>
              </div>

              {/* Quick Ongkir Shortcuts */}
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-[10px] text-[#8696a0] font-semibold">Pilih Cepat:</span>
                <button
                  type="button"
                  onClick={() => setOngkir(0)}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-bold border transition cursor-pointer ${
                    ongkir === 0
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                  }`}
                >
                  Free (0)
                </button>
                <button
                  type="button"
                  onClick={() => setOngkir(10000)}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border transition cursor-pointer ${
                    ongkir === 10000
                      ? 'bg-sky-600 text-white border-sky-600'
                      : 'bg-sky-50 text-sky-800 border-sky-200 hover:bg-sky-100'
                  }`}
                >
                  10.000
                </button>
                <button
                  type="button"
                  onClick={() => setOngkir(15000)}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border transition cursor-pointer ${
                    ongkir === 15000
                      ? 'bg-sky-600 text-white border-sky-600'
                      : 'bg-sky-50 text-sky-800 border-sky-200 hover:bg-sky-100'
                  }`}
                >
                  15.000
                </button>
                <button
                  type="button"
                  onClick={() => setOngkir(20000)}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border transition cursor-pointer ${
                    ongkir === 20000
                      ? 'bg-sky-600 text-white border-sky-600'
                      : 'bg-sky-50 text-sky-800 border-sky-200 hover:bg-sky-100'
                  }`}
                >
                  20.000
                </button>
                <button
                  type="button"
                  onClick={() => setOngkir(25000)}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border transition cursor-pointer ${
                    ongkir === 25000
                      ? 'bg-sky-600 text-white border-sky-600'
                      : 'bg-sky-50 text-sky-800 border-sky-200 hover:bg-sky-100'
                  }`}
                >
                  25.000
                </button>
              </div>
            </div>
          </div>

          {/* Right Column: Live WhatsApp Preview (5 Cols) */}
          <div className="lg:col-span-5 flex flex-col space-y-3">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-bold text-[#54656f] uppercase tracking-wider flex items-center gap-1.5">
                <Sparkle size={13} className="text-emerald-600" />
                <span>Live Preview Pesan WhatsApp</span>
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 font-bold">
                Total: Rp {formatRp(totalPrice)}
              </span>
            </div>

            {/* WhatsApp Bubble Mockup */}
            <div className="flex-1 bg-[#efeae2] p-3 sm:p-4 rounded-2xl border border-[#d1d7db] shadow-inner flex flex-col justify-between relative overflow-hidden min-h-[380px]">
              {/* WhatsApp Wallpaper Texture Overlay */}
              <div
                className="absolute inset-0 opacity-[0.04] pointer-events-none"
                style={{
                  backgroundImage: `radial-gradient(#000 1px, transparent 1px)`,
                  backgroundSize: '16px 16px',
                }}
              />

              {/* Message Bubble */}
              <div className="bg-white rounded-2xl rounded-tl-none p-3.5 shadow-md border border-black/5 max-w-[96%] relative z-10 space-y-2">
                <p className="text-[11px] font-bold text-[#008069] flex items-center gap-1">
                  <span>Klinik Homecare</span>
                  <span className="text-[9px] px-1 bg-emerald-100 rounded text-emerald-800">CS</span>
                </p>
                <div className="text-xs text-[#111b21] leading-relaxed whitespace-pre-wrap font-sans select-text">
                  {generatedInvoiceText}
                </div>
                <div className="flex justify-end items-center space-x-1 pt-1 text-[10px] text-[#8696a0]">
                  <span>{new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace(':', '.')}</span>
                  <Check size={12} className="text-[#53bdeb]" />
                </div>
              </div>

              {/* Summary Bottom Bar */}
              <div className="mt-3 p-3 bg-white/95 backdrop-blur-xs rounded-xl border border-black/10 shadow-sm relative z-10 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-semibold text-[#667781]">Total Biaya</p>
                  <p className="text-sm font-extrabold text-[#008069]">
                    Rp {formatRp(totalPrice)}
                  </p>
                </div>
                <div className="text-right text-[10px] text-[#667781]">
                  <p>Layanan: Rp {formatRp(treatmentPrice)}</p>
                  <p>Ongkir: {ongkir === 0 ? 'Free' : `Rp ${formatRp(ongkir)}`}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="px-5 py-3.5 bg-white border-t border-[#e9edef] flex flex-wrap items-center justify-between gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-[#d1d7db] hover:bg-[#f8fafc] text-xs font-semibold text-[#54656f] transition active:scale-95 cursor-pointer"
          >
            Batal
          </button>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={handleCopy}
              className="px-3.5 py-2 bg-[#f0f2f5] hover:bg-[#e9edef] text-[#111b21] text-xs font-bold rounded-xl transition shadow-2xs flex items-center space-x-1.5 active:scale-95 cursor-pointer"
            >
              <Copy size={14} className={copied ? 'text-emerald-600' : 'text-[#54656f]'} />
              <span>{copied ? 'Tersalin!' : 'Salin Format Saja'}</span>
            </button>

            <button
              type="button"
              onClick={handleInsert}
              className="px-5 py-2 bg-[#008069] hover:bg-[#00a884] text-white text-xs font-extrabold rounded-xl transition shadow-md flex items-center space-x-2 active:scale-95 cursor-pointer"
            >
              <Send size={14} />
              <span>Masukkan ke Chat WA</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
