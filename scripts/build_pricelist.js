import fs from 'fs';
import path from 'path';

const html = `<!DOCTYPE html>
<html lang="id" class="scroll-smooth">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">
  <title>Pricelist Resmi — Kala Moms and Baby Spa Homecare</title>
  <meta name="description" content="Pricelist resmi layanan homecare Kala Moms and Baby Spa. Cek tarif asli & promo untuk pijat bayi, anak, ibu hamil, nifas, dan paket bundle. Dilayani Bidan resmi ber-STR.">
  
  <!-- Tailwind CSS via allowlisted gstatic -->
  <script src="https://www.gstatic.com/antigravity/web/dev/tailwindcss.min.js"></script>

  <style>
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=Quicksand:wght@500;600;700;800&display=swap');

    * {
      -webkit-tap-highlight-color: transparent;
    }

    body {
      font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
      background-color: #fffaf5;
      color: #292524;
      overflow-x: hidden;
    }

    .font-brand {
      font-family: 'Quicksand', 'Plus Jakarta Sans', sans-serif;
    }

    /* Soft scrollbar */
    ::-webkit-scrollbar { width: 5px; height: 5px; }
    ::-webkit-scrollbar-track { background: #fffaf5; }
    ::-webkit-scrollbar-thumb { background: #fed7aa; border-radius: 9999px; }
    ::-webkit-scrollbar-thumb:hover { background: #fdba74; }

    /* Interactive row styling - Minimum 44px touch target on mobile */
    .price-row {
      transition: all 0.15s ease-in-out;
      touch-action: manipulation;
    }
    .price-row:active {
      background-color: #ffedd5 !important;
      transform: scale(0.99);
    }
    .price-row:hover {
      background-color: #fff7ed;
    }

    /* Pulse animation for CTA button */
    @keyframes pulse-subtle {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.025); }
    }
    .pulse-btn {
      animation: pulse-subtle 3s infinite ease-in-out;
    }

    /* Prevent awkward mobile text wrapping */
    .text-balance {
      text-wrap: balance;
    }
  </style>
</head>
<body class="antialiased min-h-screen flex flex-col bg-[#fffaf5] pb-24 sm:pb-20 selection:bg-orange-100 selection:text-orange-900">

  <!-- Top Announcement Bar -->
  <div class="bg-gradient-to-r from-[#ea583a] via-[#f97316] to-[#ea583a] text-white text-[11px] sm:text-xs font-semibold py-2 px-3 text-center tracking-wide flex items-center justify-center gap-1.5 shadow-2xs">
    <span>🌸 <strong>Layanan Homecare Bidan Resmi:</strong> Nyaman di Rumah • Surabaya & Sidoarjo</span>
  </div>

  <!-- Main Container -->
  <main class="max-w-4xl mx-auto px-3 sm:px-6 py-5 sm:py-8 flex-1 w-full">
    
    <!-- Header: Matching exact flyer style -->
    <header class="text-center relative mb-6 sm:mb-8">
      
      <!-- Top Badges -->
      <div class="flex items-center justify-between mb-2">
        <span class="inline-flex items-center gap-1 text-[11px] sm:text-xs font-extrabold text-[#ea583a] font-brand tracking-tight bg-orange-100/60 px-2.5 py-1 rounded-full border border-orange-200">
          ✨ Pijat Sehat, Tumbuh Optimal
        </span>
        <span class="text-[11px] sm:text-xs font-bold text-stone-600 bg-white px-2.5 py-1 rounded-full border border-orange-200/80 shadow-2xs">
          Bidan Ber-STR 🩺
        </span>
      </div>

      <!-- Center Logo & Branding -->
      <div class="flex flex-col items-center justify-center my-2 sm:my-3">
        <!-- Logo Icon Swirl -->
        <div class="w-13 h-13 sm:w-16 sm:h-16 rounded-full bg-gradient-to-br from-orange-100 to-rose-100 border-2 border-orange-200 flex items-center justify-center shadow-xs mb-1.5">
          <svg class="w-7 h-7 sm:w-9 sm:h-9 text-[#ea583a]" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
          </svg>
        </div>

        <h1 class="text-3xl sm:text-4xl font-extrabold text-[#ea583a] font-brand tracking-tight leading-none">
          Kala
        </h1>
        <p class="text-xs sm:text-sm font-bold text-stone-600 tracking-wider uppercase mt-1 font-brand">
          Moms and Baby Spa
        </p>
      </div>

      <!-- Big "Pricelist" Badge -->
      <div class="my-3">
        <div class="inline-flex items-center gap-2.5 px-6 sm:px-8 py-2 rounded-full bg-gradient-to-r from-orange-400 to-[#ea583a] text-white font-black text-lg sm:text-2xl shadow-sm tracking-wider font-brand">
          <span class="opacity-80">≡</span>
          <span>Pricelist</span>
          <span class="opacity-80">≡</span>
        </div>
      </div>

      <p class="text-xs sm:text-sm font-bold text-stone-500 font-brand flex items-center justify-center gap-1.5">
        <span class="text-rose-400">♥</span>
        <span>Layanan Terbaik untuk Si Kecil dan Bunda</span>
        <span class="text-rose-400">♥</span>
      </p>

      <!-- Search & Mobile Category Anchors -->
      <div class="mt-5 max-w-lg mx-auto">
        <div class="relative">
          <div class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-orange-400">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
            </svg>
          </div>
          <input 
            type="text" 
            id="pricelistSearch" 
            placeholder="Cari layanan (misal: ceria, bapil, gtm, cukur, induksi, yoga)..."
            class="w-full pl-9 pr-10 py-2.5 bg-white border border-orange-200 rounded-full text-xs sm:text-sm text-stone-800 placeholder-stone-400 focus:outline-hidden focus:border-orange-400 focus:ring-2 focus:ring-orange-100 shadow-2xs"
            oninput="filterPricelist()"
          >
          <button id="clearPricelistBtn" onclick="clearSearch()" class="hidden absolute inset-y-0 right-0 pr-3.5 flex items-center text-stone-400 hover:text-stone-600">
            ✕
          </button>
        </div>

        <!-- Quick Jump Buttons (Mobile Scroll Friendly) -->
        <div class="flex items-center justify-center gap-1.5 mt-2.5 overflow-x-auto pb-1 text-xs scrollbar-none">
          <button onclick="scrollToSection('sec-baby')" class="px-3 py-1 rounded-full bg-orange-100 hover:bg-orange-200 text-orange-900 font-bold whitespace-nowrap active:scale-95 transition-transform">
            👶 Baby
          </button>
          <button onclick="scrollToSection('sec-kids')" class="px-3 py-1 rounded-full bg-orange-100 hover:bg-orange-200 text-orange-900 font-bold whitespace-nowrap active:scale-95 transition-transform">
            👧 Kids
          </button>
          <button onclick="scrollToSection('sec-moms')" class="px-3 py-1 rounded-full bg-orange-100 hover:bg-orange-200 text-orange-900 font-bold whitespace-nowrap active:scale-95 transition-transform">
            🤰 Moms
          </button>
          <button onclick="scrollToSection('sec-bundle')" class="px-3 py-1 rounded-full bg-orange-100 hover:bg-orange-200 text-orange-900 font-bold whitespace-nowrap active:scale-95 transition-transform">
            🎁 Bundle
          </button>
          <button onclick="scrollToSection('sec-addon')" class="px-3 py-1 rounded-full bg-orange-100 hover:bg-orange-200 text-orange-900 font-bold whitespace-nowrap active:scale-95 transition-transform">
            ➕ Add On
          </button>
        </div>
      </div>

    </header>

    <!-- SECTION 1: KALA BABY & KALA KIDS (Side by Side Grid on Desktop, Clean on Mobile) -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-5 sm:mb-6">
      
      <!-- Card: KALA BABY (All 9 Services Directly Included) -->
      <section id="sec-baby" class="bg-white rounded-3xl border border-orange-200 shadow-xs overflow-hidden flex flex-col justify-between">
        <div>
          <!-- Header Card: KALA BABY -->
          <div class="px-4 sm:px-5 py-3.5 bg-gradient-to-r from-orange-50 via-orange-100/50 to-orange-50 border-b border-orange-200 flex items-center justify-between">
            <div class="flex items-center gap-2.5">
              <div class="w-8 h-8 rounded-full bg-orange-200/80 text-orange-800 flex items-center justify-center text-base">
                👶
              </div>
              <div>
                <span class="px-3 py-0.5 rounded-full bg-[#ea583a] text-white font-extrabold text-xs sm:text-sm uppercase tracking-wider font-brand shadow-2xs">
                  KALA BABY
                </span>
              </div>
            </div>
            <span class="text-[11px] font-bold text-orange-800 bg-orange-50 px-2 py-0.5 rounded-md">
              0 – 24 Bulan
            </span>
          </div>

          <!-- Table KALA BABY -->
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs sm:text-[13px]">
              <thead class="bg-orange-50/70 text-[#ea583a] font-bold border-b border-orange-100">
                <tr>
                  <th class="py-2.5 px-3 sm:px-4">Layanan</th>
                  <th class="py-2.5 px-2 whitespace-nowrap">Usia / Sasaran</th>
                  <th class="py-2.5 px-1.5 text-center whitespace-nowrap">Durasi</th>
                  <th class="py-2.5 px-3 sm:px-4 text-right whitespace-nowrap">Tarif & Promo</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-orange-100 font-medium text-stone-700" id="table-body-baby">
                
                <tr class="price-row cursor-pointer" onclick="bookWa('Pijat Ceria Newborn', '0 - 6 Bulan', '40 mnt', 'Rp60.000', 'Rp80.000')">
                  <td class="py-3 px-3 sm:px-4 font-bold text-stone-800 leading-snug">Pijat Ceria Newborn</td>
                  <td class="py-3 px-2 text-stone-500 whitespace-nowrap">0 - 6 Bulan</td>
                  <td class="py-3 px-1.5 text-stone-500 text-center whitespace-nowrap">40 mnt</td>
                  <td class="py-3 px-3 sm:px-4 text-right whitespace-nowrap">
                    <span class="text-[11px] text-stone-400 line-through block leading-tight">Rp80.000</span>
                    <span class="inline-block px-2 py-0.5 rounded-full bg-[#ffedd5] text-[#c2410c] font-bold text-xs shadow-2xs">
                      Rp60.000
                    </span>
                  </td>
                </tr>

                <tr class="price-row cursor-pointer" onclick="bookWa('Pijat Ceria', '7 - 24 Bulan', '40 mnt', 'Rp70.000', 'Rp80.000')">
                  <td class="py-3 px-3 sm:px-4 font-bold text-stone-800 leading-snug">Pijat Ceria</td>
                  <td class="py-3 px-2 text-stone-500 whitespace-nowrap">7 - 24 Bulan</td>
                  <td class="py-3 px-1.5 text-stone-500 text-center whitespace-nowrap">40 mnt</td>
                  <td class="py-3 px-3 sm:px-4 text-right whitespace-nowrap">
                    <span class="text-[11px] text-stone-400 line-through block leading-tight">Rp80.000</span>
                    <span class="inline-block px-2 py-0.5 rounded-full bg-[#ffedd5] text-[#c2410c] font-bold text-xs shadow-2xs">
                      Rp70.000
                    </span>
                  </td>
                </tr>

                <tr class="price-row cursor-pointer" onclick="bookWa('Pijat Pulih Ceria Newborn (Bapil)', '0 - 6 Bulan', '40 mnt', 'Rp65.000', 'Rp100.000')">
                  <td class="py-3 px-3 sm:px-4 font-bold text-stone-800 leading-snug">
                    Pijat Pulih Ceria Newborn
                    <span class="block text-[10px] font-normal text-orange-700">Terapi Batuk, Pilek & Flu</span>
                  </td>
                  <td class="py-3 px-2 text-stone-500 whitespace-nowrap">0 - 6 Bulan</td>
                  <td class="py-3 px-1.5 text-stone-500 text-center whitespace-nowrap">40 mnt</td>
                  <td class="py-3 px-3 sm:px-4 text-right whitespace-nowrap">
                    <span class="text-[11px] text-stone-400 line-through block leading-tight">Rp100.000</span>
                    <span class="inline-block px-2 py-0.5 rounded-full bg-[#ffedd5] text-[#c2410c] font-bold text-xs shadow-2xs">
                      Rp65.000
                    </span>
                  </td>
                </tr>

                <tr class="price-row cursor-pointer" onclick="bookWa('Pijat Pulih Ceria (Bapil)', '7 - 24 Bulan', '40 mnt', 'Rp75.000', 'Rp100.000')">
                  <td class="py-3 px-3 sm:px-4 font-bold text-stone-800 leading-snug">
                    Pijat Pulih Ceria
                    <span class="block text-[10px] font-normal text-orange-700">Terapi Batuk, Pilek & Flu</span>
                  </td>
                  <td class="py-3 px-2 text-stone-500 whitespace-nowrap">7 - 24 Bulan</td>
                  <td class="py-3 px-1.5 text-stone-500 text-center whitespace-nowrap">40 mnt</td>
                  <td class="py-3 px-3 sm:px-4 text-right whitespace-nowrap">
                    <span class="text-[11px] text-stone-400 line-through block leading-tight">Rp100.000</span>
                    <span class="inline-block px-2 py-0.5 rounded-full bg-[#ffedd5] text-[#c2410c] font-bold text-xs shadow-2xs">
                      Rp75.000
                    </span>
                  </td>
                </tr>

                <tr class="price-row cursor-pointer" onclick="bookWa('Pijat Lahap (GTM)', '0 - 24 Bulan', '40 mnt', 'Rp75.000', 'Rp100.000')">
                  <td class="py-3 px-3 sm:px-4 font-bold text-stone-800 leading-snug">
                    Pijat Lahap
                    <span class="block text-[10px] font-normal text-orange-700">Stimulasi Nafsu Makan (GTM)</span>
                  </td>
                  <td class="py-3 px-2 text-stone-500 whitespace-nowrap">0 - 24 Bulan</td>
                  <td class="py-3 px-1.5 text-stone-500 text-center whitespace-nowrap">40 mnt</td>
                  <td class="py-3 px-3 sm:px-4 text-right whitespace-nowrap">
                    <span class="text-[11px] text-stone-400 line-through block leading-tight">Rp100.000</span>
                    <span class="inline-block px-2 py-0.5 rounded-full bg-[#ffedd5] text-[#c2410c] font-bold text-xs shadow-2xs">
                      Rp75.000
                    </span>
                  </td>
                </tr>

                <tr class="price-row cursor-pointer" onclick="bookWa('Cukur Rambut', '0 - 24 Bulan', '15 mnt', 'Rp25.000', 'Rp35.000')">
                  <td class="py-3 px-3 sm:px-4 font-bold text-stone-800 leading-snug">Cukur Rambut</td>
                  <td class="py-3 px-2 text-stone-500 whitespace-nowrap">0 - 24 Bulan</td>
                  <td class="py-3 px-1.5 text-stone-500 text-center whitespace-nowrap">15 mnt</td>
                  <td class="py-3 px-3 sm:px-4 text-right whitespace-nowrap">
                    <span class="text-[11px] text-stone-400 line-through block leading-tight">Rp35.000</span>
                    <span class="inline-block px-2 py-0.5 rounded-full bg-[#ffedd5] text-[#c2410c] font-bold text-xs shadow-2xs">
                      Rp25.000
                    </span>
                  </td>
                </tr>

                <tr class="price-row cursor-pointer" onclick="bookWa('Memandikan Bayi', '0 - 24 Bulan', '25 mnt', 'Rp30.000', 'Rp40.000')">
                  <td class="py-3 px-3 sm:px-4 font-bold text-stone-800 leading-snug">Memandikan Bayi</td>
                  <td class="py-3 px-2 text-stone-500 whitespace-nowrap">0 - 24 Bulan</td>
                  <td class="py-3 px-1.5 text-stone-500 text-center whitespace-nowrap">25 mnt</td>
                  <td class="py-3 px-3 sm:px-4 text-right whitespace-nowrap">
                    <span class="text-[11px] text-stone-400 line-through block leading-tight">Rp40.000</span>
                    <span class="inline-block px-2 py-0.5 rounded-full bg-[#ffedd5] text-[#c2410c] font-bold text-xs shadow-2xs">
                      Rp30.000
                    </span>
                  </td>
                </tr>

                <tr class="price-row cursor-pointer" onclick="bookWa('Tindik Telinga', '0 - 12 Bulan', '15 mnt', 'Rp50.000', 'Rp70.000')">
                  <td class="py-3 px-3 sm:px-4 font-bold text-stone-800 leading-snug">Tindik Telinga</td>
                  <td class="py-3 px-2 text-stone-500 whitespace-nowrap">0 - 12 Bulan</td>
                  <td class="py-3 px-1.5 text-stone-500 text-center whitespace-nowrap">15 mnt</td>
                  <td class="py-3 px-3 sm:px-4 text-right whitespace-nowrap">
                    <span class="text-[11px] text-stone-400 line-through block leading-tight">Rp70.000</span>
                    <span class="inline-block px-2 py-0.5 rounded-full bg-[#ffedd5] text-[#c2410c] font-bold text-xs shadow-2xs">
                      Rp50.000
                    </span>
                  </td>
                </tr>

                <tr class="price-row cursor-pointer" onclick="bookWa('Paket Pendampingan 14 Sesi', '0 - 6 Bulan', '120 mnt', 'Rp600.000', 'Rp700.000')">
                  <td class="py-3 px-3 sm:px-4 font-bold text-stone-800 leading-snug">
                    Paket Pendampingan 14 Sesi
                    <span class="block text-[10px] font-normal text-orange-700">Perawatan Tali Pusat, Mandi, Pijat</span>
                  </td>
                  <td class="py-3 px-2 text-stone-500 whitespace-nowrap">0 - 6 Bulan</td>
                  <td class="py-3 px-1.5 text-stone-500 text-center whitespace-nowrap">120 mnt</td>
                  <td class="py-3 px-3 sm:px-4 text-right whitespace-nowrap">
                    <span class="text-[11px] text-stone-400 line-through block leading-tight">Rp700.000</span>
                    <span class="inline-block px-2 py-0.5 rounded-full bg-[#ffedd5] text-[#c2410c] font-bold text-xs shadow-2xs">
                      Rp600.000
                    </span>
                  </td>
                </tr>

              </tbody>
            </table>
          </div>
        </div>

        <div class="p-2.5 bg-orange-50/60 border-t border-orange-100 text-[11px] text-stone-500 text-center">
          💡 Klik baris layanan untuk langsung pesan jadwal via WhatsApp
        </div>
      </section>

      <!-- Card: KALA KIDS (All 7 Services) -->
      <section id="sec-kids" class="bg-white rounded-3xl border border-orange-200 shadow-xs overflow-hidden flex flex-col justify-between">
        <div>
          <!-- Header Card: KALA KIDS -->
          <div class="px-4 sm:px-5 py-3.5 bg-gradient-to-r from-orange-50 via-orange-100/50 to-orange-50 border-b border-orange-200 flex items-center justify-between">
            <div class="flex items-center gap-2.5">
              <div class="w-8 h-8 rounded-full bg-orange-200/80 text-orange-800 flex items-center justify-center text-base">
                👧
              </div>
              <div>
                <span class="px-3 py-0.5 rounded-full bg-[#ea583a] text-white font-extrabold text-xs sm:text-sm uppercase tracking-wider font-brand shadow-2xs">
                  KALA KIDS
                </span>
              </div>
            </div>
            <span class="text-[11px] font-bold text-orange-800 bg-orange-50 px-2 py-0.5 rounded-md">
              2 – 8 Tahun
            </span>
          </div>

          <!-- Table KALA KIDS -->
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs sm:text-[13px]">
              <thead class="bg-orange-50/70 text-[#ea583a] font-bold border-b border-orange-100">
                <tr>
                  <th class="py-2.5 px-3 sm:px-4">Layanan</th>
                  <th class="py-2.5 px-2 whitespace-nowrap">Usia / Sasaran</th>
                  <th class="py-2.5 px-1.5 text-center whitespace-nowrap">Durasi</th>
                  <th class="py-2.5 px-3 sm:px-4 text-right whitespace-nowrap">Tarif & Promo</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-orange-100 font-medium text-stone-700" id="table-body-kids">
                
                <tr class="price-row cursor-pointer" onclick="bookWa('Pijat Ceria (2-4 Tahun)', '2 - 4 Tahun', '40 mnt', 'Rp75.000', 'Rp85.000')">
                  <td class="py-3 px-3 sm:px-4 font-bold text-stone-800 leading-snug">Pijat Ceria (2-4 Tahun)</td>
                  <td class="py-3 px-2 text-stone-500 whitespace-nowrap">2 - 4 Tahun</td>
                  <td class="py-3 px-1.5 text-stone-500 text-center whitespace-nowrap">40 mnt</td>
                  <td class="py-3 px-3 sm:px-4 text-right whitespace-nowrap">
                    <span class="text-[11px] text-stone-400 line-through block leading-tight">Rp85.000</span>
                    <span class="inline-block px-2 py-0.5 rounded-full bg-[#ffedd5] text-[#c2410c] font-bold text-xs shadow-2xs">
                      Rp75.000
                    </span>
                  </td>
                </tr>

                <tr class="price-row cursor-pointer" onclick="bookWa('Pijat Ceria (4-6 Tahun)', '4 - 6 Tahun', '40 mnt', 'Rp80.000', 'Rp90.000')">
                  <td class="py-3 px-3 sm:px-4 font-bold text-stone-800 leading-snug">Pijat Ceria (4-6 Tahun)</td>
                  <td class="py-3 px-2 text-stone-500 whitespace-nowrap">4 - 6 Tahun</td>
                  <td class="py-3 px-1.5 text-stone-500 text-center whitespace-nowrap">40 mnt</td>
                  <td class="py-3 px-3 sm:px-4 text-right whitespace-nowrap">
                    <span class="text-[11px] text-stone-400 line-through block leading-tight">Rp90.000</span>
                    <span class="inline-block px-2 py-0.5 rounded-full bg-[#ffedd5] text-[#c2410c] font-bold text-xs shadow-2xs">
                      Rp80.000
                    </span>
                  </td>
                </tr>

                <tr class="price-row cursor-pointer" onclick="bookWa('Pijat Ceria (6-8 Tahun)', '6 - 8 Tahun', '40 mnt', 'Rp90.000', 'Rp100.000')">
                  <td class="py-3 px-3 sm:px-4 font-bold text-stone-800 leading-snug">Pijat Ceria (6-8 Tahun)</td>
                  <td class="py-3 px-2 text-stone-500 whitespace-nowrap">6 - 8 Tahun</td>
                  <td class="py-3 px-1.5 text-stone-500 text-center whitespace-nowrap">40 mnt</td>
                  <td class="py-3 px-3 sm:px-4 text-right whitespace-nowrap">
                    <span class="text-[11px] text-stone-400 line-through block leading-tight">Rp100.000</span>
                    <span class="inline-block px-2 py-0.5 rounded-full bg-[#ffedd5] text-[#c2410c] font-bold text-xs shadow-2xs">
                      Rp90.000
                    </span>
                  </td>
                </tr>

                <tr class="price-row cursor-pointer" onclick="bookWa('Pijat Lahap (GTM 2-8th)', '2 - 8 Tahun', '40 mnt', 'Rp80.000', 'Rp110.000')">
                  <td class="py-3 px-3 sm:px-4 font-bold text-stone-800 leading-snug">
                    Pijat Lahap (GTM)
                    <span class="block text-[10px] font-normal text-orange-700">Penambah Nafsu Makan</span>
                  </td>
                  <td class="py-3 px-2 text-stone-500 whitespace-nowrap">2 - 8 Tahun</td>
                  <td class="py-3 px-1.5 text-stone-500 text-center whitespace-nowrap">40 mnt</td>
                  <td class="py-3 px-3 sm:px-4 text-right whitespace-nowrap">
                    <span class="text-[11px] text-stone-400 line-through block leading-tight">Rp110.000</span>
                    <span class="inline-block px-2 py-0.5 rounded-full bg-[#ffedd5] text-[#c2410c] font-bold text-xs shadow-2xs">
                      Rp80.000
                    </span>
                  </td>
                </tr>

                <tr class="price-row cursor-pointer" onclick="bookWa('Pijat Pulih Ceria (2-4 Tahun)', '2 - 4 Tahun', '40 mnt', 'Rp85.000', 'Rp100.000')">
                  <td class="py-3 px-3 sm:px-4 font-bold text-stone-800 leading-snug">
                    Pijat Pulih Ceria (2-4th)
                    <span class="block text-[10px] font-normal text-orange-700">Terapi Batuk, Pilek & Flu</span>
                  </td>
                  <td class="py-3 px-2 text-stone-500 whitespace-nowrap">2 - 4 Tahun</td>
                  <td class="py-3 px-1.5 text-stone-500 text-center whitespace-nowrap">40 mnt</td>
                  <td class="py-3 px-3 sm:px-4 text-right whitespace-nowrap">
                    <span class="text-[11px] text-stone-400 line-through block leading-tight">Rp100.000</span>
                    <span class="inline-block px-2 py-0.5 rounded-full bg-[#ffedd5] text-[#c2410c] font-bold text-xs shadow-2xs">
                      Rp85.000
                    </span>
                  </td>
                </tr>

                <tr class="price-row cursor-pointer" onclick="bookWa('Pijat Pulih Ceria (4-6 Tahun)', '4 - 6 Tahun', '40 mnt', 'Rp90.000', 'Rp110.000')">
                  <td class="py-3 px-3 sm:px-4 font-bold text-stone-800 leading-snug">
                    Pijat Pulih Ceria (4-6th)
                    <span class="block text-[10px] font-normal text-orange-700">Terapi Batuk, Pilek & Flu</span>
                  </td>
                  <td class="py-3 px-2 text-stone-500 whitespace-nowrap">4 - 6 Tahun</td>
                  <td class="py-3 px-1.5 text-stone-500 text-center whitespace-nowrap">40 mnt</td>
                  <td class="py-3 px-3 sm:px-4 text-right whitespace-nowrap">
                    <span class="text-[11px] text-stone-400 line-through block leading-tight">Rp110.000</span>
                    <span class="inline-block px-2 py-0.5 rounded-full bg-[#ffedd5] text-[#c2410c] font-bold text-xs shadow-2xs">
                      Rp90.000
                    </span>
                  </td>
                </tr>

                <tr class="price-row cursor-pointer" onclick="bookWa('Pijat Pulih Ceria (6-8 Tahun)', '6 - 8 Tahun', '40 mnt', 'Rp100.000', 'Rp120.000')">
                  <td class="py-3 px-3 sm:px-4 font-bold text-stone-800 leading-snug">
                    Pijat Pulih Ceria (6-8th)
                    <span class="block text-[10px] font-normal text-orange-700">Terapi Batuk, Pilek & Flu</span>
                  </td>
                  <td class="py-3 px-2 text-stone-500 whitespace-nowrap">6 - 8 Tahun</td>
                  <td class="py-3 px-1.5 text-stone-500 text-center whitespace-nowrap">40 mnt</td>
                  <td class="py-3 px-3 sm:px-4 text-right whitespace-nowrap">
                    <span class="text-[11px] text-stone-400 line-through block leading-tight">Rp120.000</span>
                    <span class="inline-block px-2 py-0.5 rounded-full bg-[#ffedd5] text-[#c2410c] font-bold text-xs shadow-2xs">
                      Rp100.000
                    </span>
                  </td>
                </tr>

              </tbody>
            </table>
          </div>
        </div>

        <div class="p-2.5 bg-orange-50/60 border-t border-orange-100 text-[11px] text-stone-500 text-center">
          💡 Seluruh terapis bidan membawa minyak alami hypoallergenic & alat steril
        </div>
      </section>

    </div>

    <!-- SECTION 2: KALA MOMS (Full Width) -->
    <section id="sec-moms" class="bg-white rounded-3xl border border-orange-200 shadow-xs overflow-hidden mb-5 sm:mb-6">
      
      <!-- Header Card: KALA MOMS -->
      <div class="px-4 sm:px-5 py-3.5 bg-gradient-to-r from-orange-50 via-orange-100/50 to-orange-50 border-b border-orange-200 flex items-center justify-between">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-full bg-rose-200/80 text-rose-800 flex items-center justify-center text-base">
            🤰
          </div>
          <div>
            <span class="px-3 py-0.5 rounded-full bg-[#ea583a] text-white font-extrabold text-xs sm:text-sm uppercase tracking-wider font-brand shadow-2xs">
              KALA MOMS
            </span>
          </div>
        </div>
        <span class="text-[11px] font-bold text-orange-800 bg-orange-50 px-2 py-0.5 rounded-md">
          Ibu Hamil, Bersalin & Menyusui
        </span>
      </div>

      <!-- Table KALA MOMS -->
      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs sm:text-[13px]">
          <thead class="bg-orange-50/70 text-[#ea583a] font-bold border-b border-orange-100">
            <tr>
              <th class="py-2.5 px-3 sm:px-4">Layanan</th>
              <th class="py-2.5 px-2 whitespace-nowrap">Usia / Sasaran</th>
              <th class="py-2.5 px-1.5 text-center whitespace-nowrap">Durasi</th>
              <th class="py-2.5 px-3 sm:px-4 text-right whitespace-nowrap">Tarif & Promo</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-orange-100 font-medium text-stone-700" id="table-body-moms">
            
            <tr class="price-row cursor-pointer" onclick="bookWa('Prenatal Gentle Yoga', 'Trimester 2 & 3', '30 mnt', 'Rp50.000', 'Rp70.000')">
              <td class="py-3 px-3 sm:px-4 font-bold text-stone-800 leading-snug">Prenatal Gentle Yoga</td>
              <td class="py-3 px-2 text-stone-500 whitespace-nowrap">Trimester 2 & 3</td>
              <td class="py-3 px-1.5 text-stone-500 text-center whitespace-nowrap">30 mnt</td>
              <td class="py-3 px-3 sm:px-4 text-right whitespace-nowrap">
                <span class="text-[11px] text-stone-400 line-through block leading-tight">Rp70.000</span>
                <span class="inline-block px-2 py-0.5 rounded-full bg-[#ffedd5] text-[#c2410c] font-bold text-xs shadow-2xs">
                  Rp50.000
                </span>
              </td>
            </tr>

            <tr class="price-row cursor-pointer" onclick="bookWa('Perineum Massage', 'Min. 34-36 Minggu', '30 mnt', 'Rp50.000', 'Rp70.000')">
              <td class="py-3 px-3 sm:px-4 font-bold text-stone-800 leading-snug">Perineum Massage</td>
              <td class="py-3 px-2 text-stone-500 whitespace-nowrap">Min. 34-36 Minggu</td>
              <td class="py-3 px-1.5 text-stone-500 text-center whitespace-nowrap">30 mnt</td>
              <td class="py-3 px-3 sm:px-4 text-right whitespace-nowrap">
                <span class="text-[11px] text-stone-400 line-through block leading-tight">Rp70.000</span>
                <span class="inline-block px-2 py-0.5 rounded-full bg-[#ffedd5] text-[#c2410c] font-bold text-xs shadow-2xs">
                  Rp50.000
                </span>
              </td>
            </tr>

            <tr class="price-row cursor-pointer" onclick="bookWa('Induksi Massage', 'Ibu Hamil Aterm (37+ Mgg)', '40 mnt', 'Rp50.000', 'Rp70.000')">
              <td class="py-3 px-3 sm:px-4 font-bold text-stone-800 leading-snug">
                Induksi Massage
                <span class="block text-[10px] font-normal text-orange-700">Akupresur Rangsang Kontraksi Alami</span>
              </td>
              <td class="py-3 px-2 text-stone-500 whitespace-nowrap">Ibu Hamil Aterm (37+ Mgg)</td>
              <td class="py-3 px-1.5 text-stone-500 text-center whitespace-nowrap">40 mnt</td>
              <td class="py-3 px-3 sm:px-4 text-right whitespace-nowrap">
                <span class="text-[11px] text-stone-400 line-through block leading-tight">Rp70.000</span>
                <span class="inline-block px-2 py-0.5 rounded-full bg-[#ffedd5] text-[#c2410c] font-bold text-xs shadow-2xs">
                  Rp50.000
                </span>
              </td>
            </tr>

            <tr class="price-row cursor-pointer" onclick="bookWa('Induksi Massage Fullbody', 'Ibu Hamil Aterm (37+ Mgg)', '60 mnt', 'Rp105.000', 'Rp130.000')">
              <td class="py-3 px-3 sm:px-4 font-bold text-stone-800 leading-snug">
                Induksi Massage Fullbody
                <span class="block text-[10px] font-normal text-orange-700">Pijat Seluruh Tubuh + Titik Induksi</span>
              </td>
              <td class="py-3 px-2 text-stone-500 whitespace-nowrap">Ibu Hamil Aterm (37+ Mgg)</td>
              <td class="py-3 px-1.5 text-stone-500 text-center whitespace-nowrap">60 mnt</td>
              <td class="py-3 px-3 sm:px-4 text-right whitespace-nowrap">
                <span class="text-[11px] text-stone-400 line-through block leading-tight">Rp130.000</span>
                <span class="inline-block px-2 py-0.5 rounded-full bg-[#ffedd5] text-[#c2410c] font-bold text-xs shadow-2xs">
                  Rp105.000
                </span>
              </td>
            </tr>

            <tr class="price-row cursor-pointer" onclick="bookWa('Oksitosin Massage (Punggung)', 'Ibu Menyusui', '40 mnt', 'Rp75.000', 'Rp90.000')">
              <td class="py-3 px-3 sm:px-4 font-bold text-stone-800 leading-snug">
                Oksitosin Massage (Punggung)
                <span class="block text-[10px] font-normal text-orange-700">Punggung & Bahu Melancarkan ASI</span>
              </td>
              <td class="py-3 px-2 text-stone-500 whitespace-nowrap">Ibu Menyusui</td>
              <td class="py-3 px-1.5 text-stone-500 text-center whitespace-nowrap">40 mnt</td>
              <td class="py-3 px-3 sm:px-4 text-right whitespace-nowrap">
                <span class="text-[11px] text-stone-400 line-through block leading-tight">Rp90.000</span>
                <span class="inline-block px-2 py-0.5 rounded-full bg-[#ffedd5] text-[#c2410c] font-bold text-xs shadow-2xs">
                  Rp75.000
                </span>
              </td>
            </tr>

            <tr class="price-row cursor-pointer" onclick="bookWa('Laktasi & Breast Care', 'Ibu Menyusui', '40 mnt', 'Rp85.000', 'Rp110.000')">
              <td class="py-3 px-3 sm:px-4 font-bold text-stone-800 leading-snug">
                Laktasi & Breast Care
                <span class="block text-[10px] font-normal text-orange-700">Atasi Payudara Bengkak & Sumbatan</span>
              </td>
              <td class="py-3 px-2 text-stone-500 whitespace-nowrap">Ibu Menyusui</td>
              <td class="py-3 px-1.5 text-stone-500 text-center whitespace-nowrap">40 mnt</td>
              <td class="py-3 px-3 sm:px-4 text-right whitespace-nowrap">
                <span class="text-[11px] text-stone-400 line-through block leading-tight">Rp110.000</span>
                <span class="inline-block px-2 py-0.5 rounded-full bg-[#ffedd5] text-[#c2410c] font-bold text-xs shadow-2xs">
                  Rp85.000
                </span>
              </td>
            </tr>

            <tr class="price-row cursor-pointer" onclick="bookWa('Pregnant / Prenatal Massage', 'Trimester 2 & 3', '60 mnt', 'Rp100.000', 'Rp120.000')">
              <td class="py-3 px-3 sm:px-4 font-bold text-stone-800 leading-snug">
                Pregnant / Prenatal Massage
                <span class="block text-[10px] font-normal text-orange-700">Relaksasi Pegal Ibu Hamil Posisi Aman</span>
              </td>
              <td class="py-3 px-2 text-stone-500 whitespace-nowrap">Trimester 2 & 3</td>
              <td class="py-3 px-1.5 text-stone-500 text-center whitespace-nowrap">60 mnt</td>
              <td class="py-3 px-3 sm:px-4 text-right whitespace-nowrap">
                <span class="text-[11px] text-stone-400 line-through block leading-tight">Rp120.000</span>
                <span class="inline-block px-2 py-0.5 rounded-full bg-[#ffedd5] text-[#c2410c] font-bold text-xs shadow-2xs">
                  Rp100.000
                </span>
              </td>
            </tr>

            <tr class="price-row cursor-pointer" onclick="bookWa('Postpartum Recovery Massage', 'Normal / SC', '60 mnt', 'Rp100.000', 'Rp130.000')">
              <td class="py-3 px-3 sm:px-4 font-bold text-stone-800 leading-snug">
                Postpartum Recovery Massage
                <span class="block text-[10px] font-normal text-orange-700">Pemulihan Tubuh Pasca Persalinan</span>
              </td>
              <td class="py-3 px-2 text-stone-500 whitespace-nowrap">Normal / SC</td>
              <td class="py-3 px-1.5 text-stone-500 text-center whitespace-nowrap">60 mnt</td>
              <td class="py-3 px-3 sm:px-4 text-right whitespace-nowrap">
                <span class="text-[11px] text-stone-400 line-through block leading-tight">Rp130.000</span>
                <span class="inline-block px-2 py-0.5 rounded-full bg-[#ffedd5] text-[#c2410c] font-bold text-xs shadow-2xs">
                  Rp100.000
                </span>
              </td>
            </tr>

            <tr class="price-row cursor-pointer" onclick="bookWa('Oksitosin Massage (Full Body)', 'Ibu Menyusui', '60 mnt', 'Rp105.000', 'Rp140.000')">
              <td class="py-3 px-3 sm:px-4 font-bold text-stone-800 leading-snug">
                Oksitosin Massage (Full Body)
                <span class="block text-[10px] font-normal text-orange-700">Pijat Relaksasi Tubuh & Stimulasi ASI</span>
              </td>
              <td class="py-3 px-2 text-stone-500 whitespace-nowrap">Ibu Menyusui</td>
              <td class="py-3 px-1.5 text-stone-500 text-center whitespace-nowrap">60 mnt</td>
              <td class="py-3 px-3 sm:px-4 text-right whitespace-nowrap">
                <span class="text-[11px] text-stone-400 line-through block leading-tight">Rp140.000</span>
                <span class="inline-block px-2 py-0.5 rounded-full bg-[#ffedd5] text-[#c2410c] font-bold text-xs shadow-2xs">
                  Rp105.000
                </span>
              </td>
            </tr>

          </tbody>
        </table>
      </div>

      <div class="p-2.5 bg-orange-50/60 border-t border-orange-100 text-[11px] text-stone-500 text-center">
        🌿 Seluruh treatment moms dilakukan dengan posisi miring aman sesuai SOP kebidanan
      </div>
    </section>

    <!-- SECTION 3: KALA BUNDLE (Full Width) -->
    <section id="sec-bundle" class="bg-white rounded-3xl border border-orange-200 shadow-xs overflow-hidden mb-5 sm:mb-6">
      
      <!-- Header Card: KALA BUNDLE -->
      <div class="px-4 sm:px-5 py-3.5 bg-gradient-to-r from-orange-50 via-orange-100/50 to-orange-50 border-b border-orange-200 flex items-center justify-between">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-full bg-amber-200/80 text-amber-900 flex items-center justify-center text-base">
            🎁
          </div>
          <div>
            <span class="px-3 py-0.5 rounded-full bg-[#ea583a] text-white font-extrabold text-xs sm:text-sm uppercase tracking-wider font-brand shadow-2xs">
              KALA BUNDLE
            </span>
          </div>
        </div>
        <span class="text-[11px] font-bold text-orange-800 bg-orange-50 px-2 py-0.5 rounded-md">
          Paket Hemat & Tradisi
        </span>
      </div>

      <!-- Table KALA BUNDLE -->
      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs sm:text-[13px]">
          <thead class="bg-orange-50/70 text-[#ea583a] font-bold border-b border-orange-100">
            <tr>
              <th class="py-2.5 px-3 sm:px-4">Layanan</th>
              <th class="py-2.5 px-2 whitespace-nowrap">Usia / Sasaran</th>
              <th class="py-2.5 px-1.5 text-center whitespace-nowrap">Durasi</th>
              <th class="py-2.5 px-3 sm:px-4 text-right whitespace-nowrap">Tarif & Promo</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-orange-100 font-medium text-stone-700" id="table-body-bundle">
            
            <tr class="price-row cursor-pointer" onclick="bookWa('Selapan – Cukur + Pijat Ceria', 'Bayi 0 - 12 Bulan', '55 mnt', 'Rp80.000', 'Rp115.000')">
              <td class="py-3 px-3 sm:px-4 font-bold text-stone-800 leading-snug">
                Selapan – Cukur + Pijat Ceria
                <span class="block text-[10px] font-normal text-orange-700">Cukur Bersih + Pijat Ceria Bayi</span>
              </td>
              <td class="py-3 px-2 text-stone-500 whitespace-nowrap">Bayi 0 - 12 Bulan</td>
              <td class="py-3 px-1.5 text-stone-500 text-center whitespace-nowrap">55 mnt</td>
              <td class="py-3 px-3 sm:px-4 text-right whitespace-nowrap">
                <span class="text-[11px] text-stone-400 line-through block leading-tight">Rp115.000</span>
                <span class="inline-block px-2 py-0.5 rounded-full bg-[#ffedd5] text-[#c2410c] font-bold text-xs shadow-2xs">
                  Rp80.000
                </span>
              </td>
            </tr>

            <tr class="price-row cursor-pointer" onclick="bookWa('Selapan – Cukur + Pijat Pulih Ceria', 'Bayi 0 - 12 Bulan', '55 mnt', 'Rp90.000', 'Rp135.000')">
              <td class="py-3 px-3 sm:px-4 font-bold text-stone-800 leading-snug">
                Selapan – Cukur + Pijat Pulih Ceria
                <span class="block text-[10px] font-normal text-orange-700">Cukur + Pijat Terapi Bapil/Kembung</span>
              </td>
              <td class="py-3 px-2 text-stone-500 whitespace-nowrap">Bayi 0 - 12 Bulan</td>
              <td class="py-3 px-1.5 text-stone-500 text-center whitespace-nowrap">55 mnt</td>
              <td class="py-3 px-3 sm:px-4 text-right whitespace-nowrap">
                <span class="text-[11px] text-stone-400 line-through block leading-tight">Rp135.000</span>
                <span class="inline-block px-2 py-0.5 rounded-full bg-[#ffedd5] text-[#c2410c] font-bold text-xs shadow-2xs">
                  Rp90.000
                </span>
              </td>
            </tr>

            <tr class="price-row cursor-pointer" onclick="bookWa('Selapan Full – Cukur + Ceria + Mandi', 'Bayi 0 - 12 Bulan', '80 mnt', 'Rp100.000', 'Rp155.000')">
              <td class="py-3 px-3 sm:px-4 font-bold text-stone-800 leading-snug">
                Selapan Full – Cukur + Ceria + Mandi
                <span class="block text-[10px] font-normal text-orange-700">Paket Komplit Bersih Wangi</span>
              </td>
              <td class="py-3 px-2 text-stone-500 whitespace-nowrap">Bayi 0 - 12 Bulan</td>
              <td class="py-3 px-1.5 text-stone-500 text-center whitespace-nowrap">80 mnt</td>
              <td class="py-3 px-3 sm:px-4 text-right whitespace-nowrap">
                <span class="text-[11px] text-stone-400 line-through block leading-tight">Rp155.000</span>
                <span class="inline-block px-2 py-0.5 rounded-full bg-[#ffedd5] text-[#c2410c] font-bold text-xs shadow-2xs">
                  Rp100.000
                </span>
              </td>
            </tr>

            <tr class="price-row cursor-pointer" onclick="bookWa('Selapan Full – Cukur + Pulih Ceria + Mandi', 'Bayi 0 - 12 Bulan', '80 mnt', 'Rp110.000', 'Rp175.000')">
              <td class="py-3 px-3 sm:px-4 font-bold text-stone-800 leading-snug">
                Selapan Full – Cukur + Pulih Ceria + Mandi
                <span class="block text-[10px] font-normal text-orange-700">Cukur + Pijat Bapil + Mandi Higienis</span>
              </td>
              <td class="py-3 px-2 text-stone-500 whitespace-nowrap">Bayi 0 - 12 Bulan</td>
              <td class="py-3 px-1.5 text-stone-500 text-center whitespace-nowrap">80 mnt</td>
              <td class="py-3 px-3 sm:px-4 text-right whitespace-nowrap">
                <span class="text-[11px] text-stone-400 line-through block leading-tight">Rp175.000</span>
                <span class="inline-block px-2 py-0.5 rounded-full bg-[#ffedd5] text-[#c2410c] font-bold text-xs shadow-2xs">
                  Rp110.000
                </span>
              </td>
            </tr>

            <tr class="price-row cursor-pointer" onclick="bookWa('Pra-Kelahiran – Perineum + Yoga', 'Ibu Hamil (34-36 mgg)', '60 mnt', 'Rp85.000', 'Rp140.000')">
              <td class="py-3 px-3 sm:px-4 font-bold text-stone-800 leading-snug">
                Pra-Kelahiran – Perineum + Yoga
                <span class="block text-[10px] font-normal text-orange-700">Elastisitas Jalan Lahir & Relaksasi</span>
              </td>
              <td class="py-3 px-2 text-stone-500 whitespace-nowrap">Ibu Hamil (34-36 mgg)</td>
              <td class="py-3 px-1.5 text-stone-500 text-center whitespace-nowrap">60 mnt</td>
              <td class="py-3 px-3 sm:px-4 text-right whitespace-nowrap">
                <span class="text-[11px] text-stone-400 line-through block leading-tight">Rp140.000</span>
                <span class="inline-block px-2 py-0.5 rounded-full bg-[#ffedd5] text-[#c2410c] font-bold text-xs shadow-2xs">
                  Rp85.000
                </span>
              </td>
            </tr>

            <tr class="price-row cursor-pointer" onclick="bookWa('Pra-Kelahiran – Yoga + Breast Care', 'Ibu Hamil (Min. 36 mgg)', '70 mnt', 'Rp85.000', 'Rp180.000')">
              <td class="py-3 px-3 sm:px-4 font-bold text-stone-800 leading-snug">
                Pra-Kelahiran – Yoga + Breast Care
                <span class="block text-[10px] font-normal text-orange-700">Gentle Yoga + Siapkan Kolostrum ASI</span>
              </td>
              <td class="py-3 px-2 text-stone-500 whitespace-nowrap">Ibu Hamil (Min. 36 mgg)</td>
              <td class="py-3 px-1.5 text-stone-500 text-center whitespace-nowrap">70 mnt</td>
              <td class="py-3 px-3 sm:px-4 text-right whitespace-nowrap">
                <span class="text-[11px] text-stone-400 line-through block leading-tight">Rp180.000</span>
                <span class="inline-block px-2 py-0.5 rounded-full bg-[#ffedd5] text-[#c2410c] font-bold text-xs shadow-2xs">
                  Rp85.000
                </span>
              </td>
            </tr>

            <tr class="price-row cursor-pointer" onclick="bookWa('Pra-Kelahiran – Perineum + Breast Care', 'Ibu Hamil (Min. 36 mgg)', '70 mnt', 'Rp85.000', 'Rp180.000')">
              <td class="py-3 px-3 sm:px-4 font-bold text-stone-800 leading-snug">
                Pra-Kelahiran – Perineum + Breast Care
                <span class="block text-[10px] font-normal text-orange-700">Persiapan Lahiran Normal & ASI Lancar</span>
              </td>
              <td class="py-3 px-2 text-stone-500 whitespace-nowrap">Ibu Hamil (Min. 36 mgg)</td>
              <td class="py-3 px-1.5 text-stone-500 text-center whitespace-nowrap">70 mnt</td>
              <td class="py-3 px-3 sm:px-4 text-right whitespace-nowrap">
                <span class="text-[11px] text-stone-400 line-through block leading-tight">Rp180.000</span>
                <span class="inline-block px-2 py-0.5 rounded-full bg-[#ffedd5] text-[#c2410c] font-bold text-xs shadow-2xs">
                  Rp85.000
                </span>
              </td>
            </tr>

            <tr class="price-row cursor-pointer" onclick="bookWa('Pra-Kelahiran Lengkap (3-in-1)', 'Ibu Hamil (Min. 36 mgg)', '100 mnt', 'Rp150.000', 'Rp250.000')">
              <td class="py-3 px-3 sm:px-4 font-bold text-stone-800 leading-snug">
                Pra-Kelahiran Lengkap (3-in-1)
                <span class="block text-[10px] font-normal text-orange-700">Yoga + Perineum + Breast Care</span>
              </td>
              <td class="py-3 px-2 text-stone-500 whitespace-nowrap">Ibu Hamil (Min. 36 mgg)</td>
              <td class="py-3 px-1.5 text-stone-500 text-center whitespace-nowrap">100 mnt</td>
              <td class="py-3 px-3 sm:px-4 text-right whitespace-nowrap">
                <span class="text-[11px] text-stone-400 line-through block leading-tight">Rp250.000</span>
                <span class="inline-block px-2 py-0.5 rounded-full bg-[#ffedd5] text-[#c2410c] font-bold text-xs shadow-2xs">
                  Rp150.000
                </span>
              </td>
            </tr>

            <tr class="price-row cursor-pointer" onclick="bookWa('Duo – Mom & Baby Ceria Newborn', '1 Ibu + 1 Bayi', '100 mnt', 'Rp150.000', 'Rp190.000')">
              <td class="py-3 px-3 sm:px-4 font-bold text-stone-800 leading-snug">
                Duo – Mom & Baby Ceria Newborn
                <span class="block text-[10px] font-normal text-orange-700">Postpartum Massage + Pijat Bayi</span>
              </td>
              <td class="py-3 px-2 text-stone-500 whitespace-nowrap">1 Ibu + 1 Bayi</td>
              <td class="py-3 px-1.5 text-stone-500 text-center whitespace-nowrap">100 mnt</td>
              <td class="py-3 px-3 sm:px-4 text-right whitespace-nowrap">
                <span class="text-[11px] text-stone-400 line-through block leading-tight">Rp190.000</span>
                <span class="inline-block px-2 py-0.5 rounded-full bg-[#ffedd5] text-[#c2410c] font-bold text-xs shadow-2xs">
                  Rp150.000
                </span>
              </td>
            </tr>

            <tr class="price-row cursor-pointer" onclick="bookWa('Laktasi Booster (Breast + Oksitosin Punggung)', 'Ibu Menyusui', '80 mnt', 'Rp140.000', 'Rp200.000')">
              <td class="py-3 px-3 sm:px-4 font-bold text-stone-800 leading-snug">
                Laktasi Booster (Punggung)
                <span class="block text-[10px] font-normal text-orange-700">Breast Care + Oksitosin Punggung</span>
              </td>
              <td class="py-3 px-2 text-stone-500 whitespace-nowrap">Ibu Menyusui</td>
              <td class="py-3 px-1.5 text-stone-500 text-center whitespace-nowrap">80 mnt</td>
              <td class="py-3 px-3 sm:px-4 text-right whitespace-nowrap">
                <span class="text-[11px] text-stone-400 line-through block leading-tight">Rp200.000</span>
                <span class="inline-block px-2 py-0.5 rounded-full bg-[#ffedd5] text-[#c2410c] font-bold text-xs shadow-2xs">
                  Rp140.000
                </span>
              </td>
            </tr>

            <tr class="price-row cursor-pointer" onclick="bookWa('Laktasi Total (Breast + Oksitosin Full Body)', 'Ibu Menyusui', '100 mnt', 'Rp155.000', 'Rp250.000')">
              <td class="py-3 px-3 sm:px-4 font-bold text-stone-800 leading-snug">
                Laktasi Total (Full Body)
                <span class="block text-[10px] font-normal text-orange-700">Breast Care + Oksitosin Seluruh Tubuh</span>
              </td>
              <td class="py-3 px-2 text-stone-500 whitespace-nowrap">Ibu Menyusui</td>
              <td class="py-3 px-1.5 text-stone-500 text-center whitespace-nowrap">100 mnt</td>
              <td class="py-3 px-3 sm:px-4 text-right whitespace-nowrap">
                <span class="text-[11px] text-stone-400 line-through block leading-tight">Rp250.000</span>
                <span class="inline-block px-2 py-0.5 rounded-full bg-[#ffedd5] text-[#c2410c] font-bold text-xs shadow-2xs">
                  Rp155.000
                </span>
              </td>
            </tr>

          </tbody>
        </table>
      </div>

      <div class="p-2.5 bg-orange-50/60 border-t border-orange-100 text-[11px] text-stone-500 text-center">
        ✨ Lebih hemat hingga 40% dibandingkan memesan satuan
      </div>
    </section>

    <!-- SECTION 4: KALA TERAPI / ADD ON (Full Width) -->
    <section id="sec-addon" class="bg-white rounded-3xl border border-orange-200 shadow-xs overflow-hidden mb-6">
      
      <!-- Header Card: KALA TERAPI (ADD ON) -->
      <div class="px-4 sm:px-5 py-3.5 bg-gradient-to-r from-orange-50 via-orange-100/50 to-orange-50 border-b border-orange-200 flex items-center justify-between">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-full bg-teal-100 text-teal-800 flex items-center justify-center text-base font-bold">
            ＋
          </div>
          <div>
            <span class="px-3 py-0.5 rounded-full bg-[#ea583a] text-white font-extrabold text-xs sm:text-sm uppercase tracking-wider font-brand shadow-2xs">
              KALA TERAPI (ADD ON)
            </span>
          </div>
        </div>
        <span class="text-[11px] font-bold text-orange-800 bg-orange-50 px-2 py-0.5 rounded-md">
          Tindakan Medis Penunjang
        </span>
      </div>

      <!-- Table KALA TERAPI -->
      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs sm:text-[13px]">
          <thead class="bg-orange-50/70 text-[#ea583a] font-bold border-b border-orange-100">
            <tr>
              <th class="py-2.5 px-3 sm:px-4">Layanan</th>
              <th class="py-2.5 px-2 whitespace-nowrap">Usia / Sasaran</th>
              <th class="py-2.5 px-1.5 text-center whitespace-nowrap">Durasi</th>
              <th class="py-2.5 px-3 sm:px-4 text-right whitespace-nowrap">Tarif & Promo</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-orange-100 font-medium text-stone-700" id="table-body-addon">
            
            <tr class="price-row cursor-pointer" onclick="bookWa('Infrared (Sinar Moksa)', 'Bayi & Anak', '15 mnt', 'Rp15.000', 'Rp25.000')">
              <td class="py-3 px-3 sm:px-4 font-bold text-stone-800 leading-snug">
                Infrared (Sinar Moksa)
                <span class="block text-[10px] font-normal text-orange-700">Terapi Hangat Pelega Saluran Napas</span>
              </td>
              <td class="py-3 px-2 text-stone-500 whitespace-nowrap">Bayi & Anak</td>
              <td class="py-3 px-1.5 text-stone-500 text-center whitespace-nowrap">15 mnt</td>
              <td class="py-3 px-3 sm:px-4 text-right whitespace-nowrap">
                <span class="text-[11px] text-stone-400 line-through block leading-tight">Rp25.000</span>
                <span class="inline-block px-2 py-0.5 rounded-full bg-[#ffedd5] text-[#c2410c] font-bold text-xs shadow-2xs">
                  Rp15.000
                </span>
              </td>
            </tr>

            <tr class="price-row cursor-pointer" onclick="bookWa('Nebulizer Saline', 'Bayi & Anak', '20 mnt', 'Rp35.000', 'Rp45.000')">
              <td class="py-3 px-3 sm:px-4 font-bold text-stone-800 leading-snug">
                Nebulizer Saline
                <span class="block text-[10px] font-normal text-orange-700">Terapi Uap NaCl 0.9% Encerkan Lendir</span>
              </td>
              <td class="py-3 px-2 text-stone-500 whitespace-nowrap">Bayi & Anak</td>
              <td class="py-3 px-1.5 text-stone-500 text-center whitespace-nowrap">20 mnt</td>
              <td class="py-3 px-3 sm:px-4 text-right whitespace-nowrap">
                <span class="text-[11px] text-stone-400 line-through block leading-tight">Rp45.000</span>
                <span class="inline-block px-2 py-0.5 rounded-full bg-[#ffedd5] text-[#c2410c] font-bold text-xs shadow-2xs">
                  Rp35.000
                </span>
              </td>
            </tr>

            <tr class="price-row cursor-pointer" onclick="bookWa('Nebulizer + Obat', 'Bayi & Anak', '20 mnt', 'Rp50.000', 'Rp60.000')">
              <td class="py-3 px-3 sm:px-4 font-bold text-stone-800 leading-snug">
                Nebulizer + Obat
                <span class="block text-[10px] font-normal text-orange-700">Terapi Uap + Obat Bronkodilator</span>
              </td>
              <td class="py-3 px-2 text-stone-500 whitespace-nowrap">Bayi & Anak</td>
              <td class="py-3 px-1.5 text-stone-500 text-center whitespace-nowrap">20 mnt</td>
              <td class="py-3 px-3 sm:px-4 text-right whitespace-nowrap">
                <span class="text-[11px] text-stone-400 line-through block leading-tight">Rp60.000</span>
                <span class="inline-block px-2 py-0.5 rounded-full bg-[#ffedd5] text-[#c2410c] font-bold text-xs shadow-2xs">
                  Rp50.000
                </span>
              </td>
            </tr>

          </tbody>
        </table>
      </div>

      <div class="p-2.5 bg-orange-50/60 border-t border-orange-100 text-[11px] text-stone-500 text-center">
        🩺 Add-on diambil bersamaan dengan paket pijat bayi atau anak untuk efektivitas maksimal
      </div>
    </section>

    <!-- Footer Banner: 4 Trust Badges (Matching flyer bottom) -->
    <footer class="bg-white rounded-3xl border border-orange-200 p-4 sm:p-6 shadow-xs mb-4">
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
        
        <div class="flex flex-col items-center justify-center p-2 rounded-2xl bg-orange-50/40">
          <div class="w-9 h-9 rounded-xl bg-orange-100/70 text-[#ea583a] flex items-center justify-center text-base mb-1">
            🏠
          </div>
          <span class="text-xs font-bold text-stone-800 font-brand">Homecare Service</span>
          <span class="text-[11px] text-stone-500">Datang ke Rumah</span>
        </div>

        <div class="flex flex-col items-center justify-center p-2 rounded-2xl bg-orange-50/40">
          <div class="w-9 h-9 rounded-xl bg-orange-100/70 text-[#ea583a] flex items-center justify-center text-base mb-1">
            🛡️
          </div>
          <span class="text-xs font-bold text-stone-800 font-brand">Bidan Profesional</span>
          <span class="text-[11px] text-stone-500">Bersertifikasi STR</span>
        </div>

        <div class="flex flex-col items-center justify-center p-2 rounded-2xl bg-orange-50/40">
          <div class="w-9 h-9 rounded-xl bg-orange-100/70 text-[#ea583a] flex items-center justify-center text-base mb-1">
            ❤️
          </div>
          <span class="text-xs font-bold text-stone-800 font-brand">Aman & Nyaman</span>
          <span class="text-[11px] text-stone-500">Steril Terpercaya</span>
        </div>

        <div class="flex flex-col items-center justify-center p-2 rounded-2xl bg-orange-50/40">
          <div class="w-9 h-9 rounded-xl bg-orange-100/70 text-[#ea583a] flex items-center justify-center text-base mb-1">
            🩺
          </div>
          <span class="text-xs font-bold text-[#ea583a] font-brand">Bunda Bahagia</span>
          <span class="text-[11px] text-stone-500">Si Kecil Juga Sehat</span>
        </div>

      </div>

      <div class="mt-4 pt-3 border-t border-orange-100 text-center text-[11px] text-stone-400">
        Klik baris mana saja pada pricelist di atas untuk langsung terhubung ke WhatsApp Bidan Yusi.
      </div>
    </footer>

  </main>

  <!-- Sticky Bottom Bar: WhatsApp Booking CTA (Mobile-friendly, no overlap) -->
  <div class="fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur-md border-t border-orange-200 px-3 sm:px-4 py-2.5 sm:py-3 shadow-lg">
    <div class="max-w-4xl mx-auto flex items-center justify-between gap-3">
      <div class="hidden sm:block">
        <div class="text-xs font-bold text-stone-800 font-brand">Kala Moms and Baby Spa</div>
        <div class="text-[11px] text-stone-500">Reservasi Homecare Cepat Area Surabaya & Sidoarjo</div>
      </div>
      
      <div class="flex-1 sm:flex-initial flex items-center gap-2">
        <a 
          id="mainWaBtn" 
          href="#" 
          onclick="openGeneralWa()" 
          class="pulse-btn w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-[#008069] hover:bg-[#00a884] text-white px-5 py-3 sm:py-2.5 rounded-full font-bold text-xs sm:text-sm shadow-sm transition-all active:scale-[0.98]"
        >
          <svg class="w-4 h-4 sm:w-5 sm:h-5 fill-current" viewBox="0 0 24 24">
            <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/>
          </svg>
          <span>Chat & Tanya Jadwal WhatsApp</span>
        </a>
      </div>
    </div>
  </div>

  <script>
    const clinicPhone = '6281390541340';

    function buildWaLink(text) {
      return 'https://wa.me/' + clinicPhone + '?text=' + encodeURIComponent(text);
    }

    function bookWa(name, target, duration, promoPrice, origPrice) {
      let priceText = promoPrice;
      if (origPrice && origPrice !== promoPrice) {
        priceText = promoPrice + ' (Harga Promo, normal ' + origPrice + ')';
      }
      const msg = 'Halo Bidan Yusi, saya melihat pricelist Kala Moms and Baby Spa dan ingin reservasi:\\n\\n' +
                  '• *Layanan:* ' + name + '\\n' +
                  '• *Sasaran/Usia:* ' + target + '\\n' +
                  '• *Durasi:* ' + duration + '\\n' +
                  '• *Tarif:* ' + priceText + '\\n\\n' +
                  'Boleh dibantu info jadwal kosong terdekat untuk homecare ke rumah ya Bunda? Terima kasih 🙏😊';
      window.open(buildWaLink(msg), '_blank');
    }

    function openGeneralWa() {
      const msg = 'Halo Bidan Yusi, saya melihat pricelist Kala Moms and Baby Spa dan ingin konsultasi jadwal treatment homecare ke rumah Bunda. Boleh dibantu info slot kosong ya? Terima kasih 😊';
      window.open(buildWaLink(msg), '_blank');
    }

    function scrollToSection(id) {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }

    function filterPricelist() {
      const q = document.getElementById('pricelistSearch').value.toLowerCase().trim();
      const clearBtn = document.getElementById('clearPricelistBtn');
      if (q.length > 0) {
        clearBtn.classList.remove('hidden');
      } else {
        clearBtn.classList.add('hidden');
      }

      const rows = document.querySelectorAll('.price-row');
      rows.forEach(row => {
        const text = row.innerText.toLowerCase();
        if (text.includes(q)) {
          row.style.display = '';
        } else {
          row.style.display = 'none';
        }
      });
    }

    function clearSearch() {
      document.getElementById('pricelistSearch').value = '';
      document.getElementById('clearPricelistBtn').classList.add('hidden');
      const rows = document.querySelectorAll('.price-row');
      rows.forEach(row => row.style.display = '');
    }
  </script>

</body>
</html>
`;

// Tulis ke target artifact
const targetDir = 'C:\\\\Users\\\\Ivan\\\\.gemini\\\\antigravity\\\\brain\\\\99eb895a-b37f-4e15-b8a8-d1bfbc974d9f';
const artifactPath = path.join(targetDir, 'pricelist.html');
fs.writeFileSync(artifactPath, html, 'utf8');
console.log('Successfully updated pricelist artifact to:', artifactPath);

// Tulis juga copy ke src/landing/public/pricelist.html
const publicPath = path.join(process.cwd(), 'src', 'landing', 'public', 'pricelist.html');
fs.writeFileSync(publicPath, html, 'utf8');
console.log('Successfully updated repo copy to:', publicPath);
