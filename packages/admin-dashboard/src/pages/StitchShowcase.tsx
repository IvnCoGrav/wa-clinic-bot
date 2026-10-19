import React, { useState } from 'react';
import {
  MessageSquare,
  Calendar,
  CheckCircle2,
  Clock,
  TrendingUp,
  Users,
  Settings,
  Sparkles,
  Bot,
  MapPin,
  Phone,
  ShieldCheck,
  AlertCircle,
  Filter,
  Search,
  Plus,
  ChevronRight,
  Send,
  Layers,
  DollarSign,
  Truck,
  BookOpen,
  Activity,
  Award,
  Globe,
  Radio,
  FileText,
  UserCheck,
  Tag,
  ArrowUpRight,
  Check,
  Smartphone,
  Monitor
} from 'lucide-react';

export const StitchShowcase: React.FC = () => {
  const [activeTierFilter, setActiveTierFilter] = useState<'all' | 'tier1' | 'tier2' | 'tier3' | 'tier4' | 'tier5'>('all');
  const [devicePreview, setDevicePreview] = useState<'desktop' | 'mobile'>('desktop');

  return (
    <div className="min-h-screen bg-[#f0f2f5] font-sans text-[#111b21]">
      {/* Top Export Header for Google Stitch */}
      <header className="sticky top-0 z-50 border-b border-[#d1d7db] bg-white px-6 py-4 shadow-xs">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#008069] text-white shadow-xs">
              <Bot className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight text-[#111b21]">
                  WhatsApp Clinic Bot — Google Stitch Showcase Canvas
                </h1>
                <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 border border-emerald-200">
                  Ready for Stitch Import
                </span>
              </div>
              <p className="text-xs text-[#54656f]">
                Rangkuman lengkap UI/UX 20 Halaman Dashboard diurutkan dari frekuensi penggunaan tertinggi ke terendah.
              </p>
            </div>
          </div>

          {/* Quick Filters */}
          <div className="flex items-center gap-2">
            <div className="flex rounded-xl bg-[#f0f2f5] p-1 text-xs font-medium">
              <button
                onClick={() => setActiveTierFilter('all')}
                className={`rounded-lg px-3 py-1.5 transition-all ${
                  activeTierFilter === 'all'
                    ? 'bg-white text-[#008069] shadow-xs font-semibold'
                    : 'text-[#54656f] hover:text-[#111b21]'
                }`}
              >
                Semua Halaman (20)
              </button>
              <button
                onClick={() => setActiveTierFilter('tier1')}
                className={`rounded-lg px-3 py-1.5 transition-all ${
                  activeTierFilter === 'tier1'
                    ? 'bg-white text-[#008069] shadow-xs font-semibold'
                    : 'text-[#54656f] hover:text-[#111b21]'
                }`}
              >
                ⭐ Tier 1: Core Harian (4)
              </button>
              <button
                onClick={() => setActiveTierFilter('tier2')}
                className={`rounded-lg px-3 py-1.5 transition-all ${
                  activeTierFilter === 'tier2'
                    ? 'bg-white text-[#008069] shadow-xs font-semibold'
                    : 'text-[#54656f] hover:text-[#111b21]'
                }`}
              >
                Tier 2: CRM (3)
              </button>
              <button
                onClick={() => setActiveTierFilter('tier3')}
                className={`rounded-lg px-3 py-1.5 transition-all ${
                  activeTierFilter === 'tier3'
                    ? 'bg-white text-[#008069] shadow-xs font-semibold'
                    : 'text-[#54656f] hover:text-[#111b21]'
                }`}
              >
                Tier 3: Katalog (4)
              </button>
              <button
                onClick={() => setActiveTierFilter('tier4')}
                className={`rounded-lg px-3 py-1.5 transition-all ${
                  activeTierFilter === 'tier4'
                    ? 'bg-white text-[#008069] shadow-xs font-semibold'
                    : 'text-[#54656f] hover:text-[#111b21]'
                }`}
              >
                Tier 4: AI & Ads (5)
              </button>
              <button
                onClick={() => setActiveTierFilter('tier5')}
                className={`rounded-lg px-3 py-1.5 transition-all ${
                  activeTierFilter === 'tier5'
                    ? 'bg-white text-[#008069] shadow-xs font-semibold'
                    : 'text-[#54656f] hover:text-[#111b21]'
                }`}
              >
                Tier 5: Sistem (4)
              </button>
            </div>

            <div className="hidden sm:flex items-center border-l border-[#d1d7db] pl-3">
              <button
                onClick={() => setDevicePreview(devicePreview === 'desktop' ? 'mobile' : 'desktop')}
                className="flex items-center gap-1.5 rounded-xl border border-[#d1d7db] bg-white px-3 py-1.5 text-xs font-medium text-[#54656f] hover:bg-slate-50"
              >
                {devicePreview === 'desktop' ? (
                  <>
                    <Monitor className="h-3.5 w-3.5 text-[#008069]" /> Desktop View
                  </>
                ) : (
                  <>
                    <Smartphone className="h-3.5 w-3.5 text-[#008069]" /> Mobile Frame
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className={`mx-auto p-4 sm:p-6 lg:p-8 transition-all ${devicePreview === 'mobile' ? 'max-w-md' : 'max-w-7xl'}`}>
        
        {/* ========================================================================= */}
        {/* TIER 1: CORE HARIAN & REAL-TIME (Paling Sering Digunakan) */}
        {/* ========================================================================= */}
        {(activeTierFilter === 'all' || activeTierFilter === 'tier1') && (
          <section id="tier-1" className="mb-14">
            <div className="mb-4 flex items-center justify-between border-b border-[#d1d7db] pb-3">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-[#008069]">
                  Prioritas 1 • Harian & Real-time
                </span>
                <h2 className="text-xl font-bold text-[#111b21]">
                  Tier 1: Core Operations & Live Chat
                </h2>
              </div>
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                Paling Sering Digunakan
              </span>
            </div>

            <div className="grid grid-cols-1 gap-8">
              {/* 1. LIVE CHAT WHATSAPP */}
              <div className="overflow-hidden rounded-2xl border border-[#e9edef] bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-[#e9edef] bg-[#f8fafc] px-5 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#008069] text-white">
                      <MessageSquare className="h-4 w-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-[#111b21]">1. Live Chat WhatsApp</h3>
                      <p className="text-[11px] text-[#54656f]">/admin/live-chat • Monitor percakapan real-time & intervensi AI</p>
                    </div>
                  </div>
                  <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 border border-emerald-200">
                    Active Session
                  </span>
                </div>

                {/* Simulated Live Chat Interface */}
                <div className="grid grid-cols-1 md:grid-cols-12 min-h-[420px]">
                  {/* Left Chat List */}
                  <div className="border-r border-[#e9edef] md:col-span-4 bg-white">
                    <div className="p-3 border-b border-[#e9edef]">
                      <div className="relative">
                        <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-[#8696a0]" />
                        <input
                          type="text"
                          placeholder="Cari chat atau pasien..."
                          readOnly
                          value="Ibu Anisa"
                          className="w-full rounded-lg bg-[#f0f2f5] py-1.5 pl-8 pr-3 text-xs text-[#111b21] outline-none"
                        />
                      </div>
                    </div>
                    <div className="divide-y divide-[#f0f2f5]">
                      <div className="flex cursor-pointer items-start gap-3 bg-[#e8f5f2] p-3 transition-colors">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#008069] text-xs font-bold text-white">
                          AN
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between">
                            <h4 className="truncate text-xs font-semibold text-[#111b21]">Ibu Anisa (Baby Ken)</h4>
                            <span className="text-[10px] text-[#008069] font-medium">10:45</span>
                          </div>
                          <p className="truncate text-[11px] text-[#54656f]">
                            Bunda: Mau tanya slot pijat batuk pilek sore ini jam 15 ada?
                          </p>
                          <div className="mt-1 flex items-center gap-1.5">
                            <span className="rounded bg-emerald-100 px-1.5 py-0.2 text-[10px] font-semibold text-emerald-800">
                              AI Active
                            </span>
                            <span className="rounded bg-sky-100 px-1.5 py-0.2 text-[10px] font-semibold text-sky-800">
                              Tanya Jadwal
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex cursor-pointer items-start gap-3 p-3 hover:bg-slate-50 transition-colors">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-300 text-xs font-bold text-[#111b21]">
                          DW
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between">
                            <h4 className="truncate text-xs font-medium text-[#111b21]">Ibu Dewi Sartika</h4>
                            <span className="text-[10px] text-[#8696a0]">09:12</span>
                          </div>
                          <p className="truncate text-[11px] text-[#8696a0]">
                            Bidan kami sudah meluncur ya Bu, estimasi tiba 15 menit lagi.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right Chat Conversation */}
                  <div className="flex flex-col md:col-span-8 bg-[#efeae2]/40">
                    <div className="flex items-center justify-between border-b border-[#e9edef] bg-white px-4 py-2.5">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-[#008069] text-white flex items-center justify-center text-xs font-bold">
                          AN
                        </div>
                        <div>
                          <div className="text-xs font-bold text-[#111b21]">Ibu Anisa (Baby Ken - 8 Bulan)</div>
                          <div className="text-[10px] text-[#54656f]">Home Care • Kebayoran Baru, Jakarta Selatan</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button className="rounded-lg border border-[#d1d7db] bg-white px-2.5 py-1 text-xs font-semibold text-[#008069] shadow-2xs hover:bg-emerald-50">
                          Ambil Alih Manual
                        </button>
                      </div>
                    </div>

                    <div className="flex-1 space-y-3 p-4">
                      {/* Customer Incoming Bubble */}
                      <div className="flex justify-start">
                        <div className="max-w-[75%] rounded-2xl rounded-tl-xs bg-white p-3 shadow-xs border border-[#e9edef]">
                          <p className="text-xs text-[#111b21]">
                            Halo Bidan, baby Ken (8 bulan) lagi bapil dan agak rewel. Apakah sore ini ada slot kosong buat pijat batuk pilek di rumah?
                          </p>
                          <span className="mt-1 block text-right text-[10px] text-[#8696a0]">10:44</span>
                        </div>
                      </div>

                      {/* Bot Outgoing Bubble */}
                      <div className="flex justify-end">
                        <div className="max-w-[75%] rounded-2xl rounded-tr-xs bg-[#d9fdd3] p-3 shadow-xs border border-[#c4f3bd]">
                          <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold text-[#008069]">
                            <Sparkles className="h-3 w-3" /> AI Assistant (Bidan Care)
                          </div>
                          <p className="text-xs text-[#111b21]">
                            Halo Bunda Anisa. Untuk sore ini slot fisioterapi batuk pilek tersedia pukul 15.30 dan 16.30 bersama Bidan Rina. Apakah Bunda berkenan kami jadwalkan di pukul 15.30?
                          </p>
                          <span className="mt-1 flex items-center justify-end gap-1 text-[10px] text-[#54656f]">
                            10:45 <Check className="h-3 w-3 text-[#008069]" />
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Chat Input Bar */}
                    <div className="border-t border-[#e9edef] bg-white p-3">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          readOnly
                          placeholder="Ketik pesan atau ketik / untuk balasan cepat..."
                          className="flex-1 rounded-xl border border-[#d1d7db] px-3 py-2 text-xs text-[#111b21] outline-none"
                        />
                        <button className="rounded-xl bg-[#008069] p-2 text-white hover:bg-[#00a884]">
                          <Send className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* 2. KALENDER & RESERVASI */}
              <div className="overflow-hidden rounded-2xl border border-[#e9edef] bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-[#e9edef] bg-[#f8fafc] px-5 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#008069] text-white">
                      <Calendar className="h-4 w-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-[#111b21]">2. Kalender & Reservasi Booking</h3>
                      <p className="text-[11px] text-[#54656f]">/admin/reservations • Kalender jadwal, slot bidan, & status konfirmasi</p>
                    </div>
                  </div>
                  <button className="flex items-center gap-1.5 rounded-lg bg-[#008069] px-3 py-1.5 text-xs font-semibold text-white shadow-xs">
                    <Plus className="h-3.5 w-3.5" /> Tambah Reservasi
                  </button>
                </div>

                <div className="p-5">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-[#111b21]">Senin, 19 Oktober 2026</span>
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 border border-emerald-200">
                        8 Slot Terisi
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <button className="rounded-md border border-[#d1d7db] bg-white px-2.5 py-1 font-semibold text-[#111b21]">Hari</button>
                      <button className="rounded-md bg-[#008069] px-2.5 py-1 font-semibold text-white">Minggu</button>
                      <button className="rounded-md border border-[#d1d7db] bg-white px-2.5 py-1 font-semibold text-[#111b21]">Bulan</button>
                    </div>
                  </div>

                  {/* Slot Cards Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3.5">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="font-bold text-emerald-900">09:00 - 10:00 WIB</span>
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">CONFIRMED</span>
                      </div>
                      <div className="text-xs font-bold text-[#111b21]">Ibu Maya (Baby Arka - 4 Bln)</div>
                      <div className="text-[11px] text-[#54656f] mt-0.5">Pijat Bayi Relaksasi • Bidan Siti</div>
                      <div className="mt-2 text-[11px] font-semibold text-emerald-800">Rp 135.000 (Lunas)</div>
                    </div>

                    <div className="rounded-xl border border-sky-200 bg-sky-50/50 p-3.5">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="font-bold text-sky-900">11:00 - 12:00 WIB</span>
                        <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-800">SCHEDULED</span>
                      </div>
                      <div className="text-xs font-bold text-[#111b21]">Ibu Citra Lestari</div>
                      <div className="text-[11px] text-[#54656f] mt-0.5">Pijat Laktasi Ibu Menyusui • Bidan Rina</div>
                      <div className="mt-2 text-[11px] font-semibold text-sky-800">Rp 175.000 (Menunggu DP)</div>
                    </div>

                    <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3.5">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="font-bold text-amber-900">13:30 - 14:30 WIB</span>
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">ASSIGNED</span>
                      </div>
                      <div className="text-xs font-bold text-[#111b21]">Ibu Sarah Amanda</div>
                      <div className="text-[11px] text-[#54656f] mt-0.5">Pediatric Baby Massage • Bidan Dita</div>
                      <div className="mt-2 text-[11px] font-semibold text-amber-800">Rp 150.000</div>
                    </div>

                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3.5">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="font-bold text-emerald-900">15:30 - 16:30 WIB</span>
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">CONFIRMED</span>
                      </div>
                      <div className="text-xs font-bold text-[#111b21]">Ibu Anisa (Baby Ken)</div>
                      <div className="text-[11px] text-[#54656f] mt-0.5">Fisioterapi Batuk Pilek • Bidan Rina</div>
                      <div className="mt-2 text-[11px] font-semibold text-emerald-800">Rp 160.000</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* 3. TREATMENT HARI INI & 4. DASHBOARD OVERVIEW */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* 3. TREATMENT HARI INI */}
                <div className="rounded-2xl border border-[#e9edef] bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between border-b border-[#e9edef] pb-3 mb-4">
                    <div className="flex items-center gap-2">
                      <Clock className="h-5 w-5 text-[#008069]" />
                      <h3 className="text-sm font-bold text-[#111b21]">3. Treatment Hari Ini (Task List)</h3>
                    </div>
                    <span className="text-xs font-semibold text-[#008069]">4 Jadwal Berjalan</span>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between rounded-xl border border-[#e9edef] p-3 hover:bg-slate-50">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-800 font-bold text-xs">
                          09:00
                        </div>
                        <div>
                          <div className="text-xs font-bold text-[#111b21]">Baby Arka (Pijat Bayi)</div>
                          <div className="flex items-center gap-1 text-[11px] text-[#54656f]">
                            <MapPin className="h-3 w-3 text-[#008069]" /> Tebet Barat, Jaksel • Bidan Siti
                          </div>
                        </div>
                      </div>
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                        COMPLETED
                      </span>
                    </div>

                    <div className="flex items-center justify-between rounded-xl border border-sky-200 bg-sky-50/40 p-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-100 text-sky-800 font-bold text-xs">
                          11:00
                        </div>
                        <div>
                          <div className="text-xs font-bold text-[#111b21]">Ibu Citra (Pijat Laktasi)</div>
                          <div className="flex items-center gap-1 text-[11px] text-[#54656f]">
                            <Truck className="h-3 w-3 text-sky-600" /> Sedang Menuju Lokasi (OTW)
                          </div>
                        </div>
                      </div>
                      <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-800">
                        ON_WAY
                      </span>
                    </div>
                  </div>
                </div>

                {/* 4. DASHBOARD OVERVIEW */}
                <div className="rounded-2xl border border-[#e9edef] bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between border-b border-[#e9edef] pb-3 mb-4">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="h-5 w-5 text-[#008069]" />
                      <h3 className="text-sm font-bold text-[#111b21]">4. Dashboard Overview & Omset</h3>
                    </div>
                    <span className="text-xs text-[#54656f]">Hari Ini (WIB)</span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="rounded-xl bg-[#f8fafc] border border-[#e9edef] p-3">
                      <span className="text-[11px] text-[#54656f]">Total Omset Hari Ini</span>
                      <div className="text-lg font-bold text-[#111b21]">Rp 2.450.000</div>
                      <span className="text-[10px] font-semibold text-emerald-700">↑ +14% vs kemarin</span>
                    </div>
                    <div className="rounded-xl bg-[#f8fafc] border border-[#e9edef] p-3">
                      <span className="text-[11px] text-[#54656f]">Reservasi Berhasil</span>
                      <div className="text-lg font-bold text-[#111b21]">16 Booking</div>
                      <span className="text-[10px] font-semibold text-[#008069]">94% Terkonfirmasi</span>
                    </div>
                  </div>

                  <div className="rounded-xl border border-dashed border-[#d1d7db] bg-slate-50 p-4 text-center">
                    <div className="text-xs text-[#54656f] font-medium">Grafik Omset & Kunjungan 7 Hari Terakhir</div>
                    <div className="mt-2 flex items-end justify-center gap-2 h-16">
                      <div className="w-6 bg-emerald-200 rounded-t h-8"></div>
                      <div className="w-6 bg-emerald-200 rounded-t h-10"></div>
                      <div className="w-6 bg-emerald-200 rounded-t h-7"></div>
                      <div className="w-6 bg-emerald-300 rounded-t h-12"></div>
                      <div className="w-6 bg-emerald-400 rounded-t h-14"></div>
                      <div className="w-6 bg-[#008069] rounded-t h-16"></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ========================================================================= */}
        {/* TIER 2: CRM & PASIEN */}
        {/* ========================================================================= */}
        {(activeTierFilter === 'all' || activeTierFilter === 'tier2') && (
          <section id="tier-2" className="mb-14">
            <div className="mb-4 flex items-center justify-between border-b border-[#d1d7db] pb-3">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-[#008069]">
                  Prioritas 2 • CRM & Pasien
                </span>
                <h2 className="text-xl font-bold text-[#111b21]">
                  Tier 2: Customer Database & Follow-Up CRM
                </h2>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                Sering Digunakan
              </span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* 5. CUSTOMER DATABASE */}
              <div className="lg:col-span-2 rounded-2xl border border-[#e9edef] bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between border-b border-[#e9edef] pb-3 mb-4">
                  <div className="flex items-center gap-2">
                    <Users className="h-5 w-5 text-[#008069]" />
                    <h3 className="text-sm font-bold text-[#111b21]">5. Customer Database & Rekam Kunjungan</h3>
                  </div>
                  <span className="text-xs text-[#54656f]">1,280 Pasien Terdaftar</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-[#e9edef] text-[#54656f]">
                        <th className="pb-2 font-semibold">Nama Pasien / Anak</th>
                        <th className="pb-2 font-semibold">Nomor WhatsApp</th>
                        <th className="pb-2 font-semibold">Label Kategori</th>
                        <th className="pb-2 font-semibold">Total Order</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#f0f2f5]">
                      <tr>
                        <td className="py-2.5 font-bold text-[#111b21]">
                          Ibu Anisa (Baby Ken)
                          <span className="block font-normal text-[11px] text-[#54656f]">Usia: 8 Bulan</span>
                        </td>
                        <td className="py-2.5 text-[#54656f]">0812-9876-XXXX</td>
                        <td className="py-2.5">
                          <span className="rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-800 border border-emerald-200">
                            Langganan VIP
                          </span>
                        </td>
                        <td className="py-2.5 font-semibold text-[#111b21]">4x Treatment</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 font-bold text-[#111b21]">
                          Ibu Citra Lestari
                          <span className="block font-normal text-[11px] text-[#54656f]">Pasca Salin: 2 Minggu</span>
                        </td>
                        <td className="py-2.5 text-[#54656f]">0856-1122-XXXX</td>
                        <td className="py-2.5">
                          <span className="rounded bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-800 border border-sky-200">
                            Ibu Menyusui
                          </span>
                        </td>
                        <td className="py-2.5 font-semibold text-[#111b21]">2x Treatment</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 6. FOLLOW-UP QUEUE & 7. QUICK REPLIES */}
              <div className="space-y-6">
                {/* 6. FOLLOW-UP QUEUE */}
                <div className="rounded-2xl border border-[#e9edef] bg-white p-5 shadow-sm">
                  <div className="flex items-center gap-2 border-b border-[#e9edef] pb-3 mb-3">
                    <Activity className="h-5 w-5 text-[#008069]" />
                    <h3 className="text-sm font-bold text-[#111b21]">6. Antrean Follow-Up Otomatis</h3>
                  </div>
                  <div className="space-y-2.5 text-xs">
                    <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-2.5">
                      <div className="flex justify-between font-semibold text-amber-900">
                        <span>Pengingat H-1 Treatment</span>
                        <span className="text-[10px]">Pukul 18:00 WIB</span>
                      </div>
                      <p className="text-[11px] text-[#54656f] mt-1">Terkirim ke 6 Pasien besok pagi</p>
                    </div>
                    <div className="rounded-xl border border-[#e9edef] p-2.5">
                      <div className="flex justify-between font-semibold text-[#111b21]">
                        <span>Review Kepuasan (H+1)</span>
                        <span className="text-[10px] text-[#008069] font-bold">SENT</span>
                      </div>
                      <p className="text-[11px] text-[#54656f] mt-1">Feedback bintang 5 dari 8 pasien</p>
                    </div>
                  </div>
                </div>

                {/* 7. QUICK REPLIES */}
                <div className="rounded-2xl border border-[#e9edef] bg-white p-5 shadow-sm">
                  <div className="flex items-center gap-2 border-b border-[#e9edef] pb-3 mb-3">
                    <FileText className="h-5 w-5 text-[#008069]" />
                    <h3 className="text-sm font-bold text-[#111b21]">7. Balasan Cepat (Quick Replies)</h3>
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    <span className="rounded-lg bg-[#f0f2f5] px-2.5 py-1 font-mono text-[11px] text-[#111b21] hover:bg-slate-200 cursor-pointer">
                      /jadwal
                    </span>
                    <span className="rounded-lg bg-[#f0f2f5] px-2.5 py-1 font-mono text-[11px] text-[#111b21] hover:bg-slate-200 cursor-pointer">
                      /tarif
                    </span>
                    <span className="rounded-lg bg-[#f0f2f5] px-2.5 py-1 font-mono text-[11px] text-[#111b21] hover:bg-slate-200 cursor-pointer">
                      /bapil
                    </span>
                    <span className="rounded-lg bg-[#f0f2f5] px-2.5 py-1 font-mono text-[11px] text-[#111b21] hover:bg-slate-200 cursor-pointer">
                      /laktasi
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ========================================================================= */}
        {/* TIER 3: MANAJEMEN KATALOG & OPERASIONAL */}
        {/* ========================================================================= */}
        {(activeTierFilter === 'all' || activeTierFilter === 'tier3') && (
          <section id="tier-3" className="mb-14">
            <div className="mb-4 flex items-center justify-between border-b border-[#d1d7db] pb-3">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-[#008069]">
                  Prioritas 3 • Manajemen & Katalog
                </span>
                <h2 className="text-xl font-bold text-[#111b21]">
                  Tier 3: Katalog Treatment, Ongkir & Tim
                </h2>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                Mingguan / Berkala
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {/* 8. KATALOG LAYANAN */}
              <div className="rounded-2xl border border-[#e9edef] bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2 border-b border-[#e9edef] pb-3 mb-3">
                  <Award className="h-5 w-5 text-[#008069]" />
                  <h3 className="text-sm font-bold text-[#111b21]">8. Katalog Layanan</h3>
                </div>
                <div className="space-y-2 text-xs">
                  <div className="border-b border-[#f0f2f5] pb-2">
                    <div className="font-bold text-[#111b21]">Pijat Batuk Pilek</div>
                    <div className="text-[11px] text-[#54656f]">Durasi: 45 Menit • Rp 135.000</div>
                  </div>
                  <div className="border-b border-[#f0f2f5] pb-2">
                    <div className="font-bold text-[#111b21]">Pijat Laktasi Bidan</div>
                    <div className="text-[11px] text-[#54656f]">Durasi: 60 Menit • Rp 175.000</div>
                  </div>
                  <div>
                    <div className="font-bold text-[#111b21]">Baby Spa & Swim</div>
                    <div className="text-[11px] text-[#54656f]">Durasi: 50 Menit • Rp 150.000</div>
                  </div>
                </div>
              </div>

              {/* 9. TARIF JARAK & ONGKIR */}
              <div className="rounded-2xl border border-[#e9edef] bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2 border-b border-[#e9edef] pb-3 mb-3">
                  <Truck className="h-5 w-5 text-[#008069]" />
                  <h3 className="text-sm font-bold text-[#111b21]">9. Tarif Jarak & Ongkir</h3>
                </div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between border-b border-[#f0f2f5] pb-1.5">
                    <span className="text-[#54656f]">0 - 3.0 km</span>
                    <span className="font-bold text-emerald-800">Gratis (Free)</span>
                  </div>
                  <div className="flex justify-between border-b border-[#f0f2f5] pb-1.5">
                    <span className="text-[#54656f]">3.1 - 7.0 km</span>
                    <span className="font-bold text-[#111b21]">Rp 15.000</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#54656f]">7.1 - 12.0 km</span>
                    <span className="font-bold text-[#111b21]">Rp 25.000</span>
                  </div>
                </div>
              </div>

              {/* 10. STAFF MANAGEMENT */}
              <div className="rounded-2xl border border-[#e9edef] bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2 border-b border-[#e9edef] pb-3 mb-3">
                  <UserCheck className="h-5 w-5 text-[#008069]" />
                  <h3 className="text-sm font-bold text-[#111b21]">10. Akun Bidan & Staff</h3>
                </div>
                <div className="space-y-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-[#111b21]">Bidan Rina Amd.Keb</div>
                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">Aktif</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-[#111b21]">Bidan Siti Nurhaliza</div>
                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">Aktif</span>
                  </div>
                </div>
              </div>

              {/* 11. KNOWLEDGE BASE */}
              <div className="rounded-2xl border border-[#e9edef] bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2 border-b border-[#e9edef] pb-3 mb-3">
                  <BookOpen className="h-5 w-5 text-[#008069]" />
                  <h3 className="text-sm font-bold text-[#111b21]">11. Knowledge FAQ AI</h3>
                </div>
                <div className="space-y-2 text-xs">
                  <div className="rounded-lg bg-[#f0f2f5] p-2">
                    <div className="font-bold text-[#111b21]">SOP Batuk Pilek Bayi</div>
                    <p className="text-[10px] text-[#54656f]">Fisioterapi dada, vibrasi & uap herbal</p>
                  </div>
                  <div className="rounded-lg bg-[#f0f2f5] p-2">
                    <div className="font-bold text-[#111b21]">Syarat Pasca Imunisasi</div>
                    <p className="text-[10px] text-[#54656f]">Wajib jeda 48 jam jika ada demam</p>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ========================================================================= */}
        {/* TIER 4: MARKETING & AI ENGINE */}
        {/* ========================================================================= */}
        {(activeTierFilter === 'all' || activeTierFilter === 'tier4') && (
          <section id="tier-4" className="mb-14">
            <div className="mb-4 flex items-center justify-between border-b border-[#d1d7db] pb-3">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-[#008069]">
                  Prioritas 4 • Marketing & AI Tuning
                </span>
                <h2 className="text-xl font-bold text-[#111b21]">
                  Tier 4: Simulator AI, Persona, & Atribusi Iklan
                </h2>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                Periodik / Testing
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* 12 & 13. AI SANDBOX & PERSONA */}
              <div className="rounded-2xl border border-[#e9edef] bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2 border-b border-[#e9edef] pb-3 mb-3">
                  <Sparkles className="h-5 w-5 text-[#008069]" />
                  <h3 className="text-sm font-bold text-[#111b21]">12 & 13. AI Sandbox & Persona</h3>
                </div>
                <div className="space-y-3 text-xs">
                  <div>
                    <span className="font-semibold text-[#54656f]">Persona Tone:</span>
                    <div className="mt-1 rounded-md bg-emerald-50 p-2 text-emerald-900 border border-emerald-200">
                      Bidan Klinik Hangat, Empatis, Panggilan "Bunda", Maks 2-3 Kalimat
                    </div>
                  </div>
                  <div>
                    <span className="font-semibold text-[#54656f]">Simulator Testing:</span>
                    <div className="mt-1 rounded-md bg-[#f0f2f5] p-2 text-[#111b21]">
                      Routing Call 1: <span className="font-mono text-[11px] text-[#008069]">get_catalog_and_price</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 14. LANDING PAGE BUILDER */}
              <div className="rounded-2xl border border-[#e9edef] bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2 border-b border-[#e9edef] pb-3 mb-3">
                  <Globe className="h-5 w-5 text-[#008069]" />
                  <h3 className="text-sm font-bold text-[#111b21]">14. Landing Page Promo</h3>
                </div>
                <div className="space-y-2 text-xs">
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-center">
                    <div className="font-bold text-emerald-900">Promo Home Care Bunda & Bayi</div>
                    <p className="text-[11px] text-emerald-700 mt-1">Diskon 20% Reservasi Hari Kerja</p>
                    <button className="mt-3 rounded-lg bg-[#008069] px-3 py-1.5 text-xs font-bold text-white shadow-xs">
                      Pesan via WhatsApp
                    </button>
                  </div>
                </div>
              </div>

              {/* 15 & 16. META ADS & EVALUASI AI */}
              <div className="rounded-2xl border border-[#e9edef] bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2 border-b border-[#e9edef] pb-3 mb-3">
                  <Radio className="h-5 w-5 text-[#008069]" />
                  <h3 className="text-sm font-bold text-[#111b21]">15 & 16. Meta CAPI & Evaluasi AI</h3>
                </div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between border-b border-[#f0f2f5] pb-2">
                    <span className="text-[#54656f]">Meta Event Contact:</span>
                    <span className="font-bold text-[#008069]">98% Match Rate</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#54656f]">Akurasi SOP Klinis AI:</span>
                    <span className="font-bold text-emerald-800">100% Lolos Audit</span>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ========================================================================= */}
        {/* TIER 5: PENGATURAN & SISTEM */}
        {/* ========================================================================= */}
        {(activeTierFilter === 'all' || activeTierFilter === 'tier5') && (
          <section id="tier-5" className="mb-14">
            <div className="mb-4 flex items-center justify-between border-b border-[#d1d7db] pb-3">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-[#008069]">
                  Prioritas 5 • Sistem & Utilitas
                </span>
                <h2 className="text-xl font-bold text-[#111b21]">
                  Tier 5: Pengaturan Operasional, Telegram, & Debug
                </h2>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                Paling Jarang (Setup Awal)
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="rounded-2xl border border-[#e9edef] bg-white p-4 shadow-sm text-xs">
                <div className="flex items-center gap-2 font-bold text-[#111b21] mb-2">
                  <Settings className="h-4 w-4 text-[#008069]" /> 17. Pengaturan Jam Klinik
                </div>
                <p className="text-[11px] text-[#54656f]">Buka: 08:00 - 17:00 WIB • Kuota: 12 Kunjungan/Hari</p>
              </div>

              <div className="rounded-2xl border border-[#e9edef] bg-white p-4 shadow-sm text-xs">
                <div className="flex items-center gap-2 font-bold text-[#111b21] mb-2">
                  <Send className="h-4 w-4 text-[#008069]" /> 18. Bot Telegram Staff
                </div>
                <p className="text-[11px] text-[#54656f]">Notifikasi harian jadwal bidan via Telegram Group</p>
              </div>

              <div className="rounded-2xl border border-[#e9edef] bg-white p-4 shadow-sm text-xs">
                <div className="flex items-center gap-2 font-bold text-[#111b21] mb-2">
                  <FileText className="h-4 w-4 text-[#008069]" /> 19. Migrasi Chat WhatsApp
                </div>
                <p className="text-[11px] text-[#54656f]">Alat ekstraksi pesan teks lama ke basis data</p>
              </div>

              <div className="rounded-2xl border border-[#e9edef] bg-white p-4 shadow-sm text-xs">
                <div className="flex items-center gap-2 font-bold text-[#111b21] mb-2">
                  <ShieldCheck className="h-4 w-4 text-[#008069]" /> 20. System Diagnostic
                </div>
                <p className="text-[11px] text-emerald-800 font-semibold">Semua Layanan Normal (DB, WAHA, Cache)</p>
              </div>
            </div>
          </section>
        )}

      </main>
    </div>
  );
};
