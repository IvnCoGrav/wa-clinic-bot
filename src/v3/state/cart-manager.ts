import { PatientProfileExtractor } from './patient-extractor';

/** Satu item layanan di keranjang (multi-item cart, deterministik). */
export interface CartItem {
  name: string;
  price: number;
  promoPrice?: number;
  type: 'PRIMARY' | 'ADDON' | 'SERVICE';
  category?: 'BABY' | 'KIDS' | 'MOMS' | 'BUNDLE' | 'ADDON';
  /** Label penerima tampil: 'Si Kecil', 'Adik (2 bln)', 'Kakak (3 th)', 'Bunda'. */
  recipientLabel?: string;
  recipientScope?: RecipientScope;
}

/** Scope penerima layanan: satu anak yang sama vs pasien berbeda. */
export type RecipientScope = 'MOMS' | 'CHILD_1' | 'CHILD_2' | 'GENERAL';

export interface LocationState {
  rawText: string;
  kelurahan?: string;
  kecamatan?: string;
  kota?: string;
  distanceKm?: number;
  ongkirNormal?: number;
  ongkirPromo?: number;
  isOutOfCoverage?: boolean;
}

export interface ChildState {
  id?: string;
  name?: string;
  /** Label penerima: 'Adik' | 'Kakak' | 'Si Kecil'. */
  roleLabel?: string;
  ageMonths?: number;
  symptoms: string[];
}

/** Subjek layanan multi-audience (Moms & Baby Spa): ibu, bayi, anak, atau keduanya. */
export type TargetAudienceType = 'MOMS' | 'BABY' | 'KIDS' | 'BOTH';

/** Kondisi klinis ibu: hamil, paska salin/nifas, atau relaksasi umum. */
export type MomStage = 'PREGNANT' | 'POSTPARTUM' | 'GENERAL';

/** Data klinis ibu (first-class, terpisah dari data anak — anti kontaminasi silang). */
export interface MomProfileState {
  stage?: MomStage;
  /** Usia kehamilan dalam minggu (misal: 38 untuk "uk 38 weeks"). */
  gestationalWeeks?: number;
  /** Durasi paska salin (misal: "2 minggu") — teks bebas dari customer. */
  postpartumPeriod?: string;
  /** Keluhan ibu (misal: pegal, kaki bengkak, capek, asi). */
  complaints: string[];
}

export interface BookingState {
  preferredDate?: string;
  preferredTime?: string;
  reservationId?: string;
  isConfirmed: boolean;
  /**
   * Skema human handling pasca-reservasi (sesi 462651): true bila reservasi
   * tercatat dan ketersediaan masih menunggu verifikasi staf. Mengaktifkan
   * acknowledgement gate di agent-runner (1x closing + handoff, anti loop).
   */
  needsStaffVerification?: boolean;
  /** True bila closing pasca-reservasi sudah dikirim (ack berikutnya senyap). */
  handoffClosingSent?: boolean;
  /**
   * Audit 337101 (anti CTA-looping): waktu yang DIMINTA customer
   * ("sekarang"/"hari ini"/nama hari) — dicatat saat sinyal jadwal terdeteksi
   * walau reservasi BELUM dibuat. Berbeda dari preferredDate (kesepakatan
   * yang sudah dikonfirmasi alur reservasi). Dipakai context-aware CTA.
   */
  requestedTimeHint?: string;
}

export interface CustomerGoalSession {
  customerName?: string;
  genderGreeting: 'Bunda' | 'Bapak';
  location?: LocationState;
  /** Subjek layanan: MOMS (ibu), BABY/KIDS (anak), BOTH (Mom & Baby bundle). */
  targetAudience?: TargetAudienceType;
  /** Profil klinis ibu (kehamilan/nifas/relaksasi) — first-class, bukan childProfile. */
  momProfile?: MomProfileState;
  /** Profil anak pertama (backward compat). Multi-anak memakai `children`. */
  childProfile?: ChildState;
  /** Daftar anak (Adik/Kakak). childProfile selalu mirror children[0]. */
  children?: ChildState[];
  /**
   * Gerbang disambiguasi multi-anak (sesi 214956): true bila 2 usia anak
   * berbeda terdeteksi TANPA konfirmasi eksplisit ("anak saya 2" / label
   * peran Adik-Kakak). Selama true, LLM WAJIB bertanya konfirmasi lembut
   * sebelum mengunci total biaya (lihat mandat grounding). Dibersihkan saat
   * customer memberi sinyal jumlah eksplisit.
   */
  isMultiChildUnconfirmed?: boolean;
  selectedTreatment?: string;
  booking?: BookingState;
  cartItems?: CartItem[];
  ongkirStatus?: 'UNQUOTED' | 'QUOTED' | 'CONFIRMED';
  totalPrice?: number;
  /**
   * Audit 854065 (MODE KONSULTASI vs TRANSASIONAL): true bila customer sudah
   * pernah bertanya harga/total di sesi ini. Mengontrol eksposur angka total
   * resmi di grounding prompt (disembunyikan selama konsultasi murni).
   */
  priceDiscussed?: boolean;
  /**
   * Fase E: penghitung form reservasi tak lengkap berurutan. Direset ke 0
   * saat form valid masuk; mencapai 2 → form tak lengkap berikutnya
   * dieskalasi sunyi (anti loop minta-lengkapi selamanya).
   */
  formRetryCount?: number;
}

/**
 * Kata generik domain klinik — DILARANG menjadi token tunggal unik penentu
 * fuzzy matching. Mencegah sapaan bot ("Treatment moms & Baby...") memicu
 * phantom cart item via satu kata umum yang kebetulan unik di katalog.
 */
export const GENERIC_CLINIC_TOKENS = new Set([
  'treatment', 'treatments', 'layanan', 'service', 'services', 'homecare',
  'perawatan', 'terapi', 'therapy', 'pijat', 'massage', 'paket',
  'bunda', 'bayi', 'baby', 'anak', 'moms', 'klinik',
]);

export class CartManager {
  /**
   * Deteksi scope penerima — CATEGORY-FIRST fondational (Akar 3):
   * metadata kategori katalog adalah penentu utama scope, bukan keyword teks.
   * Keyword teks hanya fallback bila kategori kosong/tak dikenal (layanan
   * custom tanpa kategori). Ini mencegah cross-contamination: kata "Bunda"
   * (sapaan di hampir semua pesan) atau "oksitosin" di kalimat yang sama
   * DILARANG memindahkan layanan BABY ke MOMS, dan sebaliknya.
   *
   * - MOMS → selalu 'MOMS'
   * - BABY/KIDS → slot anak (CHILD_2 bila eksplisit "kakak", else CHILD_1);
   *   DILARANG 'MOMS' walau teks mengandung "Bunda"/"oksitosin".
   * - BUNDLE (paket keluarga) → 'GENERAL'
   * - ADDON/ADD_ON → 'GENERAL' (tambahan menempel ke total, bukan pasien spesifik)
   */
  public static detectRecipientScope(
    text: string,
    service?: { name?: string; category?: string; isAddon?: boolean }
  ): RecipientScope {
    const lower = (text || '').toLowerCase();
    const hasAny = (words: string[]) => words.some((w) => lower.includes(w));

    // RULE 1 (FONDATIONAL): kategori katalog menentukan scope.
    // Honorifik "kakak sebutkan" DILARANG memindahkan layanan BABY/KIDS ke CHILD_2.
    const isHonorific = PatientProfileExtractor.isKakakHonorific(text);
    const hasRealKakak = hasAny(['kakak', 'kaka', 'anak pertama', 'anak ke-1', 'anak ke 1', 'si kakak']) && !isHonorific;
    const cat = (service?.category || '').toUpperCase();
    if (cat === 'MOMS') return 'MOMS';
    if (cat === 'BABY' || cat === 'KIDS') {
      if (hasRealKakak) return 'CHILD_2';
      return 'CHILD_1';
    }
    if (cat === 'BUNDLE') return 'GENERAL';
    if (cat === 'ADDON' || cat === 'ADD_ON' || service?.isAddon === true) return 'GENERAL';

    // RULE 2 (FALLBACK): hanya bila kategori tidak ada/kosong/tak dikenal —
    // logika keyword lama dipertahankan untuk layanan custom tanpa metadata.
    if (
      hasAny(['oksitosin', 'laktasi', 'nifas', 'hamil', 'menyusui', 'buat saya', 'untuk saya', 'saya sendiri', 'bunda sendiri'])
    ) {
      return 'MOMS';
    }
    if (hasRealKakak) return 'CHILD_2';
    if (hasAny(['adik', 'adek', 'anak kedua', 'anak ke-2', 'anak ke 2', 'si kecil', 'bayi', 'baby', 'anak saya'])) return 'CHILD_1';
    return 'GENERAL';
  }

  /**
   * Pertanyaan durasi/umum saja (misal "pijat bayi berapa menit") — BUKAN sinyal
   * pembelian. Pesan seperti ini dilewati saat sinkronisasi keranjang.
   */
  public static isDurationOnlyQuestion(text: string): boolean {
    const lower = (text || '').toLowerCase();
    const asksDuration = lower.includes('menit') || lower.includes('durasi') || lower.includes('berapa lama');
    if (!asksDuration) return false;
    // Sinyal nominal presisi: 'rp' hanya hitung bila berupa token kata utuh
    // (/\brp\b/) — kata slang "brp" (berapa) BUKAN sinyal pembelian.
    const hasRpToken = /\brp\b/i.test(lower);
    const buyingSignal = hasRpToken || [
      'harga', 'tarif', 'booking', 'jadwal', 'ambil', 'mau', 'jadwalkan',
      'ribu', 'batuk', 'pilek', 'bapil', 'grok', 'demam', 'kembung', 'kolik', 'rewel',
    ].some((w) => lower.includes(w));
    return !buyingSignal;
  }

  /**
   * Sinkronisasi keranjang layanan dari riwayat obrolan (deterministik, 0 token).
   * Aturan: PRIMARY satu scope saling menggantikan (replace); scope berbeda atau
   * ADDON diakumulasikan (add). Pesan pertanyaan-durasi-saja dilewati.
   * Mengembalikan cart baru (tidak mutasi session).
   */
  public static syncCartItems(
    session: CustomerGoalSession,
    history: Array<{ role: string; content: string }>,
    catalog: Array<{ name: string; promoPrice?: number | null; originalPrice?: number | null; category?: string; isAddon?: boolean; id?: string; bundleItemIds?: string[] }>
  ): CartItem[] {
    // Phase 2 (audit 315036) — rekonsiliasi hierarki bundle vs parsial via
    // metadata katalog (bundleItemIds), BUKAN daftar nama hardcode:
    // - bundle yang baru dipilih menyerap komponen parsialnya (exact id match)
    //   + standalone se-famili di jalur anak (mencegah inflasi cart);
    // - standalone MOMS tidak pernah terserap kecuali komponen exact
    //   (jalur klinis ibu terpisah);
    // - item warisan DB (session.cartItems) di-seed ulang lewat aturan yang
    //   sama sehingga inflasi lama ikut bersih + totalPrice terkalkulasi ulang.
    const cart: CartItem[] = [];
    const keyOf = (name: string, scope: RecipientScope) => `${scope}::${name.toLowerCase()}`;
    const inCart = new Set<string>();
    const services = [...(catalog || [])]
      .filter((s) => s && s.name && s.name.trim().length >= 4)
      .sort((a, b) => b.name.length - a.name.length);
    const svcById = new Map<string, (typeof services)[number]>();
    const svcByName = new Map<string, (typeof services)[number]>();
    for (const s of services) {
      if (s.id) svcById.set(s.id.toLowerCase(), s);
      svcByName.set(s.name.toLowerCase(), s);
    }
    const compIdsOf = (svc: (typeof services)[number]): Set<string> =>
      new Set((svc.bundleItemIds || []).map((id) => (id || '').toLowerCase()));
    const familyOf = (svc: (typeof services)[number]): Set<string> => {
      const f = new Set<string>();
      if (svc.category) f.add(svc.category.toUpperCase());
      for (const cid of compIdsOf(svc)) {
        const c = svcById.get(cid);
        if (c?.category) f.add(c.category.toUpperCase());
      }
      return f;
    };
    const isBundleSvc = (svc: (typeof services)[number]): boolean =>
      (svc.category || '').toUpperCase() === 'BUNDLE' || (svc.bundleItemIds || []).length > 0;
    const scopeCompatible = (bundleScope: RecipientScope, xScope: RecipientScope): boolean =>
      xScope === bundleScope || bundleScope === 'GENERAL' || xScope === 'GENERAL';
    // Bundle yang baru masuk menyerap item lama yang diduplikasinya.
    const absorbIntoBundle = (bundleSvc: (typeof services)[number], bundleScope: RecipientScope): void => {
      const comps = compIdsOf(bundleSvc);
      const family = familyOf(bundleSvc);
      for (let i = cart.length - 1; i >= 0; i--) {
        const it = cart[i];
        if (it.type === 'ADDON') continue;
        const xSvc = svcByName.get((it.name || '').toLowerCase());
        if (!xSvc || isBundleSvc(xSvc)) continue;
        const xScope = it.recipientScope || 'GENERAL';
        if (!scopeCompatible(bundleScope, xScope)) continue;
        const isComponent = xSvc.id != null && comps.has(xSvc.id.toLowerCase());
        const xChildTrack = xScope === 'CHILD_1' || xScope === 'CHILD_2' || xScope === 'GENERAL';
        const xCat = (xSvc.category || '').toUpperCase();
        if (isComponent || (xChildTrack && xCat !== 'MOMS' && family.has(xCat))) {
          inCart.delete(keyOf(it.name, xScope));
          cart.splice(i, 1);
        }
      }
    };
    // Standalone yang komponennya sudah terwakili bundle se-scope → lewati.
    const isAbsorbedByExistingBundle = (svc: (typeof services)[number], scope: RecipientScope): boolean => {
      const xid = (svc.id || '').toLowerCase();
      if (!xid) return false;
      for (const c of cart) {
        const bSvc = svcByName.get((c.name || '').toLowerCase());
        if (!bSvc || !isBundleSvc(bSvc)) continue;
        if (!scopeCompatible(c.recipientScope || 'GENERAL', scope)) continue;
        if (compIdsOf(bSvc).has(xid)) return true;
      }
      return false;
    };
    if (services.length === 0) return cart;
    const significantTokens = (name: string): string[] =>
      name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
    // Token khas yang hanya dimiliki SATU layanan katalog (misal "oksitosin"):
    // sekali disebut langsung mengidentifikasi layanan tersebut.
    const tokenOwnerCount = new Map<string, number>();
    for (const s of services) {
      const seen = new Set<string>();
      for (const t of significantTokens(s.name)) {
        if (!seen.has(t)) { seen.add(t); tokenOwnerCount.set(t, (tokenOwnerCount.get(t) || 0) + 1); }
      }
    }
    // Parafrasa ("cukur bayi" ~ "Cukur Rambut Bayi"): ≥2 token signifikan cocok & rasio ≥50%,
    // ATAU satu token khas panjang (≥7 huruf, unik 1 layanan, BUKAN kata generik
    // klinik) seperti "oksitosin". Kata generik ("treatment", "pijat", ...)
    // tidak boleh menjadi penentu tunggal agar sapaan bot tidak memicu phantom item.
    const fuzzyMatches = (text: string, name: string): boolean => {
      const toks = significantTokens(name);
      if (toks.length === 0) return false;
      if (toks.some((t) => t.length >= 7 && !GENERIC_CLINIC_TOKENS.has(t) && text.includes(t) && tokenOwnerCount.get(t) === 1)) return true;
      const hits = toks.filter((t) => text.includes(t)).length;
      if (hits >= 2 && hits / toks.length >= 0.5) return true;
      // Fallback: filter generic tokens for ratio (e.g., "pulih ceria" vs "Pijat Bayi Pulih Ceria")
      const filteredToks = toks.filter((t) => !GENERIC_CLINIC_TOKENS.has(t));
      if (filteredToks.length > 0) {
        const filteredHits = filteredToks.filter((t) => text.includes(t)).length;
        if (filteredHits >= 2 && filteredHits / filteredToks.length >= 0.5) return true;
      }
      return false;
    };
    const pushService = (s: (typeof services)[number], scope: RecipientScope) => {
      const price = typeof s.originalPrice === 'number' ? s.originalPrice : 0;
      const type = s.isAddon ? 'ADDON' : (s.category === 'BUNDLE' ? 'SERVICE' : 'PRIMARY');
      const category = (s.category as CartItem['category']) || (s.isAddon ? 'ADDON' : undefined);
      const recipientLabel = scope === 'MOMS' ? 'Bunda' : scope === 'CHILD_2' ? 'Kakak' : scope === 'CHILD_1' ? 'Si Kecil' : undefined;
      // Phase 2 (audit 315036): standalone yang komponennya sudah terwakili
      // bundle se-scope → lewati (parsial terserap bundle, anti inflasi).
      if (type !== 'ADDON' && !isBundleSvc(s) && isAbsorbedByExistingBundle(s, scope)) return;
      // Phase 2: bundle yang baru dipilih menyerap item lama yang diduplikasinya.
      if (isBundleSvc(s) && !s.isAddon) absorbIntoBundle(s, scope);
      // Domain rule: Single PRIMARY per recipient (1 anak = 1 layanan utama)
      // Jika PRIMARY baru untuk scope yang sama dan beda layanan -> replace (tanpa keyword)
      if (type === 'PRIMARY') {
        const idx = cart.findIndex((c) => c.type === 'PRIMARY' && (c.recipientScope || 'GENERAL') === scope);
        if (idx >= 0) {
          if (cart[idx].name.toLowerCase() === s.name.toLowerCase()) return;
          inCart.delete(keyOf(cart[idx].name, scope));
          cart[idx] = { name: s.name, price, promoPrice: typeof s.promoPrice === 'number' ? s.promoPrice : price, type, category, recipientLabel, recipientScope: scope };
          inCart.add(keyOf(s.name, scope));
          return;
        }
      } else if (type === 'ADDON') {
        // ADDON bersifat akumulatif, jangan replace
        if (inCart.has(keyOf(s.name, scope))) return;
        cart.push({
          name: s.name, price,
          promoPrice: typeof s.promoPrice === 'number' ? s.promoPrice : price,
          type, category, recipientLabel, recipientScope: scope,
        });
        inCart.add(keyOf(s.name, scope));
        return;
      }
      if (inCart.has(keyOf(s.name, scope))) return;
      cart.push({
        name: s.name, price,
        promoPrice: typeof s.promoPrice === 'number' ? s.promoPrice : price,
        type, category, recipientLabel, recipientScope: scope,
      });
      inCart.add(keyOf(s.name, scope));
    };
    // Normalisasi nama katalog: buang kualifikasi dalam kurung di AKHIR nama
    // resmi (mis. 'Pijat Bayi Ceria (Rileksasi)' -> 'pijat bayi ceria') agar
    // sebutan chat tanpa kurung tetap cocok presisi. Operasi string murni pada
    // label katalog terstruktur (BUKAN mutilasi kalimat bahasa alami).
    const cleanNameOf = (name: string): string => {
      const t = (name || '').trim();
      if (t.endsWith(')')) {
        const open = t.lastIndexOf('(');
        if (open > 0) return t.slice(0, open).trim().toLowerCase();
      }
      return t.toLowerCase();
    };
    // Bentuk nama yang cocok di teks: nama resmi utuh dulu, lalu nama bersih.
    // HANYA kecocokan nama utuh yang menekan jalur fuzzy (perilaku lama
    // dipertahankan); kecocokan nama-bersih bersifat tambahan (push saja) agar
    // parafrasa pendamping (mis. "pulih ceria" + "sinar moksa") tetap tertangkap.
    const fullFormOf = (haystack: string, s: (typeof services)[number]): string | null => {
      const full = s.name.toLowerCase();
      return haystack.includes(full) ? full : null;
    };
    const cleanFormOf = (haystack: string, s: (typeof services)[number]): string | null => {
      const full = s.name.toLowerCase();
      if (haystack.includes(full)) return null;
      const clean = cleanNameOf(s.name);
      if (clean.length >= 4 && clean !== full && haystack.includes(clean)) return clean;
      return null;
    };
    const matchedFormOf = (haystack: string, s: (typeof services)[number]): string | null =>
      fullFormOf(haystack, s) || cleanFormOf(haystack, s);
    // Phase 2 (audit 315036): seed ulang item warisan DB lewat aturan yang
    // SAMA (termasuk absorb bundle) agar inflasi lama ikut bersih; label
    // penerima tersimpan dipertahankan bila ada (mis. "Adik (2 bln)").
    // Item tak dikenal katalog dipertahankan apa adanya (anti data-loss).
    for (const stored of (session.cartItems || [])) {
      const svc = svcByName.get((stored.name || '').toLowerCase());
      if (!svc) {
        const k = keyOf(stored.name, stored.recipientScope || 'GENERAL');
        if (!inCart.has(k)) {
          cart.push({ ...stored });
          inCart.add(k);
        }
        continue;
      }
      const scope = stored.recipientScope || CartManager.detectRecipientScope(stored.name, svc);
      pushService(svc, scope);
      const cur = cart.find((c) => c.name.toLowerCase() === svc.name.toLowerCase() && (c.recipientScope || 'GENERAL') === scope);
      if (cur && stored.recipientLabel) cur.recipientLabel = stored.recipientLabel;
    }
    // Sesi 834128 (offer-confirmation gate, anti-kunci sepihak): himpun
    // layanan yang PERNAH cocok di pesan USER (data-driven via matcher
    // katalog yang sama — tanpa daftar frasa hafalan). Tawaran asisten yang
    // memuat ≥2 layanan PRIMARY berbeda DILARANG mengunci keranjang bila
    // TIDAK SATU PUN di antaranya pernah dirujuk user ("boleh deh yang itu"
    // = belum memilih). Tawaran =/= pilihan.
    const userConfirmedNames = new Set<string>();
    for (let u = 0; u < history.length; u++) {
      if ((history[u]?.role || '').toLowerCase() !== 'user') continue;
      const uText = (history[u]?.content || '').toLowerCase();
      if (!uText || CartManager.isDurationOnlyQuestion(uText)) continue;
      for (const s of services) {
        if (matchedFormOf(uText, s) !== null || fuzzyMatches(uText, s.name)) {
          userConfirmedNames.add(s.name.toLowerCase());
        }
      }
    }
    const primaryTypeOf = (s: (typeof services)[number]): string =>
      s.isAddon ? 'ADDON' : (s.category === 'BUNDLE' ? 'SERVICE' : 'PRIMARY');
    // Diproses KRONOLOGIS (tertua → terbaru) agar PRIMARY terbaru menimpa yang lama secara natural (domain rule)
    for (let i = 0; i < history.length; i++) {
      const text = (history[i]?.content || '').toLowerCase();
      if (!text || CartManager.isDurationOnlyQuestion(text)) continue;
      // 1. Nama persis selalu dihitung (semua yang cocok, termasuk pesan asisten).
      //    Filter Substring Overlap: bila bentuk cocok layanan A adalah substring
      //    dari bentuk cocok layanan B yang sama-sama cocok (mis. "Induksi
      //    Massage" vs "Induksi Massage Fullbody"), A gugur — yang
      //    spesifik/panjang menang agar keranjang tidak tertimpa harga yang
      //    salah (Rp 50k vs Rp 105k). Perbandingan memakai bentuk yang benar-benar
      //    cocok (utuh/bersih) agar nama berkurung ikut tercakup.
      const rawFullHits = services.filter((s) => fullFormOf(text, s) !== null);
      const fullHits = rawFullHits.filter((s) =>
        !rawFullHits.some((other) =>
          other !== s && other.name.toLowerCase().includes(s.name.toLowerCase())
        )
      );
      const fullHitSet = new Set(fullHits);
      const rawCleanHits = services.filter((s) => !fullHitSet.has(s) && cleanFormOf(text, s) !== null);
      const acceptedForms = new Map<string, (typeof services)[number]>();
      for (const s of fullHits) acceptedForms.set(s.name.toLowerCase(), s);
      const cleanHits = rawCleanHits.filter((s) => {
        const mine = cleanFormOf(text, s) as string;
        for (const [, other] of acceptedForms) {
          const theirs = matchedFormOf(text, other) as string;
          if (theirs.length > mine.length && theirs.includes(mine)) return false;
        }
        for (const other of rawCleanHits) {
          if (other === s) continue;
          const theirs = cleanFormOf(text, other) as string;
          if (theirs.length > mine.length && theirs.includes(mine)) return false;
        }
        acceptedForms.set(mine, s);
        return true;
      });
      // 2. Tanpa nama resmi UTUH, parafrasa hanya mengambil SATU yang terpanjang
      //    (paling spesifik) agar tidak mengotori keranjang dengan kandidat umum.
      //    Pesan asisten (role === 'assistant') DILARANG memicu fuzzyHits — sapaan
      //    bot ("Treatment moms & Baby...") tidak boleh memasukkan phantom item;
      //    asisten hanya boleh mencocokkan nama layanan resmi utuh.
      //    Anti-kompetisi: kandidat fuzzy WAJIB membawa ≥2 token signifikan yang
      //    BELUM dijelaskan exact-hit pesan ini — sebutan "Pijat Bayi Ceria"
      //    (exact) tidak boleh tertimpa "Pijat Bayi Pulih Ceria" (fuzzy), namun
      //    "pulih ceria" tetap lolos mendampingi "sinar moksa" (exact lain).
      const isAssistant = (history[i]?.role || '').toLowerCase() === 'assistant';
      const coveredTokens = new Set<string>();
      for (const s of [...fullHits, ...cleanHits]) {
        const form = matchedFormOf(text, s);
        if (form) for (const t of significantTokens(form)) coveredTokens.add(t);
      }
      let fuzzyHits = (fullHits.length === 0 && !isAssistant)
        ? services
            .filter((s) => {
              if (!fuzzyMatches(text, s.name)) return false;
              const uncovered = significantTokens(s.name).filter((t) => !coveredTokens.has(t));
              return uncovered.length >= 2;
            })
            .sort((a, b) => b.name.length - a.name.length).slice(0, 2)
        : [];
      // Anti-duplikasi famili Baby vs Kids (audit 983902): "pulih ceria" DILARANG
      // memasukkan 2 varian sekaligus untuk anak yang sama — pilih 1 sesuai audiens.
      if (fuzzyHits.length > 1) {
        // Famili didefinisikan oleh irisan token "pulih" + "ceria" (bukan sigKey exact
        // karena "Pijat Bayi Pulih Ceria" vs "Pijat Kids Pulih Ceria" beda token kids/bayi).
        const isSameFamily = (a: string, b: string): boolean => {
          const ta = new Set(significantTokens(a).filter((t) => !GENERIC_CLINIC_TOKENS.has(t)));
          const tb = new Set(significantTokens(b).filter((t) => !GENERIC_CLINIC_TOKENS.has(t)));
          // famili pulih-ceria: kedua nama mengandung pulih & ceria
          if (ta.has('pulih') && ta.has('ceria') && tb.has('pulih') && tb.has('ceria')) return true;
          const inter = [...ta].filter((t) => tb.has(t));
          return inter.length >= 2;
        };
        // Kelompokkan dengan union-find sederhana
        const groups: Array<typeof fuzzyHits> = [];
        for (const s of fuzzyHits) {
          let placed = false;
          for (const g of groups) {
            if (g.some((m) => isSameFamily(m.name, s.name))) { g.push(s); placed = true; break; }
          }
          if (!placed) groups.push([s]);
        }
        const deduped: typeof fuzzyHits = [];
        for (const arr of groups) {
          if (arr.length === 1) { deduped.push(arr[0]); continue; }
          const audience = (session.targetAudience || '').toUpperCase();
          let winner: typeof arr[number] | null = null;
          const hasRealKakakInText = !PatientProfileExtractor.isKakakHonorific(text) && (text.includes('kakak') || text.includes('kaka'));
          const hasBabySignal = text.includes('adik') || text.includes('adek') || text.includes('bayi') || text.includes('si kecil');
          if (audience === 'BABY' || audience === 'MOMS') winner = arr.find((s) => (s.category||'').toUpperCase()==='BABY') || arr[0];
          else if (audience === 'KIDS') winner = arr.find((s) => (s.category||'').toUpperCase()==='KIDS') || arr[0];
          else if (hasBabySignal && !hasRealKakakInText) winner = arr.find((s) => (s.category||'').toUpperCase()==='BABY') || arr[0];
          else if (hasRealKakakInText && !hasBabySignal) winner = arr.find((s) => (s.category||'').toUpperCase()==='KIDS') || arr[0];
          else winner = arr.find((s) => (s.category||'').toUpperCase()==='BABY') || arr[0];
          deduped.push(winner!);
        }
        fuzzyHits = deduped;
      }
      for (const s of [...fullHits, ...cleanHits, ...fuzzyHits]) {
        // Sesi 834128: tawaran multi-opsi asisten (≥2 PRIMARY berbeda dalam
        // satu pesan) hanya boleh masuk keranjang bila user pernah merujuk
        // itemnya. Tanpa rujukan user, dorong HANYA yang terkonfirmasi;
        // bila tak ada yang terkonfirmasi, lewati semua (tunggu klarifikasi).
        if (isAssistant && primaryTypeOf(s) === 'PRIMARY') {
          const offeredPrimary = new Set(
            [...fullHits, ...cleanHits]
              .filter((o) => primaryTypeOf(o) === 'PRIMARY')
              .map((o) => o.name.toLowerCase())
          );
          if (offeredPrimary.size >= 2) {
            const confirmedOffered = [...offeredPrimary].filter((n) => userConfirmedNames.has(n));
            if (confirmedOffered.length === 0) continue;
            if (!userConfirmedNames.has(s.name.toLowerCase())) continue;
          }
        }
        // Sesi 188034 (proteksi orphan ADDON): terapi pendamping (Moksa/
        // Nebulizer, isAddon) DILARANG menjadi pesanan mandiri. Add-on HANYA
        // masuk bila (a) keranjang berjalan sudah memuat layanan utama, ATAU
        // (b) pesan turn ini juga memuat layanan utama. Tanya konsultasi
        // add-on tanpa paket utama → lewati (SOP: wajib digabung pijat).
        if (primaryTypeOf(s) === 'ADDON') {
          const msgHasNonAddon = [...fullHits, ...cleanHits, ...fuzzyHits]
            .some((x) => primaryTypeOf(x) !== 'ADDON');
          const cartHasNonAddon = cart.some((c) => c.type !== 'ADDON');
          if (!msgHasNonAddon && !cartHasNonAddon) continue;
        }
        pushService(s, CartManager.detectRecipientScope(text, s));
      }
    }
    // Audit 854065 (pending swap): afirmasi pelanggan atas tawaran tukar
    // asisten → selesaikan swap di sini (stateless, deterministik).
    const swap = CartManager.resolveAffirmativeSwap({ cartItems: cart } as CustomerGoalSession, history, catalog);
    if (swap) {
      const idx = cart.findIndex(
        (c) => c.name.toLowerCase() === swap.oldName.toLowerCase()
          && (c.recipientScope || 'GENERAL') === swap.scope
      );
      const bSvc = svcByName.get(swap.newName.toLowerCase());
      if (idx >= 0 && bSvc) {
        const price = typeof bSvc.originalPrice === 'number' ? bSvc.originalPrice : 0;
        const keepLabel = cart[idx].recipientLabel;
        cart[idx] = {
          name: bSvc.name,
          price,
          promoPrice: typeof bSvc.promoPrice === 'number' ? bSvc.promoPrice : price,
          type: bSvc.isAddon ? 'ADDON' : ((bSvc.category === 'BUNDLE' ? 'SERVICE' : 'PRIMARY') as CartItem['type']),
          category: (bSvc.category as CartItem['category']) || undefined,
          recipientLabel: keepLabel,
          recipientScope: swap.scope,
        };
        inCart.delete(keyOf(swap.oldName, swap.scope));
        inCart.add(keyOf(swap.newName, swap.scope));
      }
    }
    // Proteksi Orphan ADDON, gerbang penutup (sesi 188034): bila keranjang
    // akhir tidak memuat layanan utama apa pun (PRIMARY/SERVICE/BUNDLE),
    // bersihkan seluruh item ADDON agar tidak ada tagihan mandiri fiktif
    // (mis. Moksa Rp 15k + ongkir). Add-on yang mendampingi layanan utama
    // tidak tersentuh (hasNonAddon true).
    if (!cart.some((it) => it.type !== 'ADDON')) {
      return cart.filter((it) => it.type !== 'ADDON');
    }
    return cart;
  }

  /**
   * Audit 854065 — Affirmative Swap Resolver (STATELESS, deterministik):
   * bila pesan user TERAKHIR adalah afirmasi pendek ("iya bu saya ambil")
   * dan pesan asisten TEPAT SEBELUMNYA menawarkan layanan B yang belum ada di
   * keranjang, sementara keranjang memuat layanan A se-scope → kembalikan
   * {oldName: A, newName: B, scope} agar cart di-swap (bukan ditumpuk).
   * Deviasi dari plan: tanpa field pendingTreatmentSwap baru (tanpa migrasi
   * skema, tanpa state ofer yang bisa basi) — tawaran dibaca langsung dari
   * riwayat turn sebelumnya. Guard: afirmasi DILARANG memuat kata tanya /
   * negasi / penundaan; B DILARANG add-on; A harus PRIMARY/SERVICE se-scope.
   */
  public static resolveAffirmativeSwap(
    session: CustomerGoalSession,
    history: Array<{ role: string; content: string }>,
    catalog: Array<{ name: string; promoPrice?: number | null; originalPrice?: number | null; category?: string; isAddon?: boolean; id?: string; bundleItemIds?: string[] }>
  ): { oldName: string; newName: string; scope: RecipientScope } | null {
    if (!history || history.length < 2) return null;
    const lastUser = history[history.length - 1];
    if (!lastUser || (lastUser.role || '').toLowerCase() !== 'user') return null;
    // 1. Afirmasi pendek: token-exact, ≤8 token, tanpa tanya/negasi/tunda.
    let norm = '';
    const rawLower = (lastUser.content || '').toLowerCase();
    for (let i = 0; i < rawLower.length; i++) {
      const ch = rawLower[i];
      norm += ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) ? ch : ' ';
    }
    const tokens = norm.split(' ').filter((t) => t.length > 0);
    if (tokens.length === 0 || tokens.length > 8) return null;
    const AFFIRM = ['iya', 'iyaa', 'ya', 'betul', 'benar', 'ambil', 'mau', 'boleh', 'setuju', 'lanjut', 'deal', 'oke', 'ok', 'ganti', 'jadi', 'sip', 'siap'];
    const BLOCK = ['apa', 'berapa', 'kapan', 'bagaimana', 'gimana', 'kenapa', 'dimana', 'mana', 'apakah', 'atau',
      'tidak', 'nggak', 'ngga', 'gak', 'jangan', 'batal', 'nanti', 'pikir', 'tanya', 'tunda', 'dulu', 'belum'];
    if (!tokens.some((t) => AFFIRM.includes(t))) return null;
    if (tokens.some((t) => BLOCK.includes(t))) return null;
    // 2. Tawaran B: nama layanan resmi di pesan asisten TEPAT sebelumnya,
    //    yang BELUM ada di keranjang (terpanjang = paling spesifik).
    let offerText: string | null = null;
    for (let i = history.length - 2; i >= 0; i--) {
      if ((history[i]?.role || '').toLowerCase() === 'assistant') {
        offerText = (history[i]?.content || '').toLowerCase();
        break;
      }
      if ((history[i]?.role || '').toLowerCase() === 'user') break;
    }
    if (!offerText) return null;
    const cartNames = new Set((session.cartItems || []).map((c) => c.name.toLowerCase()));
    // Nama bersih (tanpa kualifikasi kurung akhir) agar tawaran parafrasa
    // asisten ("Pulih Ceria") tetap terpetakan ke layanan resmi.
    const cleanOf = (name: string): string => {
      const t = (name || '').trim();
      if (t.endsWith(')')) {
        const open = t.lastIndexOf('(');
        if (open > 0) return t.slice(0, open).trim().toLowerCase();
      }
      return t.toLowerCase();
    };
    // Proteksi Covered Tokens (anti salah-swap varian se-famili): token
    // signifikan milik item keranjang yang namanya (penuh/bersih) disebut
    // eksplisit oleh asisten di offerText DILARANG memicu fuzzy-match varian
    // lain — mis. cart berisi "Pijat Bayi Pulih Ceria" + asisten menyebutnya
    // tidak boleh men-swap ke "Pijat Kids Pulih Ceria" via token bersama.
    const cartCoveredTokens = new Set<string>();
    for (const c of (session.cartItems || [])) {
      const nm = (c?.name || '').toLowerCase();
      if (!nm) continue;
      const clean = cleanOf(c.name);
      if (offerText.includes(nm) || (clean.length >= 4 && offerText.includes(clean))) {
        for (const t of nm.split(/[^a-z0-9]+/)) {
          if (t.length > 3 && !GENERIC_CLINIC_TOKENS.has(t)) cartCoveredTokens.add(t);
        }
      }
    }
    const candidates = [...(catalog || [])]
      .filter((s) => s && s.name && s.name.trim().length >= 4 && !s.isAddon)
      .filter((s) => {
        if (cartNames.has(s.name.toLowerCase())) return false;
        if (offerText.includes(s.name.toLowerCase())) return true;
        const clean = cleanOf(s.name);
        if (clean.length >= 4 && clean !== s.name.toLowerCase() && offerText.includes(clean)) return true;
        // Tawaran parafrasa asisten ("Pulih Ceria" tanpa prefix): overlap
        // ≥2 token signifikan non-generik (aturan fuzzy yang sama dengan cart).
        const toks = s.name.toLowerCase().split(/[^a-z0-9]+/)
          .filter((t) => t.length > 3 && !GENERIC_CLINIC_TOKENS.has(t));
        const matched = toks.filter((t) => offerText.includes(t));
        // Varian se-famili yang HANYA cocok lewat token milik item cart yang
        // sudah disebut asisten (covered) DILARANG jadi kandidat swap.
        const uncovered = matched.filter((t) => !cartCoveredTokens.has(t));
        return uncovered.length >= 2;
      })
      .sort((a, b) => b.name.length - a.name.length);
    if (candidates.length === 0) return null;
    const offered = candidates[0];
    const scope = CartManager.detectRecipientScope(offerText, offered);
    // 3. Korban A: item PRIMARY/SERVICE se-scope yang namanya berbeda.
    const victim = (session.cartItems || []).find(
      (c) => (c.recipientScope || 'GENERAL') === scope
        && c.name.toLowerCase() !== offered.name.toLowerCase()
        && (c.type === 'PRIMARY' || c.type === 'SERVICE')
    );
    if (!victim) return null;
    return { oldName: victim.name, newName: offered.name, scope };
  }

  /** Total akumulasi: subtotal promo cart + ongkir promo (jika ada). */
  public static calcCartTotal(session: CustomerGoalSession): number {
    const subtotal = (session.cartItems || []).reduce(
      (sum, it) => sum + (typeof it.promoPrice === 'number' ? it.promoPrice : it.price), 0
    );
    const ongkir = session.location?.ongkirPromo ?? 0;
    return subtotal + ongkir;
  }
}
