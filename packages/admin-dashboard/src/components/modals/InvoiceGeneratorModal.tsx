import React, { useState, useMemo, useEffect } from 'react';
import {
  X,
  Receipt,
  Copy,
  Send,
  Calendar,
  Clock,
  User,
  Phone,
  Baby,
  Sparkles,
  Check,
  Truck,
  Sparkle,
  Percent,
} from 'lucide-react';
import { ExtractedScheduleData, formatIndonesianDate, cleanBundaName } from '../../utils/chatScheduleExtractor';
import { useUiFeedback } from '../common/UiFeedback';

interface InvoiceGeneratorModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialData?: ExtractedScheduleData | null;
  clinicServices?: Array<{
    id?: string;
    name: string;
    price?: number;
    promoPrice?: number;
    originalPrice?: number;
    category?: string;
  }>;
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

  // Safe Helper Formatters
  const formatRp = (num: any) => {
    if (num === null || num === undefined || isNaN(Number(num))) return '0';
    return Number(num).toLocaleString('id-ID');
  };

  const formatKm = (km: any) => {
    if (km === null || km === undefined || isNaN(Number(km))) return '3,0';
    return Number(km).toFixed(1).replace('.', ',');
  };

  const getServicePrice = (s: any): number => {
    if (!s) return 0;
    return Number(s.promoPrice ?? s.price ?? s.originalPrice ?? 0);
  };

  // Form State with clean empty defaults
  const [dateDisplay, setDateDisplay] = useState('');
  const [timeDisplay, setTimeDisplay] = useState('12.00-12.30');
  const [bundaName, setBundaName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [kecamatan, setKecamatan] = useState('');
  const [kota, setKota] = useState('');
  const [category, setCategory] = useState<'BABY' | 'MOMS'>('BABY');
  const [childName, setChildName] = useState('');
  const [childAge, setChildAge] = useState('');
  const [treatmentName, setTreatmentName] = useState('Pijat Ceria');
  const [treatmentPrice, setTreatmentPrice] = useState<number>(60000);
  const [distanceKm, setDistanceKm] = useState<number>(3.0);
  const [ongkir, setOngkir] = useState<number>(0);
  const [discount, setDiscount] = useState<number>(0);
  const [copied, setCopied] = useState(false);

  // Sync state whenever initialData or isOpen changes
  useEffect(() => {
    if (isOpen && initialData) {
      setDateDisplay(initialData.dateDisplay || formatIndonesianDate(initialData.bookingDate || new Date()));
      setTimeDisplay(initialData.timeDisplay || '12.00-12.30');
      setBundaName(cleanBundaName(initialData.bundaName, initialData.kecamatan, initialData.kota));
      setPhone((initialData.phone || '').trim());
      setAddress((initialData.address || '').trim());
      setKecamatan((initialData.kecamatan || '').trim());
      setKota((initialData.kota || '').trim());
      setCategory(initialData.treatmentCategory === 'MOMS' ? 'MOMS' : 'BABY');
      setChildName(initialData.childName || '');
      setChildAge(initialData.childAge || '');
      setTreatmentName(initialData.treatmentName || 'Pijat Ceria');
      setTreatmentPrice(Number(initialData.treatmentPrice) || 60000);
      setDistanceKm(Number(initialData.distanceKm) || 3.0);
      setOngkir(Number(initialData.ongkir) || 0);
      setDiscount(Number(initialData.discount) || 0);
    }
  }, [isOpen, initialData]);

  // Auto total calculation
  const totalPrice = useMemo(() => {
    const p = Number(treatmentPrice) || 0;
    const o = Number(ongkir) || 0;
    const d = Number(discount) || 0;
    return Math.max(0, p + o - d);
  }, [treatmentPrice, ongkir, discount]);

  // Generate WhatsApp Invoice Text
  const generatedInvoiceText = useMemo(() => {
    const cleanDate = (dateDisplay || '').trim();
    const cleanTime = (timeDisplay || '').trim().replace(/^jam\s*/i, '');
    let dateTimeLine = cleanDate;
    if (cleanTime) {
      dateTimeLine = cleanDate ? `${cleanDate} jam ${cleanTime}` : `jam ${cleanTime}`;
    }

    const kmStr = formatKm(distanceKm);
    const ongkirVal = Number(ongkir) || 0;
    const ongkirStr = ongkirVal === 0 ? 'free' : formatRp(ongkirVal);
    const safeBunda = (bundaName || '').trim();
    const safeAddress = (address || '').trim();
    const safeKec = (kecamatan || '').trim();
    const safeKota = (kota || '').trim();
    const safePhone = (phone || '').trim();
    const safeDiscount = Number(discount) || 0;

    const lines: string[] = [
      'Berikut reservasi 🐣',
      '',
      `Hari dan tanggal :  ${dateTimeLine}`,
      `Nama Bunda:  ${safeBunda}`,
      `Alamat & Shareloc : ${safeAddress}`,
      `Kec : ${safeKec}`,
      `Kota : ${safeKota}`,
      `No. Hp : ${safePhone}`,
      '',
    ];

    if (category === 'BABY') {
      lines.push(
        'Pilihan treatment (Baby & Kids)',
        '',
        `Nama Bayi : ${(childName || '').trim()}`,
        `Usia Bayi/Anak : ${(childAge || '').trim()}`,
        `Treatment : ${(treatmentName || '').trim()}`
      );
    } else {
      lines.push(
        'Pilihan treatment (Moms & Hamil)',
        '',
        `Treatment : ${(treatmentName || '').trim()}`
      );
    }

    lines.push(
      '',
      'Payment : ',
      `Treatment = ${formatRp(treatmentPrice)}`,
      `Ongkir ${kmStr} km = ${ongkirStr}`
    );

    if (safeDiscount > 0) {
      lines.push(`Promo ongkir = - ${formatRp(safeDiscount)}`);
    }

    lines.push(
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
    discount,
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

  const handleSelectService = (s: any) => {
    if (!s) return;
    setTreatmentName(s.name || '');
    setTreatmentPrice(getServicePrice(s));
    if (s.category) {
      const c = String(s.category).toUpperCase();
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
        <div className="px-5 py-3.5 bg-gradient-to-r from-[#008069] to-[#00a884] text-white flex items-center justify-between shadow-xs shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center backdrop-blur-xs">
              <Receipt size={18} className="text-white" />
            </div>
            <div>
              <h3 className="font-bold text-sm sm:text-base leading-tight flex items-center gap-2">
                <span>Draft Rincian Reservasi & Invoice WA</span>
                {initialData?.isExtractedFromChat && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-400 text-amber-950 font-extrabold flex items-center gap-1 shadow-2xs">
                    <Sparkles size={10} />
                    <span>Auto-Extracted dari Chat</span>
                  </span>
                )}
              </h3>
              <p className="text-[11px] text-white/80">
                Verifikasi atau edit rincian reservasi sebelum dikirim ke box chat WhatsApp.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body: 2 Columns */}
        <div className="grid grid-cols-1 lg:grid-cols-12 flex-1 overflow-y-auto divide-y lg:divide-y-0 lg:divide-x divide-[#e9edef] bg-[#f8fafc]">
          {/* Left Column: Form Controls */}
          <div className="lg:col-span-7 p-4 sm:p-5 space-y-4 overflow-y-auto max-h-[70vh]">
            {/* Section 1: Tanggal & Waktu */}
            <div className="p-3.5 bg-white rounded-xl border border-[#e9edef] shadow-2xs space-y-3">
              <div className="flex items-center space-x-2 text-[#008069] font-bold text-xs">
                <Calendar size={14} />
                <span>Jadwal Reservasi</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-semibold text-[#54656f] mb-1">
                    Hari & Tanggal
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
                    Jam Treatment
                  </label>
                  <input
                    type="text"
                    value={timeDisplay}
                    onChange={(e) => setTimeDisplay(e.target.value)}
                    placeholder="e.g. 12.00-12.30"
                    className="w-full px-3 py-1.5 bg-[#f8fafc] border border-[#d1d7db] rounded-lg text-xs font-semibold text-[#111b21] focus:bg-white focus:border-[#008069] focus:outline-none transition"
                  />
                </div>
              </div>
            </div>

            {/* Section 2: Data Pelanggan */}
            <div className="p-3.5 bg-white rounded-xl border border-[#e9edef] shadow-2xs space-y-3">
              <div className="flex items-center space-x-2 text-[#008069] font-bold text-xs">
                <User size={14} />
                <span>Data Pasien & Lokasi</span>
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
                    placeholder="Nama Bunda..."
                    className="w-full px-3 py-1.5 bg-[#f8fafc] border border-[#d1d7db] rounded-lg text-xs font-semibold text-[#111b21] focus:bg-white focus:border-[#008069] focus:outline-none transition"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[#54656f] mb-1">
                    No. Handphone
                  </label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="08..."
                    className="w-full px-3 py-1.5 bg-[#f8fafc] border border-[#d1d7db] rounded-lg text-xs font-semibold text-[#111b21] focus:bg-white focus:border-[#008069] focus:outline-none transition"
                  />
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
                  placeholder="Alamat lengkap..."
                  className="w-full px-3 py-1.5 bg-[#f8fafc] border border-[#d1d7db] rounded-lg text-xs font-semibold text-[#111b21] focus:bg-white focus:border-[#008069] focus:outline-none transition resize-none"
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
                    placeholder="Kecamatan..."
                    className="w-full px-3 py-1.5 bg-[#f8fafc] border border-[#d1d7db] rounded-lg text-xs font-semibold text-[#111b21] focus:bg-white focus:border-[#008069] focus:outline-none transition"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[#54656f] mb-1">
                    Kota / Kab
                  </label>
                  <input
                    type="text"
                    value={kota}
                    onChange={(e) => setKota(e.target.value)}
                    placeholder="Kota..."
                    className="w-full px-3 py-1.5 bg-[#f8fafc] border border-[#d1d7db] rounded-lg text-xs font-semibold text-[#111b21] focus:bg-white focus:border-[#008069] focus:outline-none transition"
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
                    className={`px-2.5 py-1 rounded-md transition cursor-pointer ${
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
                    className={`px-2.5 py-1 rounded-md transition cursor-pointer ${
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
                      placeholder="e.g. Arviano"
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
                      placeholder="e.g. 1 bulan"
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
                {Array.isArray(clinicServices) && clinicServices.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {clinicServices.slice(0, 6).map((srv) => (
                      <button
                        key={srv.name || srv.id}
                        type="button"
                        onClick={() => handleSelectService(srv)}
                        className={`px-2 py-0.5 rounded-md text-[10px] font-medium border transition cursor-pointer ${
                          (treatmentName || '').toLowerCase() === (srv.name || '').toLowerCase()
                            ? 'bg-[#008069] text-white border-[#008069]'
                            : 'bg-white text-[#54656f] border-[#d1d7db] hover:border-[#008069]'
                        }`}
                      >
                        {srv.name} (Rp {formatRp(getServicePrice(srv))})
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Section 4: Ongkir & Potongan Promo */}
            <div className="p-3.5 bg-white rounded-xl border border-[#e9edef] shadow-2xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 text-[#008069] font-bold text-xs">
                  <Truck size={14} />
                  <span>Ongkos Kirim & Promo</span>
                </div>
                <span className="text-[11px] text-[#667781] font-mono">
                  Jarak: <strong className="text-[#111b21]">{formatKm(distanceKm)} km</strong>
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-[11px] font-semibold text-[#54656f] mb-1">
                    Jarak (km)
                  </label>
                  <input
                    type="number"
                    value={distanceKm}
                    onChange={(e) => {
                      const val = Number(e.target.value) || 0;
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
                    Ongkir (Rp)
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
                <div>
                  <label className="block text-[11px] font-semibold text-rose-600 mb-1 flex items-center gap-1">
                    <Percent size={11} />
                    <span>Diskon / Promo (Rp)</span>
                  </label>
                  <input
                    type="number"
                    value={discount}
                    onChange={(e) => setDiscount(Number(e.target.value) || 0)}
                    step={5000}
                    min={0}
                    className="w-full px-3 py-1.5 bg-[#f8fafc] border border-rose-200 rounded-lg text-xs font-bold text-rose-600 focus:bg-white focus:border-rose-500 focus:outline-none transition font-mono"
                  />
                </div>
              </div>

              {/* Quick Ongkir & Promo Shortcuts */}
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-[10px] text-[#8696a0] font-semibold">Shortcut Ongkir:</span>
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

                <div className="h-3 w-px bg-gray-300 mx-1"></div>

                <span className="text-[10px] text-rose-600 font-semibold">Promo:</span>
                <button
                  type="button"
                  onClick={() => setDiscount(0)}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border transition cursor-pointer ${
                    discount === 0 ? 'bg-gray-700 text-white border-gray-700' : 'bg-gray-100 text-gray-700 border-gray-200'
                  }`}
                >
                  Tanpa Diskon
                </button>
                <button
                  type="button"
                  onClick={() => setDiscount(5000)}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-bold border transition cursor-pointer ${
                    discount === 5000 ? 'bg-rose-600 text-white border-rose-600' : 'bg-rose-50 text-rose-700 border-rose-200'
                  }`}
                >
                  -5.000
                </button>
                <button
                  type="button"
                  onClick={() => setDiscount(10000)}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-bold border transition cursor-pointer ${
                    discount === 10000 ? 'bg-rose-600 text-white border-rose-600' : 'bg-rose-50 text-rose-700 border-rose-200'
                  }`}
                >
                  -10.000
                </button>
              </div>
            </div>
          </div>

          {/* Right Column: Live WhatsApp Preview */}
          <div className="lg:col-span-5 p-4 sm:p-5 flex flex-col justify-between bg-[#efeae2]/40 relative">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-1.5 text-xs font-bold text-[#111b21]">
                  <Sparkles size={14} className="text-[#008069]" />
                  <span>Live Preview WhatsApp</span>
                </div>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="px-2.5 py-1 rounded-lg bg-white border border-[#d1d7db] text-[11px] font-semibold text-[#54656f] hover:bg-[#f0f2f5] hover:text-[#111b21] transition flex items-center space-x-1 shadow-2xs cursor-pointer"
                >
                  {copied ? (
                    <>
                      <Check size={12} className="text-emerald-600" />
                      <span className="text-emerald-600 font-bold">Tersalin!</span>
                    </>
                  ) : (
                    <>
                      <Copy size={12} />
                      <span>Salin Format</span>
                    </>
                  )}
                </button>
              </div>

              {/* WhatsApp Bubble Simulation */}
              <div className="p-4 bg-white rounded-2xl rounded-tr-none shadow-md border border-[#e2ddd5] font-sans text-xs text-[#111b21] leading-relaxed whitespace-pre-wrap select-text relative">
                {generatedInvoiceText}
                <div className="text-[10px] text-[#8696a0] text-right mt-2 flex items-center justify-end space-x-1">
                  <span>{new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace(':', '.')}</span>
                  <Check size={12} className="text-sky-500" />
                </div>
              </div>
            </div>

            {/* Total Summary Card */}
            <div className="mt-4 p-3 bg-white rounded-xl border border-[#d1d7db] shadow-xs space-y-1.5">
              <div className="flex justify-between text-xs text-[#667781]">
                <span>Harga Treatment:</span>
                <span className="font-semibold text-[#111b21]">Rp {formatRp(treatmentPrice)}</span>
              </div>
              <div className="flex justify-between text-xs text-[#667781]">
                <span>Ongkos Kirim:</span>
                <span className="font-semibold text-[#111b21]">
                  {Number(ongkir) === 0 ? 'Free' : `Rp ${formatRp(ongkir)}`}
                </span>
              </div>
              {Number(discount) > 0 && (
                <div className="flex justify-between text-xs text-rose-600">
                  <span>Potongan / Promo:</span>
                  <span className="font-semibold">- Rp {formatRp(discount)}</span>
                </div>
              )}
              <div className="pt-1.5 border-t border-[#e9edef] flex justify-between text-sm font-bold text-[#008069]">
                <span>Total Pembayaran:</span>
                <span>Rp {formatRp(totalPrice)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 bg-[#f0f2f5] border-t border-[#e9edef] flex flex-col sm:flex-row justify-between items-center gap-2 shrink-0">
          <div className="text-[11px] text-[#667781] text-center sm:text-left">
            Total Tagihan: <strong className="text-[#008069] font-bold">Rp {formatRp(totalPrice)}</strong>
          </div>
          <div className="flex items-center space-x-2 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-white border border-[#d1d7db] text-xs font-bold text-[#54656f] hover:bg-[#f8fafc] hover:text-[#111b21] transition cursor-pointer shadow-2xs"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={handleCopy}
              className="px-4 py-2 rounded-xl bg-[#e8f5f2] border border-[#c2e7e0] text-xs font-bold text-[#008069] hover:bg-[#c2e7e0] transition flex items-center space-x-1.5 cursor-pointer shadow-2xs"
            >
              <Copy size={14} />
              <span>Salin Format Saja</span>
            </button>
            <button
              type="button"
              onClick={handleInsert}
              className="px-4 py-2 rounded-xl bg-[#008069] hover:bg-[#00a884] text-white text-xs font-bold transition flex items-center space-x-1.5 cursor-pointer shadow-sm active:scale-95"
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
