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
  Plus,
  Minus,
  Trash2,
  ChevronDown,
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

  // Helpers (reuse Buat Reservasi pattern)
  function isAddonServiceLocal(t: any): boolean {
    if (t?.isAddon === true || t?.category === 'ADD_ON' || t?.serviceType === 'ADD_ON') return true;
    const n = (t?.name || '').toLowerCase();
    return n.includes('moksa') || n.includes('moxa') || n.includes('addon') || n.includes('add-on') || n.includes('tambahan') || n.includes('taping') || n.includes('kinesio') || n.includes('ear candle') || n.includes('nebulizer') || n.includes('potong kuku') || n.includes('tindik');
  }
  interface SelectedTreatmentItem { instanceId: string; serviceId: string; name: string; category: 'BABY' | 'MOMS' | 'BUNDLE' | 'KIDS' | 'ADD_ON'; durationMinutes: number; price: number; isAddon?: boolean; assignedChildIndex?: number }
  interface BabyRow { name: string; ageText: string }

  // Form State with clean empty defaults
  const [dateDisplay, setDateDisplay] = useState('');
  const [timeDisplay, setTimeDisplay] = useState('12.00-12.30');
  const [bundaName, setBundaName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [kecamatan, setKecamatan] = useState('');
  const [kota, setKota] = useState('');
  const [category, setCategory] = useState<'BABY' | 'MOMS' | 'BUNDLE'>('BABY');
  const [childName, setChildName] = useState('');
  const [childAge, setChildAge] = useState('');
  const [babies, setBabies] = useState<BabyRow[]>([]);
  const [treatmentName, setTreatmentName] = useState('Pijat Ceria');
  const [treatmentPrice, setTreatmentPrice] = useState<number>(60000);
  const [selectedTreatments, setSelectedTreatments] = useState<SelectedTreatmentItem[]>([]);
  const [serviceSearch, setServiceSearch] = useState('');
  const [isServiceDropdownOpen, setIsServiceDropdownOpen] = useState(false);
  const [distanceKmInput, setDistanceKmInput] = useState<string>('3.0');
  const distanceKm = useMemo(()=>{ const n=parseFloat((distanceKmInput||'').replace(',', '.')); return isNaN(n)?0:n; }, [distanceKmInput]);
  const [ongkir, setOngkir] = useState<number>(0);
  const [discountPct, setDiscountPct] = useState<number>(0);
  const [copied, setCopied] = useState(false);
  const [mobileTab, setMobileTab] = useState<'setting' | 'preview'>('setting');

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
      setCategory((initialData.treatmentCategory as any) === 'MOMS' ? 'MOMS' : (initialData.treatmentCategory as any)==='BUNDLE' ? 'BUNDLE' : 'BABY');
      setChildName(initialData.childName || '');
      setChildAge(initialData.childAge || '');
      setBabies(initialData.childName ? [{ name: initialData.childName, ageText: initialData.childAge || '' }] : []);
      // Hydrate selectedTreatments from treatmentName “A + B + C”
      const names = (initialData.treatmentName || 'Pijat Ceria').split(/\s*\+\s*/).map(s=>s.trim()).filter(Boolean);
      const priceEach = names.length ? Math.round((Number(initialData.treatmentPrice)||60000)/names.length) : 60000;
      const catFor = (t: string): any => /mom|hamil|laktasi|nifas|breast/i.test(t) ? 'MOMS' : 'BABY';
      setSelectedTreatments(names.map((n,i)=>({ instanceId:`init-${i}-${Date.now()}`, serviceId:`init-${n}`, name:n, category:catFor(n), durationMinutes:60, price: priceEach, isAddon: isAddonServiceLocal({name:n, category:catFor(n)}), assignedChildIndex:0 })));
      setTreatmentName(names.join(' + '));
      setTreatmentPrice(Number(initialData.treatmentPrice) || 60000);
      setDistanceKmInput(String(Number(initialData.distanceKm) || 3.0));
      setOngkir(Number(initialData.ongkir) || 0);
      setDiscountPct(0);
      setServiceSearch('');
      setIsServiceDropdownOpen(false);
    } else if (!isOpen) {
      setSelectedTreatments([]);
    }
  }, [isOpen, initialData]);

  // Keep string fields in sync when selectedTreatments changes (1:1 dengan Buat Reservasi)
  useEffect(() => {
    if (selectedTreatments.length === 0) return;
    const names = selectedTreatments.map(t=>t.name).join(' + ');
    const sum = selectedTreatments.reduce((s,t)=>s+(Number(t.price)||0),0);
    const hasBaby = selectedTreatments.some(t=>t.category==='BABY'||t.category==='KIDS');
    const hasMoms = selectedTreatments.some(t=>t.category==='MOMS');
    setTreatmentName(names);
    setTreatmentPrice(sum);
    if (hasBaby && hasMoms) setCategory('BUNDLE' as any);
    else if (hasMoms && !hasBaby) setCategory('MOMS');
    else if (hasBaby && !hasMoms) setCategory('BABY');
    // sync baby rows count minimal 1
    if (selectedTreatments.length>0 && babies.length===0 && childName) setBabies([{name:childName, ageText: childAge||''}]);
  }, [selectedTreatments]);

  // Auto ongkir dari jarak + diskon % hanya potong treatment (tidak ongkir)
  useEffect(() => {
    const v = Number(distanceKm) || 0;
    if (v <= 3) setOngkir(0); else setOngkir(Math.round((v-3)*3000));
  }, [distanceKm]);
  const discountAmount = useMemo(()=> Math.round((Number(treatmentPrice)||0) * (Number(discountPct)||0) / 100), [treatmentPrice, discountPct]);
  // Auto total calculation
  const totalPrice = useMemo(() => {
    const p = Number(treatmentPrice) || 0;
    const o = Number(ongkir) || 0;
    const d = Number(discountAmount) || 0;
    return Math.max(0, p - d + o);
  }, [treatmentPrice, ongkir, discountAmount]);

  const filteredServices = useMemo(() => {
    const q = serviceSearch.trim().toLowerCase();
    if (!q) return clinicServices;
    return clinicServices.filter(s => s.name.toLowerCase().includes(q) || (s.category||'').toLowerCase().includes(q));
  }, [clinicServices, serviceSearch]);
  const handleAddServiceInstance = (srv: any) => {
    const isAddon = isAddonServiceLocal(srv);
    const hasMain = selectedTreatments.some(t=>!isAddonServiceLocal(t));
    if (isAddon && !hasMain) { toast(`Layanan "${srv.name}" adalah Add-on. Pilih layanan utama dulu.`, 'error'); return; }
    const existing = selectedTreatments.filter(t=>t.serviceId===srv.id).length;
    const nextIdx = Math.min(existing, Math.max(0, babies.length-1));
    const item: SelectedTreatmentItem = { instanceId:`inst-${srv.id}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, serviceId: String(srv.id||srv.name), name: srv.name, category: (srv.category as any) || 'BABY', durationMinutes: srv.durationMinutes||60, price: getServicePrice(srv), isAddon, assignedChildIndex: nextIdx };
    setSelectedTreatments(prev=>[...prev, item]);
  };
  const handleRemoveLastServiceInstance = (serviceId: string) => {
    setSelectedTreatments(prev=>{ const idx = prev.map(t=>t.serviceId).lastIndexOf(String(serviceId)); if(idx===-1) return prev; return prev.filter((_,i)=>i!==idx); });
  };
  const handleRemoveTreatment = (instanceId: string) => setSelectedTreatments(prev=>prev.filter(t=>t.instanceId!==instanceId));

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
    const safeDiscount = Number(discountAmount) || 0;

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

    const treatList = (treatmentName || '').split(/\s*\+\s*/).map(s=>s.trim()).filter(Boolean);
    const isBundle = category === 'BUNDLE' || treatList.length > 1 && (category === 'BABY' || category === 'MOMS');
    if (category === 'BUNDLE' || (treatList.length > 1 && treatList.some(t=>/mom|hamil|laktasi|nifas|breast/i.test(t)))) {
      lines.push('Pilihan treatment (Baby & Moms Bundle)', '', `Nama Bayi : ${(childName || '').trim()}`, `Usia Bayi/Anak : ${(childAge || '').trim()}`, `Treatment : ${treatList.join(' + ')}`);
    } else if (category === 'BABY') {
      if (treatList.length > 1) {
        lines.push('Pilihan treatment (Baby & Kids)', '', `Nama Bayi : ${(childName || '').trim()}`, `Usia Bayi/Anak : ${(childAge || '').trim()}`);
        treatList.forEach((t,i)=> lines.push(`Treatment ${treatList.length>1?i+1:''} : ${t}`.replace(' :',':').trim()));
      } else {
        lines.push('Pilihan treatment (Baby & Kids)', '', `Nama Bayi : ${(childName || '').trim()}`, `Usia Bayi/Anak : ${(childAge || '').trim()}`, `Treatment : ${(treatmentName || '').trim()}`);
      }
    } else {
      if (treatList.length > 1) {
        treatList.forEach((t,i)=> lines.push(`Treatment ${i+1} : ${t}`));
        if (treatList.length===1) lines.push(`Treatment : ${treatList[0]}`);
      } else {
        lines.push('Pilihan treatment (Moms & Hamil)', '', `Treatment : ${(treatmentName || '').trim()}`);
      }
    }
    void isBundle;

    lines.push(
      '',
      'Payment : ',
      `Treatment = ${formatRp(treatmentPrice)}`,
      `Ongkir ${kmStr} km = ${ongkirStr}`
    );

    if (safeDiscount > 0) {
      lines.push(`Diskon ${discountPct}% = - ${formatRp(safeDiscount)}`);
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
    discountPct,
    discountAmount,
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

  const handleSelectService = (_s: any) => { /* replaced by handleAddServiceInstance matching Buat Reservasi */ };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150 overscroll-contain overflow-hidden" style={{ overscrollBehavior: 'contain', touchAction: 'pan-y', overscrollBehaviorX: 'none' as any }}>
      <div
        className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl border border-[#e9edef] flex flex-col max-h-[92vh] overflow-hidden overscroll-contain"
        style={{ overscrollBehavior: 'contain', touchAction: 'pan-y', overscrollBehaviorX: 'none' as any, maxWidth: 'min(100vw - 24px, 56rem)' }}
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

        {/* Modal Body: 2 Columns — di mobile jadi tab Setting / Preview agar keduanya reachable */}
        <div className="flex flex-1 flex-col min-h-0 bg-[#f8fafc] lg:grid lg:grid-cols-12 lg:divide-x divide-[#e9edef]">
          {/* Mobile Tabs */}
          <div className="flex lg:hidden shrink-0 border-b border-[#e9edef] bg-white p-1 gap-1">
            <button
              type="button"
              onClick={() => setMobileTab('setting')}
              className={`flex-1 py-2 rounded-lg text-xs font-bold border transition ${mobileTab === 'setting' ? 'bg-[#008069] text-white border-[#008069]' : 'bg-white text-[#54656f] border-[#d1d7db]'}`}
            >
              ⚙️ Pengaturan
            </button>
            <button
              type="button"
              onClick={() => setMobileTab('preview')}
              className={`flex-1 py-2 rounded-lg text-xs font-bold border transition ${mobileTab === 'preview' ? 'bg-[#008069] text-white border-[#008069]' : 'bg-white text-[#54656f] border-[#d1d7db]'}`}
            >
              👁️ Preview WA
            </button>
          </div>
          <div className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain min-h-0 lg:contents" style={{ overscrollBehavior: 'contain', touchAction: 'pan-y', overscrollBehaviorX: 'none' as any }}>
          {/* Left Column: Form Controls */}
          <div id="inv-tab-setting" className={`${mobileTab === 'preview' ? 'hidden' : ''} lg:!block lg:col-span-7 p-4 sm:p-5 space-y-4 lg:overflow-y-auto lg:max-h-[70vh]`}>
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
                {/* Auto category: BABY/MOMS/BUNDLE diturunkan dari pilihan layanan, tidak ada toggle manual */}
                <div className="text-[10px] px-2 py-1 rounded-full bg-[#e8f5f2] border border-[#c2e7e0] text-[#008069] font-bold">{category==='BUNDLE'?'Bundling':category==='MOMS'?'Moms & Hamil':'Bayi & Kids'}</div>
              </div>


              {/* Service Selection — 1:1 dengan Buat Reservasi Baru */}
              <div className="space-y-2">
                <label className="block text-[11px] font-bold text-[#54656f]">Pilih Layanan / Treatment *</label>
                <div className="relative">
                  <button type="button" onClick={()=>setIsServiceDropdownOpen(!isServiceDropdownOpen)} className="w-full p-2.5 bg-white border border-[#d1d7db] rounded-xl text-xs text-left flex items-center justify-between cursor-pointer">
                    <span className="flex items-center gap-2 truncate font-semibold text-[#54656f]"><Plus size={14} className="text-[#008069]"/> {selectedTreatments.length? `${selectedTreatments.length} treatment dipilih` : '+ Pilih treatment dari katalog...'}</span><ChevronDown size={14} className="text-[#8696a0]"/>
                  </button>
                  {isServiceDropdownOpen && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-[#d1d7db] rounded-2xl shadow-2xl z-40 p-2.5 space-y-2 max-h-72 flex flex-col">
                      <div className="relative shrink-0"><input type="text" value={serviceSearch} onChange={e=>setServiceSearch(e.target.value)} placeholder="Cari layanan..." className="w-full pl-8 pr-3 py-1.5 bg-[#f0f2f5] border border-[#d1d7db] rounded-lg text-xs" autoFocus/><span className="absolute left-2.5 top-2 text-[#8696a0]">🔍</span></div>
                      <div className="divide-y divide-[#e9edef] overflow-y-auto flex-1 pr-1">
                        {filteredServices.map(srv=>{
                          const count = selectedTreatments.filter(t=>t.serviceId===String(srv.id||srv.name)).length;
                          const isAddon = isAddonServiceLocal(srv);
                          return (
                          <div key={String(srv.id||srv.name)} className={`p-2 rounded-lg flex items-center justify-between ${count>0?'bg-[#e8f5f2]/70':''}`}>
                            <div className="min-w-0 pr-2"><div className="flex items-center gap-1.5"><span className="font-bold text-xs truncate">{srv.name}</span><span className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${isAddon?'bg-amber-100 text-amber-800':'bg-[#f0f2f5] text-[#54656f]'}`}>{isAddon?'Add-on':srv.category}</span></div><div className="text-[10px] text-[#667781]">Durasi { (srv as any).durationMinutes||60 }m • <span className="font-bold text-[#008069]">Rp {formatRp(getServicePrice(srv))}</span></div></div>
                            <div className="shrink-0">{count===0 ? <button type="button" onClick={()=>handleAddServiceInstance(srv)} className="px-2.5 py-1 rounded-lg bg-white border border-[#008069] text-[#008069] text-xs font-bold cursor-pointer">+ Pilih</button> : <div className="flex items-center gap-1 bg-white border border-[#c2e7e0] rounded-lg p-0.5"><button type="button" onClick={()=>handleRemoveLastServiceInstance(String(srv.id||srv.name))} className="w-6 h-6 rounded bg-[#f0f2f5] flex items-center justify-center cursor-pointer"><Minus size={11}/></button><span className="w-5 text-center font-extrabold text-xs text-[#008069]">{count}</span><button type="button" onClick={()=>handleAddServiceInstance(srv)} className="w-6 h-6 rounded bg-[#008069] text-white flex items-center justify-center cursor-pointer"><Plus size={11}/></button></div>}</div>
                          </div>
                        )})}
                      </div>
                      <div className="pt-2 border-t flex justify-between items-center shrink-0"><span className="text-[11px] font-semibold text-[#008069]">✓ {selectedTreatments.length} terpilih</span><button type="button" onClick={()=>setIsServiceDropdownOpen(false)} className="px-3.5 py-1.5 bg-[#008069] text-white rounded-lg text-xs font-bold cursor-pointer">Selesai</button></div>
                    </div>
                  )}
                </div>
                {selectedTreatments.length>0 && (
                  <div className="space-y-1.5 p-3 bg-[#f8fafc] border rounded-xl">
                    {selectedTreatments.map((t,idx)=>(
                      <div key={t.instanceId} className="p-2.5 bg-white border rounded-xl text-xs flex justify-between items-center">
                        <span><b>#{idx+1}</b> {t.name} <span className={`ml-1 px-1.5 py-0.2 rounded text-[9px] font-bold ${t.isAddon?'bg-amber-100 text-amber-800':'bg-[#e8f5f2] text-[#008069]'}`}>{t.isAddon?'Add-on':'Utama'}</span> <span className="text-[#008069] font-bold ml-1">Rp {formatRp(t.price)}</span></span>
                        <button type="button" onClick={()=>handleRemoveTreatment(t.instanceId)} className="p-1 text-[#8696a0] hover:text-rose-600 cursor-pointer"><Trash2 size={13}/></button>
                      </div>
                    ))}
                    <div className="text-xs text-[#54656f] font-mono">Subtotal {selectedTreatments.length} layanan: <b className="text-[#111b21]">Rp {formatRp(selectedTreatments.reduce((s,t)=>s+t.price,0))}</b> {category==='BUNDLE' && <span className="ml-2 px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-full text-[10px] font-bold">BUNDLE</span>}</div>
                  </div>
                )}
                {/* Data Anak — 1:1 dengan Buat Reservasi Baru */}
                {(category==='BABY' || category==='BUNDLE') && (
                  <div className="space-y-2 p-3 bg-[#f8fafc] border rounded-xl">
                    <div className="flex items-center justify-between"><span className="text-[11px] font-bold text-[#008069]">Data Anak / Bayi ({babies.length})</span><button type="button" onClick={()=>setBabies([...babies,{name: childName || '', ageText: childAge || ''}])} className="px-2.5 py-1 rounded-lg bg-white border text-[11px] font-bold flex items-center gap-1 cursor-pointer"><Plus size={12}/>+ Tambah Anak</button></div>
                    {babies.length===0 ? <p className="text-[11px] text-[#8696a0] italic">Belum ada data anak (opsional jika Moms saja).</p> : babies.map((b,idx)=>(
                      <div key={idx} className="p-2.5 bg-white border rounded-xl space-y-2">
                        <div className="flex justify-between items-center"><span className="text-xs font-bold">Anak #{idx+1}</span><button type="button" onClick={()=>setBabies(babies.filter((_,i)=>i!==idx))} className="p-1 text-[#8696a0] hover:text-rose-600 cursor-pointer"><Trash2 size={13}/></button></div>
                        <div className="grid grid-cols-2 gap-2"><input value={b.name} onChange={e=>{const n=[...babies]; n[idx]={...n[idx], name:e.target.value}; setBabies(n); setChildName(n[0]?.name||'');}} placeholder="Nama anak" className="p-2 border rounded-lg text-xs"/><input value={b.ageText} onChange={e=>{const n=[...babies]; n[idx]={...n[idx], ageText:e.target.value}; setBabies(n); setChildAge(n[0]?.ageText||'');}} placeholder="Usia (8 bulan)" className="p-2 border rounded-lg text-xs"/></div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Section 4: Ongkir otomatis dari jarak + Diskon % (potong treatment saja) */}
            <div className="p-3.5 bg-white rounded-xl border border-[#e9edef] shadow-2xs space-y-3">
              <div className="flex items-center gap-2 text-[#008069] font-bold text-xs"><Truck size={14}/><span>Ongkir otomatis dari jarak</span><span className="ml-auto text-[11px] font-mono text-[#111b21]">{formatKm(distanceKm)} km</span><span className="text-xs font-bold text-[#111b21]">{ongkir===0?'Free':`Rp ${formatRp(ongkir)}`}</span></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div><label className="block text-[11px] font-semibold text-[#54656f] mb-1">Jarak (km)</label><input type="text" inputMode="decimal" value={distanceKmInput} onChange={e=>setDistanceKmInput(e.target.value)} placeholder="0" className="w-full px-3 py-1.5 bg-[#f8fafc] border rounded-lg text-xs font-semibold"/></div>
                <div className="flex items-end gap-2"><div className="flex-1"><label className="block text-[11px] font-semibold text-rose-600 mb-1 flex items-center gap-1"><Percent size={11}/>Diskon treatment</label><div className="flex gap-1">{[0,10,15,30,50].map(p=>(<button key={p} type="button" onClick={()=>setDiscountPct(p)} className={`flex-1 py-1.5 rounded-lg text-xs font-bold border ${discountPct===p?'bg-rose-600 text-white border-rose-600':'bg-white border-rose-200 text-rose-700'}`}>{p===0?'Tanpa':`${p}%`}</button>))}</div></div></div>
              </div>
              {discountPct>0 && <div className="text-xs text-rose-600 font-mono">Diskon {discountPct}% dari treatment = <b>- Rp {formatRp(discountAmount)}</b> (tidak potong ongkir)</div>}
            </div>
          </div>

          </div>

          {/* Right Column: Live WhatsApp Preview — scrollable di mobile */}
          <div id="inv-tab-preview" className={`${mobileTab === 'setting' ? 'hidden' : ''} lg:!flex lg:col-span-5 p-4 sm:p-5 flex flex-col justify-between bg-[#efeae2]/40 relative overflow-y-auto overflow-x-hidden overscroll-contain max-h-[65vh] lg:max-h-none lg:overflow-visible`} style={{ overscrollBehavior: 'contain', touchAction: 'pan-y', overscrollBehaviorX: 'none' as any }}>
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

              {/* WhatsApp Bubble Simulation — monospace biar preview beraturan (colon aligned) */}
              <div className="p-4 bg-white rounded-2xl rounded-tr-none shadow-md border border-[#e2ddd5] font-mono text-xs text-[#111b21] leading-relaxed whitespace-pre-wrap select-text relative">
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
              {Number(discountAmount) > 0 && (
                <div className="flex justify-between text-xs text-rose-600">
                  <span>Potongan / Promo:</span>
                  <span className="font-semibold">- Rp {formatRp(discountAmount)}</span>
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
