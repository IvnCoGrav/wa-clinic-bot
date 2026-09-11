import { treatmentCatalogService, ClinicServiceItem } from '../../services/treatment-catalog.service';
import { TEMPLATES } from '../../config/persona';
import { DEFAULT_TENANT_ID } from '../../config/tenant';

export interface GetCatalogInput {
  category?: 'BABY' | 'KIDS' | 'MOMS' | 'BOTH';
  /**
   * Nominal harga yang disebut customer dalam rupiah (sesi 973126, mis. "100rb" -> 100000).
   * Diisi LLM router dari angka nominal di pesan customer. Pencocokan dilakukan
   * data-driven terhadap promoPrice/originalPrice katalog per-tenant lintas kategori.
   */
  targetPrice?: number;
  childAgeMonths?: number;
  /** Usia kehamilan Ibu (minggu) bila pasien adalah Ibu Hamil (kategori MOMS). JANGAN diisi untuk bayi/anak. */
  gestationalWeeks?: number;
  /** Kondisi Ibu: Hamil, Paska Melahirkan/Nifas, atau Relaksasi Umum. */
  momStage?: 'PREGNANT' | 'POSTPARTUM' | 'GENERAL';
  symptoms?: string[];
  specificTreatmentName?: string;
  /**
   * Sinyal intensi harga dari LLM (AI-First): true bila customer menanyakan
   * harga/biaya/tarif/ongkir/promo atau menyebutkan nominal ("60rb ya",
   * "harga berapa"). False bila hanya konsultasi keluhan / kecocokan usia.
   * Harga nominal HANYA dialirkan ke prompt bila true.
   */
  inquirePrice?: boolean;
}

export interface CatalogTreatmentDetail {
  id: string;
  name: string;
  category: string;
  /**
   * Fondational Tool Output Scoping: angka harga/durasi HANYA diisi bila
   * customer eksplisit bertanya harga (inquirePrice === true). Saat false,
   * field ini dihapus (undefined) agar LLM tidak bisa "melihat" nominal di
   * konteks JSON tool result — LLM tidak bisa membocorkan yang tak ia tahu.
   */
  durationMinutes?: number;
  originalPrice?: number;
  promoPrice?: number;
  description: string;
  isRecommendedForSymptoms?: boolean;
}

export interface GetCatalogOutput {
  success: boolean;
  treatments: CatalogTreatmentDetail[];
  recommendationReason?: string;
  suggestedPriceReply?: string;
  /**
   * Template total resmi keranjang multi-item (sesi 214956): dihitung 100%
   * mesin dari snapshot cart + ongkir sesi. Dipakai panduan LLM DAN fallback
   * swap saat validator menolak total halusinasi.
   */
  cartTotalReply?: string;
  /**
   * Audit 854065 (MODE KONSULTASI): diisi HANYA bila inquirePrice === false —
   * panduan manfaat klinis tanpa nominal & tanpa todongan jadwal, agar Call 2
   * punya template konsultasi resmi (bukan menjiplak template transaksional).
   */
  suggestedConsultationReply?: string;
  message: string;
}

/**
 * Phase 4 (audit 222655): konteks ongkir sesi aktif untuk template total
 * otomatis. Struct minimal (bukan full session) agar tool tetap decoupled
 * dan testable; diisi agent-runner via tool-registry dari session terbaru.
 */
export interface CatalogSessionContext {
  kelurahan?: string;
  ongkirPromo?: number | null;
  ongkirNormal?: number | null;
  ongkirStatus?: string;
  /**
   * Snapshot keranjang sesi (sesi 214956): bila ≥2 item, tool menyusun
   * template total resmi multi-item (dihitung mesin, bukan LLM).
   */
  cartItems?: Array<{ name: string; promoPrice?: number | null; price?: number | null }>;
}

export const GET_CATALOG_TOOL_SCHEMA = {
  type: 'function',
  function: {
    name: 'get_catalog_and_price',
    description: 'WAJIB dipanggil untuk SETIAP pertanyaan keluhan fisik, ketersediaan perawatan, atau tanya harga. Mengambil daftar layanan/treatment resmi, harga asli, harga promo, durasi, dan rekomendasi terapi yang tepat berdasarkan usia anak atau keluhan/gejala. Jika ongkir sesi sudah diketahui, tool otomatis menggabungkan harga treatment + ongkir menjadi total keseluruhan di suggestedPriceReply. Rekomendasikan layanan dengan skor tertinggi dari hasil tool ini; DILARANG mengarang nama layanan di luar hasil tool.',
    parameters: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['BABY', 'KIDS', 'MOMS', 'BOTH'],
          description: 'Kategori sasaran treatment: BABY (0-24 bln), KIDS (2-10 thn), MOMS (Ibu hamil/nifas/relaksasi), atau BOTH (Paket Mom & Baby).'
        },
        childAgeMonths: {
          type: 'number',
          description: 'Usia bayi/anak (bulan) jika pasien adalah bayi/anak. JANGAN diisi untuk kehamilan ibu.'
        },
        gestationalWeeks: {
          type: 'number',
          description: 'Usia kehamilan Ibu (minggu) jika pasien adalah Ibu Hamil (kategori MOMS).'
        },
        momStage: {
          type: 'string',
          enum: ['PREGNANT', 'POSTPARTUM', 'GENERAL'],
          description: 'Kondisi Ibu (Hamil, Paska Melahirkan/Nifas, atau Relaksasi Umum).'
        },
        symptoms: {
          type: 'array',
          items: { type: 'string' },
          description: 'Daftar keluhan klinis (berlaku universal untuk bayi maupun ibu).'
        },
        specificTreatmentName: {
          type: 'string',
          description: 'Nama treatment spesifik yang ditanyakan oleh customer (misal: "Pijat Bayi Ceria", "Pijat Bayi Pulih Ceria", "Cukur Rambut Bayi").'
        },
        inquirePrice: {
          type: 'boolean',
          description: 'Set true HANYA jika customer eksplisit menanyakan ANGKA biaya (kata: harga, tarif, ongkos, biaya, pricelist, berapa, diskon, promo, atau menyebut nominal seperti "60rb ya"). WAJIB false untuk: penjelasan cara kerja/khasiat ("gimana ya / seperti apa"), DAN untuk pertanyaan ketersediaan/nama paket ("dipaket apa ya", "ada paket apa", "paket ibu apa saja", "bisa treatment apa") — itu BUKAN pertanyaan harga, jawab dengan narasi manfaat tanpa nominal.'
        },
        targetPrice: {
          type: 'number',
          description: 'Nominal rupiah yang disebut customer (mis. "100rb" -> 100000, "60 ribu" -> 60000). WAJIB diisi bila customer menyebut angka nominal tanpa nama paket. Tool mencocokkan promoPrice/originalPrice katalog lintas kategori (MOMS/BABY/KIDS) dan mengembalikan klarifikasi paket mana yang sesuai nominal.'
        }
      }
    }
  }
};

export async function executeGetCatalog(
  input: GetCatalogInput,
  tenantId: string = DEFAULT_TENANT_ID,
  sessionCtx?: CatalogSessionContext
): Promise<GetCatalogOutput> {
  const { category, childAgeMonths, gestationalWeeks, momStage, symptoms = [], specificTreatmentName, inquirePrice, targetPrice } = input;
  void gestationalWeeks;
  // AI-First price grounding: nominal rupiah HANYA mengalir ke prompt LLM
  // bila LLM menilai customer butuh rincian harga (inquirePrice === true).
  // Menyebut nominal ("100rb") = bertanya harga → paksa showPrices true.
  const hasTargetPrice = typeof targetPrice === 'number' && Number.isFinite(targetPrice) && targetPrice > 0;
  const showPrices = inquirePrice === true || hasTargetPrice;

  try {
    const allServices = treatmentCatalogService.getAllServices(true, tenantId);
    let filtered: ClinicServiceItem[] = [...allServices];
    // Sesi 973126: klarifikasi nominal lintas kategori (data-driven dari katalog
    // per-tenant, bukan hafalan). Diisi bila targetPrice cocok dengan ≥1 layanan.
    let priceClarification: string | undefined = undefined;

    // 1. Filter kategori
    // Audit 222655 (0-24 Months Bridge): balita < 24 bulan yang terquery KIDS
    // WAJIB tetap melihat pijat BABY yang fit usia — KIDS massage mulai 24 bln
    // sehingga tanpa bridge hanya Bubble Spa (specialty) yang tersisa.
    const toddlerBridgeActive = category === 'KIDS'
      && childAgeMonths !== undefined && childAgeMonths !== null && childAgeMonths < 24;
    if (category) {
      filtered = filtered.filter(s => {
        if (s.category === category) return true;
        if (category === 'BABY' && s.category === 'BUNDLE') return true;
        if (toddlerBridgeActive && s.category === 'BABY' && s.ageTier
          && s.ageTier.maxAgeMonths !== null && s.ageTier.maxAgeMonths >= childAgeMonths
          && (s.ageTier.minAgeMonths ?? 0) <= childAgeMonths) {
          return true;
        }
        return false;
      });
    }

    // 2. Filter usia jika ada
    if (childAgeMonths !== undefined && childAgeMonths !== null) {
      filtered = filtered.filter(s => {
        const tier = s.ageTier;
        if (!tier) return true;
        if (tier.minAgeMonths > childAgeMonths) return false;
        if (tier.maxAgeMonths !== null && tier.maxAgeMonths < childAgeMonths) return false;
        return true;
      });
    }

    // 2b. Pencocokan nominal harga lintas kategori (sesi 973126):
    // bila targetPrice diisi dan TANPA specificTreatmentName/symptoms yang
    // eksplisit, JANGAN kunci ke satu kategori tebakan (mis. BABY). Cari di
    // seluruh katalog per-tenant yang promo/normal-nya == targetPrice, lalu
    // jadikan pool utama agar Prenatal 100rb tidak terfilter keluar.
    if (hasTargetPrice && !specificTreatmentName?.trim() && (symptoms || []).length === 0) {
      const priceHits = treatmentCatalogService.findServicesByPrice(Number(targetPrice), 0, tenantId);
      if (priceHits.length > 0) {
        const hitIds = new Set(priceHits.map((s) => s.id));
        // Pool utama = yang cocok nominal; sisakan 1 pembanding lintas-audiens
        // (mis. bayi vs ibu) agar LLM bisa mengklarifikasi, bukan mengarang.
        const comparator = allServices.find((s) =>
          !hitIds.has(s.id)
          && (s.category === 'BABY' || s.category === 'MOMS')
          && !treatmentCatalogService.isAddonService(s)
        );
        filtered = comparator ? [...priceHits, comparator] : [...priceHits];
        const fmtRp = (n: number): string => `Rp ${Number(n).toLocaleString('id-ID')}`;
        const hitLines = priceHits.slice(0, 4).map((s) =>
          `${s.name} ${fmtRp(s.promoPrice)} promo (normal ${fmtRp(s.originalPrice)}, ${s.durationMinutes} mnt)`
        ).join('; ');
        priceClarification = `Nominal ${fmtRp(Number(targetPrice))} sesuai dengan: ${hitLines}.`
          + (comparator
            ? ` Pembanding: ${comparator.name} ${fmtRp(comparator.promoPrice)} promo (${comparator.durationMinutes} mnt) — tanyakan subjek pasien (Bunda/si kecil) bila belum jelas.`
            : ` Tanyakan subjek pasien (Bunda/si kecil) bila belum jelas.`);
      }
    }

    // 3. Pencarian nama spesifik jika customer menanyakan paket tertentu
    if (specificTreatmentName && specificTreatmentName.trim()) {
      const query = specificTreatmentName.toLowerCase();
      const matched = filtered.filter(s => s.name.toLowerCase().includes(query) || s.description.toLowerCase().includes(query));
      if (matched.length > 0) {
        filtered = matched;
      }
    }

    // 4. Rekomendasi SEMANTIK DINAMIS via service terpusat (Zero-Code Admin):
    // satu algoritma konsisten di seluruh codebase. Skor tertinggi ditandai
    // isRecommendedForSymptoms.
    const formattedTreatments: CatalogTreatmentDetail[] = filtered.map(item => {
      return {
        id: item.id,
        name: item.name,
        category: item.category,
        durationMinutes: item.durationMinutes,
        originalPrice: item.originalPrice,
        promoPrice: item.promoPrice,
        description: item.description,
        isRecommendedForSymptoms: false
      };
    });

    if ((symptoms || []).length > 0) {
      const recommended = treatmentCatalogService.recommendServiceBySymptoms(
        symptoms, childAgeMonths ?? null, category as any
      );
      if (recommended) {
        const hit = formattedTreatments.find((t) => t.id === recommended.id);
        if (hit) hit.isRecommendedForSymptoms = true;
        else {
          // Fallback: bila recommended tidak ada di filtered (mis. filter usia
          // menyempitkan pool), tandai kecocokan nama terdekat di filtered.
          const fallback = formattedTreatments.find((t) => t.name.toLowerCase() === recommended.name.toLowerCase());
          if (fallback) fallback.isRecommendedForSymptoms = true;
        }
      }
    }

    // Urutkan yang direkomendasikan di atas. Audit 222655 (toddler bridge):
    // bila bridge aktif, pijat STANDARD yang fit usia didahulukan atas paket
    // specialty (Bubble Spa tanpa serviceType STANDARD) — data-driven via
    // serviceType + kecocokan nama 'pijat', tanpa hardcode id layanan.
    const serviceById = new Map(filtered.map((s) => [s.id, s]));
    const isBridgeMassage = (id: string): boolean => {
      if (!toddlerBridgeActive) return false;
      const s = serviceById.get(id);
      return !!s && (s as any).serviceType === 'STANDARD' && s.name.toLowerCase().includes('pijat');
    };
    // Audit 337101 (therapy routing, DATA-DRIVEN non-hardcode): bila ada
    // keluhan, skor overlap token gejala atas nama+deskripsi resmi katalog
    // menjadi kunci urut sekunder — layanan terapi penanganan keluhan naik,
    // relaksasi murni (skor 0) tenggelam secara alami TANPA daftar nama
    // hafalan. Cermin logika recommendServiceBySymptoms, tapi di atas pool
    // tenant yang sudah terfilter (tenant-correct).
    const symptomToks = symptoms.length > 0
      ? symptoms.flatMap((s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/)).filter((w) => w.length > 3)
      : [];
    const therapyScoreOf = (id: string): number => {
      if (symptomToks.length === 0) return 0;
      const s = serviceById.get(id);
      if (!s) return 0;
      const nl = s.name.toLowerCase();
      const dl = (s.description || '').toLowerCase();
      let sc = 0;
      for (const tok of symptomToks) {
        if (nl.includes(tok)) sc += 4;
        else if (dl.includes(tok)) sc += 2;
      }
      return sc;
    };
    formattedTreatments.sort((a, b) =>
      ((b.isRecommendedForSymptoms ? 1 : 0) - (a.isRecommendedForSymptoms ? 1 : 0))
      || (therapyScoreOf(b.id) - therapyScoreOf(a.id))
      || ((isBridgeMassage(b.id) ? 1 : 0) - (isBridgeMassage(a.id) ? 1 : 0))
    );

    // Phase 2 — Clinical linkage: ibu PASCA MELAHIRKAN (bayi sudah lahir)
    // DILARANG ditawari Prenatal (Pijat Hamil). Keluarkan layanan prenatal
    // dari daftar (kecuali customer menyebut namanya eksplisit via
    // specificTreatmentName — intent eksplisit menang), lalu posisikan
    // Oksitosin Fullbody & Paket Laktasi di urutan 1 & 2.
    if (category === 'MOMS' && momStage === 'POSTPARTUM') {
      const isPrenatalId = (id: string): boolean =>
        id === 'moms-prenatal-massage' || id === 'moms-prenatal-yoga';
      const explicitPrenatalQuery = (specificTreatmentName || '').toLowerCase();
      const explicitlyWantsPrenatal = explicitPrenatalQuery.includes('prenatal')
        || explicitPrenatalQuery.includes('hamil')
        || explicitPrenatalQuery.includes('yoga');
      // Intent eksplisit menang: lewati SELURUH reorder klinis (filter + demosi).
      if (!explicitlyWantsPrenatal) {
        const pool = formattedTreatments.filter((t) => !isPrenatalId(t.id));
        const priorityOf = (id: string): number =>
          id === 'moms-oksitosin-fullbody' ? 0
          : id === 'moms-paket-laktasi' ? 1
          : isPrenatalId(id) ? 99 : 2;
        pool.sort((a, b) => {
          const p = priorityOf(a.id) - priorityOf(b.id);
          if (p !== 0) return p;
          return (b.isRecommendedForSymptoms ? 1 : 0) - (a.isRecommendedForSymptoms ? 1 : 0);
        });
        formattedTreatments.length = 0;
        formattedTreatments.push(...pool);
      }
    }

    // Fondational Tool Output Scoping (Akar 1): bila customer TIDAK bertanya
    // harga, hapus angka harga/durasi dari objek treatment SEBELUM dikembalikan
    // sebagai tool result ke LLM. Prompt "DILARANG menyebut harga" hanyalah
    // safety net — garis pertahanan utama adalah data tak pernah dikirim.
    // Downstream yang membaca field ini (numeric validator, cart sync,
    // observability trace) wajib handle undefined (sudah guard typeof === 'number').
    if (!showPrices) {
      for (const t of formattedTreatments) {
        delete (t as any).originalPrice;
        delete (t as any).promoPrice;
        delete (t as any).durationMinutes;
      }
    }

    const formatRp = (n: number): string => `Rp ${n.toLocaleString('id-ID')}`;

    // Alasan rekomendasi DINAMIS dari properti layanan teratas (nama + deskripsi
    // resmi dashboard). Nominal harga hanya disisipkan bila showPrices.
    let recommendationReason: string | undefined = undefined;
    const topService = formattedTreatments.find((t) => t.isRecommendedForSymptoms);
    if (topService) {
      // Catatan: saat !showPrices, field numerik sudah di-strip di atas namun
      // cabang ini tidak memakai angka (priceLine='.', comboLine='') — aman.
      const priceLine = showPrices
        ? ` promo ${formatRp(Number(topService.promoPrice ?? 0))} (normal ${formatRp(Number(topService.originalPrice ?? 0))}, durasi ${Number(topService.durationMinutes ?? 0)} menit).`
        : '.';
      const moksa = allServices.find((s) => s.id.includes('moksa'));
      const topText = `${topService.name} ${topService.description}`.toLowerCase();
      const isRespiratory = /pernapasan|dahak|flu|bapil|pilek|batuk/i.test(topText);
      const comboLine = (showPrices && moksa && topService.id !== moksa.id && isRespiratory)
        ? ` Paket Combo ${topService.name} + Sinar Moksa total Promo ${formatRp(Number(topService.promoPrice ?? 0) + moksa.promoPrice)} (normal ${formatRp(Number(topService.originalPrice ?? 0) + moksa.originalPrice)}).`
        : '';
      recommendationReason = `Berdasarkan keluhan yang disampaikan (${symptoms.join(', ')}), layanan yang paling sesuai adalah ${topService.name}${priceLine} ${topService.description}${comboLine}`;
    }

    // Phase 1 — Anti-brochure: format deskripsi percakapan mengalir (satu baris
    // per opsi: nama + harga + deskripsi manfaat), TANPA label kaku "Rincian:",
    // "Promo"/"Normal" bertele-tele, atau bullet bertingkat — LLM menjiplak
    // format tool result, jadi tool result sendiri wajib bernada percakapan.
    const summaryList = formattedTreatments.slice(0, 4).map(t =>
      showPrices
        ? `• *${t.name}* (Promo ${formatRp(Number(t.promoPrice ?? 0))}, normal ${formatRp(Number(t.originalPrice ?? 0))}, ${Number(t.durationMinutes ?? 0)} menit): ${t.description}`
        : `• *${t.name}*: ${t.description}`
    ).join('\n');

    let suggestedPriceReply: string | undefined = undefined;
    if (showPrices && (formattedTreatments.length === 1 || specificTreatmentName)) {
      const target = formattedTreatments[0];
      if (target && target.promoPrice != null && target.originalPrice != null && target.durationMinutes != null) {
        // Audit 222655 (amnesia total biaya): bila ongkir sesi sudah QUOTED,
        // template WAJIB menggabungkan treatment + ongkir promo = total
        // keseluruhan (anti "hanya Rp 70.000 tanpa total"). Tanpa ongkir sesi,
        // pakai template harga murni (tanpa todongan jadwal — priceInfo memang
        // tidak memuat CTA hari; CTA jadwal terpisah di priceCta).
        const quotedOngkir = sessionCtx?.ongkirPromo;
        if (quotedOngkir != null && Number.isFinite(Number(quotedOngkir))) {
          const grand = Number(target.promoPrice) + Number(quotedOngkir);
          const area = sessionCtx?.kelurahan ? ` ke ${sessionCtx.kelurahan}` : '';
          suggestedPriceReply = `Untuk *${target.name}*, durasinya ${target.durationMinutes} menit dan saat ini ada promo jadi *Rp ${Number(target.promoPrice).toLocaleString('id-ID')}* (harga normal *Rp ${Number(target.originalPrice).toLocaleString('id-ID')}*). Ditambah ongkir promo${area} (*Rp ${Number(quotedOngkir).toLocaleString('id-ID')}*), total keseluruhannya menjadi *Rp ${grand.toLocaleString('id-ID')}* ya Bunda 😊`;
        } else {
          suggestedPriceReply = TEMPLATES.priceInfo({
            name: target.name,
            durationMinutes: target.durationMinutes,
            normalPrice: target.originalPrice,
            promoPrice: target.promoPrice,
          });
        }
      }
    }

    // Sesi 214956 — Total resmi multi-item dihitung MESIN (bukan mental LLM):
    // bila snapshot cart memuat ≥2 item dan harga ditanya, susun template
    // total resmi agar LLM tinggal mengutip (anti 75k+105k+15k=120k).
    let cartTotalReply: string | undefined = undefined;
    const cartSnap = Array.isArray(sessionCtx?.cartItems) ? sessionCtx.cartItems : [];
    if (showPrices && cartSnap.length >= 2) {
      const pick = (c: { promoPrice?: number | null; price?: number | null }): number =>
        typeof c.promoPrice === 'number' ? c.promoPrice : (typeof c.price === 'number' ? c.price : 0);
      const parts = cartSnap.map((c) => `${String(c.name || 'Layanan')} ${formatRp(pick(c))}`);
      const sub = cartSnap.reduce((s, c) => s + pick(c), 0);
      const ong = sessionCtx?.ongkirPromo;
      const ongKnown = typeof ong === 'number' && Number.isFinite(ong);
      const grand = sub + (ongKnown ? Number(ong) : 0);
      const rincian = ongKnown ? `${parts.join(' + ')} + Ongkir ${formatRp(Number(ong))}` : parts.join(' + ');
      cartTotalReply = `Untuk keranjang saat ini, total resmi yang sudah dihitung sistem adalah *Rp ${grand.toLocaleString('id-ID')}* (${rincian}) ya Bunda 😊`;
    }

    // Audit 854065 (MODE KONSULTASI vs TRANSASIONAL): bila customer TIDAK
    // bertanya harga, sediakan template konsultasi resmi — fokus manfaat
    // klinis, TANPA penjumlahan nominal, TANPA todongan jadwal. Komplemen
    // dari suggestedPriceReply/cartTotalReply yang khusus mode transaksional.
    let suggestedConsultationReply: string | undefined = undefined;
    if (!showPrices && formattedTreatments.length > 0) {
      const focus = formattedTreatments.find((t) => t.isRecommendedForSymptoms) || formattedTreatments[0];
      if (focus) {
        suggestedConsultationReply = `Pilihan yang bagus Bunda 😊 *${focus.name}* ini ${focus.description} Nantinya bisa kami sesuaikan dengan kondisi si kecil. Saat ini si kecil apakah sedang ada keluhan tertentu, atau untuk pijat sehat relaksasi saja Bunda? 🤗\n\n(Panduan sistem: JANGAN sebut nominal rupiah/lama waktu, JANGAN todong jadwal hari — customer belum bertanya harga, masih tahap konsultasi.)`;
      }
    }

    // Sesi 973126: bila nominal dicocokkan, tutup pemantik klinis generik diganti
    // klarifikasi subjek pasien (Bunda vs si kecil) — paket belum dipilih.
    const closingGuide = priceClarification
      ? 'Wajib sebutkan paket yang sesuai nominal di atas beserta durasinya, lalu tanyakan ramah apakah perawatan untuk Bunda atau si kecil (paket BELUM dipilih — DILARANG mengunci satu paket sepihak).'
      : 'Wajib tutup dengan pertanyaan pemantik klinis: tanyakan apakah saat ini si kecil sedang ada keluhan sakit (batuk/pilek/kembung) atau ingin pijat sehat relaksasi saja.';
    return {
      success: true,
      treatments: formattedTreatments.slice(0, 5),
      recommendationReason,
      suggestedPriceReply,
      cartTotalReply,
      suggestedConsultationReply,
      message: `Ditemukan ${formattedTreatments.length} pilihan perawatan:\n${summaryList}${priceClarification ? `\n\nKlarifikasi Nominal (data katalog — WAJIB dikutip, DILARANG mengarang):\n"${priceClarification}"` : ''}${recommendationReason ? `\n\nCatatan Rekomendasi: ${recommendationReason}` : ''}${suggestedPriceReply ? `\n\nFormat Penyampaian Harga Bidan Yusi yang Disarankan:\n"${suggestedPriceReply}"` : ''}${cartTotalReply ? `\n\nTotal Resmi Keranjang Multi-Item (sudah dijumlahkan sistem — JANGAN hitung ulang):\n"${cartTotalReply}"\nBila customer menanyakan total belanjaan, WAJIB kutip angka total resmi di atas persis apa adanya. DILARANG menghitung sendiri atau mengubah nominal!` : ''}${suggestedConsultationReply ? `\n\nMode Konsultasi (customer BELUM bertanya harga — JANGAN sebut nominal, JANGAN todong jadwal):\n"${suggestedConsultationReply}"` : ''}\n\nPanduan Bidan: Sampaikan opsi di atas dalam 1 PARAGRAF narasi yang hangat dan mengalir (maksimal 2-3 kalimat), DILARANG membuat bullet list bertingkat ATAU daftar bernomor kaku "1. ... 2. ..." layaknya menu brosur! ${closingGuide}`
    };
  } catch (error: any) {
    console.error(JSON.stringify({ event: 'V3_TOOL_CATALOG_ERROR', tenantId, error: error.message, timestamp: new Date().toISOString() }));
    return {
      success: false,
      treatments: [],
      message: `Gagal mengambil katalog: ${error.message}`
    };
  }
}
