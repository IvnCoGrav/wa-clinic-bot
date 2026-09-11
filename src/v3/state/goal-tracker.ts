import { prisma } from '../../db/client';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { treatmentCatalogService } from '../../services/treatment-catalog.service';

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
   * Audit 337101 (anti CTA-looping): waktu yang DIMINTA customer
   * ("sekarang"/"hari ini"/nama hari) — dicatat saat sinyal jadwal terdeteksi
   * walau reservasi BELUM dibuat. Berbeda dari preferredDate (kesepakatan
   * yang sudah dikonfirmasi alur reservasi). Dipakai context-aware CTA.
   */
  requestedTimeHint?: string;
}

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

/** Lifecycle fakta ongkir: UNQUOTED → QUOTED (disampaikan) → CONFIRMED (lanjut booking). */
export type OngkirStatus = 'UNQUOTED' | 'QUOTED' | 'CONFIRMED';

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
  ongkirStatus?: OngkirStatus;
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

/** Scope penerima layanan: satu anak yang sama vs pasien berbeda. */
export type RecipientScope = 'MOMS' | 'CHILD_1' | 'CHILD_2' | 'GENERAL';

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

const DEFAULT_SESSION: CustomerGoalSession = {
  genderGreeting: 'Bunda',
};

const conversationLocks = new Map<string, Promise<any>>();
const memorySessions = new Map<string, CustomerGoalSession>();

// ── Bounded in-memory session store (anti memory-leak) ──
const MAX_MEMORY_SESSIONS = 1000;
const MEMORY_SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 jam
const memorySessionTimestamps = new Map<string, number>();

/** Helper pruning FIFO + TTL + COMPLETED. Diekspor untuk testing. */
export function pruneMemoryMap(map: Map<string, CustomerGoalSession>, max = MAX_MEMORY_SESSIONS): void {
  const now = Date.now();
  // 1. Auto-cleanup: COMPLETED (booking terkonfirmasi) atau inactive >24 jam
  for (const [key, session] of map.entries()) {
    const ts = memorySessionTimestamps.get(key);
    const isExpired = ts != null && now - ts > MEMORY_SESSION_TTL_MS;
    const isCompleted = (session as CustomerGoalSession)?.booking?.isConfirmed === true;
    if (isExpired || isCompleted) {
      map.delete(key);
      memorySessionTimestamps.delete(key);
    }
  }
  // 2. FIFO eviction jika masih melebihi max (hapus entry tertua / first-inserted)
  while (map.size > max) {
    const oldestKey = map.keys().next().value as string | undefined;
    if (oldestKey === undefined) break;
    map.delete(oldestKey);
    memorySessionTimestamps.delete(oldestKey);
  }
}

/** Untuk testing / diagnostik: ukuran store & akses internal. */
export function __getMemorySessionsMap(): Map<string, CustomerGoalSession> {
  return memorySessions;
}
export function __getMemorySessionTimestampsMap(): Map<string, number> {
  return memorySessionTimestamps;
}
export function __clearMemorySessions(): void {
  memorySessions.clear();
  memorySessionTimestamps.clear();
}

function memoryKey(conversationId: string, tenantId: string): string {
  return `${tenantId}:${conversationId}`;
}

/**
 * Memastikan fungsi callback untuk conversationId yang sama dieksekusi
 * secara berurutan (serialized queue) tanpa race condition.
 */
async function withConversationLock<T>(conversationId: string, fn: () => Promise<T>): Promise<T> {
  const currentLock = conversationLocks.get(conversationId) || Promise.resolve();
  let release: () => void;
  const nextLock = new Promise<void>((resolve) => { release = resolve; });
  conversationLocks.set(conversationId, currentLock.then(() => nextLock));

  await currentLock;
  try {
    return await fn();
  } finally {
    release!();
    if (conversationLocks.get(conversationId) === nextLock) {
      conversationLocks.delete(conversationId);
    }
  }
}

export class GoalTracker {
  /**
   * Deklarasi identitas eksplisit orang-pertama ("saya bapak", "panggil ibu").
   * BUKAN inferensi dari nama — hanya frasa di mana customer MENYATAKAN
   * dirinya sendiri. Mengembalikan 'Bapak' | 'Bunda' | null (null = tak ada
   * deklarasi; sapaan tidak boleh ditebak dari null ini).
   */
  public static detectExplicitGenderPreference(text: string): 'Bapak' | 'Bunda' | null {
    const lower = (text || '').toLowerCase();
    if (!lower) return null;
    // Hanya deklarasi diri orang-pertama. "panggil bapak saya" (rujuk ayah
    // kandung) SENGAJA tidak cocok — butuh "saya/aku" atau penegas "aja".
    const selfMale = /\b(saya|aku|gue|gua)\s+(bapak|pak|ayah|papa|suami)\b/i.test(lower)
      || /\b(saya|aku)\s+(ayah|bapak)nya\b/i.test(lower)
      || /\bpanggil\s+(saya|aku)\s+(bapak|pak|ayah)\b/i.test(lower)
      || /\bpanggil\s+(bapak|pak|ayah)\s+aja\b/i.test(lower);
    if (selfMale) return 'Bapak';
    const selfFemale = /\b(saya|aku|gue|gua)\s+(ibu|bunda|bund|mama|istri)\b/i.test(lower)
      || /\b(saya|aku)\s+(ibu|bunda)nya\b/i.test(lower)
      || /\bpanggil\s+(saya|aku)\s+(ibu|bunda|bund)\b/i.test(lower)
      || /\bpanggil\s+(ibu|bunda|bund)\s+aja\b/i.test(lower);
    if (selfFemale) return 'Bunda';
    return null;
  }

  /**
   * Mengambil session state dari database (kolom preferences di Conversation atau Customer).
   */
  public static async getGoalSession(
    conversationId: string,
    tenantId = DEFAULT_TENANT_ID
  ): Promise<CustomerGoalSession> {
    try {
      const conv = await prisma.conversation.findFirst({
        where: { id: conversationId, tenant_id: tenantId },
        include: { customer: true }
      });

      if (!conv) {
        const mem = memorySessions.get(memoryKey(conversationId, tenantId));
        return mem ? { ...mem } : { ...DEFAULT_SESSION };
      }

      const prefs: any = (conv.customer?.preferences as any) || {};

      // Sapaan data-driven: HANYA dari preferensi eksplisit tersimpan.
      // DILARANG menebak gender dari nama (mis. "dwi" unisex) — default produk "Bunda".
      const storedGreeting = prefs.genderGreeting === 'Bapak' || prefs.genderGreeting === 'Bunda'
        ? prefs.genderGreeting
        : 'Bunda';
      const custName = conv.customer?.name || prefs.customerName || '';

      return {
        customerName: custName || undefined,
        genderGreeting: storedGreeting,
        targetAudience: prefs.targetAudience || undefined,
        momProfile: prefs.momProfile || undefined,
        location: prefs.location || (conv.customer?.kelurahan ? {
          rawText: conv.customer.kelurahan,
          kelurahan: conv.customer.kelurahan || undefined,
          kecamatan: conv.customer.kecamatan || undefined,
          kota: conv.customer.kota || undefined,
          distanceKm: conv.customer.distance_km != null ? Number(conv.customer.distance_km) : undefined,
          ongkirNormal: conv.customer.ongkir != null ? Number(conv.customer.ongkir) : undefined,
          ongkirPromo: prefs.ongkirPromoFee || undefined,
          isOutOfCoverage: Boolean(conv.customer.is_out_of_coverage)
        } : undefined),
        childProfile: prefs.childProfile || (prefs.childAgeMonths ? {
          ageMonths: prefs.childAgeMonths,
          symptoms: prefs.symptoms || []
        } : undefined),
        children: Array.isArray(prefs.children) ? prefs.children : undefined,
        selectedTreatment: prefs.selectedTreatmentName || prefs.selectedTreatment || undefined,
        booking: prefs.booking || undefined,
        cartItems: Array.isArray(prefs.cartItems) ? prefs.cartItems : undefined,
        ongkirStatus: prefs.ongkirStatus || undefined,
        totalPrice: typeof prefs.totalPrice === 'number' ? prefs.totalPrice : undefined,
        priceDiscussed: prefs.priceDiscussed === true ? true : undefined,
        formRetryCount: typeof prefs.formRetryCount === 'number' ? prefs.formRetryCount : undefined,
      };
    } catch (err: any) {
      console.warn(JSON.stringify({ event: 'GOAL_TRACKER_GET_ERROR', tenantId, conversationId, error: err.message, timestamp: new Date().toISOString() }));
      const mem = memorySessions.get(memoryKey(conversationId, tenantId));
      return mem ? { ...mem } : { ...DEFAULT_SESSION };
    }
  }

  /**
   * Menyimpan pembaruan session state ke database.
   */
  public static async updateGoalSession(
    conversationId: string,
    updates: Partial<CustomerGoalSession>,
    tenantId = DEFAULT_TENANT_ID
  ): Promise<CustomerGoalSession> {
    return withConversationLock(conversationId, async () => {
      const current = await this.getGoalSession(conversationId, tenantId);
      const merged: CustomerGoalSession = {
        ...current,
        ...updates,
        location: updates.location ? { ...current.location, ...updates.location } : current.location,
        childProfile: updates.childProfile ? { ...current.childProfile, ...updates.childProfile } as ChildState : current.childProfile,
        momProfile: updates.momProfile
          ? {
              ...current.momProfile,
              ...updates.momProfile,
              complaints: [
                ...((current.momProfile?.complaints || []) as string[]),
                ...((updates.momProfile?.complaints || []) as string[]),
              ].filter((s, i, arr) => arr.indexOf(s) === i),
            } as MomProfileState
          : current.momProfile,
        children: updates.children ? [...updates.children] : current.children,
        booking: updates.booking ? { ...current.booking, ...updates.booking } : current.booking,
      };

      try {
        const conv = await prisma.conversation.findFirst({ where: { id: conversationId, tenant_id: tenantId } });
        if (conv?.customer_id) {
          const updateData: any = {
            preferences: merged,
          };
          if (merged.customerName) {
            updateData.name = merged.customerName;
          }
          if (merged.location) {
            if (merged.location.kelurahan) updateData.kelurahan = merged.location.kelurahan;
            if (merged.location.kecamatan) updateData.kecamatan = merged.location.kecamatan;
            if (merged.location.kota) updateData.kota = merged.location.kota;
            if (merged.location.distanceKm != null) updateData.distance_km = merged.location.distanceKm;
            if (merged.location.ongkirPromo != null || merged.location.ongkirNormal != null) {
              updateData.ongkir = merged.location.ongkirPromo || merged.location.ongkirNormal;
            }
            if (merged.location.isOutOfCoverage != null) updateData.is_out_of_coverage = merged.location.isOutOfCoverage;
          }

          await prisma.customer.updateMany({
            where: { id: conv.customer_id, tenant_id: tenantId },
            data: updateData
          });
        }
      } catch (err: any) {
        console.warn(JSON.stringify({ event: 'GOAL_TRACKER_UPDATE_ERROR', tenantId, conversationId, error: err.message, timestamp: new Date().toISOString() }));
      }

      // Selalu cache ke memory untuk fallback offline & concurrency (bounded)
      const memKey = memoryKey(conversationId, tenantId);
      memorySessions.set(memKey, { ...merged });
      memorySessionTimestamps.set(memKey, Date.now());
      pruneMemoryMap(memorySessions, MAX_MEMORY_SESSIONS);

      return merged;
    });
  }

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
    const cat = (service?.category || '').toUpperCase();
    if (cat === 'MOMS') return 'MOMS';
    if (cat === 'BABY' || cat === 'KIDS') {
      if (hasAny(['kakak', 'kaka', 'anak pertama', 'anak ke-1', 'anak ke 1', 'si kakak'])) return 'CHILD_2';
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
    if (hasAny(['kakak', 'kaka', 'anak pertama', 'anak ke-1', 'anak ke 1', 'si kakak'])) return 'CHILD_2';
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
      const scope = stored.recipientScope || GoalTracker.detectRecipientScope(stored.name, svc);
      pushService(svc, scope);
      const cur = cart.find((c) => c.name.toLowerCase() === svc.name.toLowerCase() && (c.recipientScope || 'GENERAL') === scope);
      if (cur && stored.recipientLabel) cur.recipientLabel = stored.recipientLabel;
    }
    // Diproses KRONOLOGIS (tertua → terbaru) agar PRIMARY terbaru menimpa yang lama secara natural (domain rule)
    for (let i = 0; i < history.length; i++) {
      const text = (history[i]?.content || '').toLowerCase();
      if (!text || GoalTracker.isDurationOnlyQuestion(text)) continue;
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
      const fuzzyHits = (fullHits.length === 0 && !isAssistant)
        ? services
            .filter((s) => {
              if (!fuzzyMatches(text, s.name)) return false;
              const uncovered = significantTokens(s.name).filter((t) => !coveredTokens.has(t));
              return uncovered.length >= 2;
            })
            .sort((a, b) => b.name.length - a.name.length).slice(0, 2)
        : [];
      for (const s of [...fullHits, ...cleanHits, ...fuzzyHits]) {
        pushService(s, GoalTracker.detectRecipientScope(text, s));
      }
    }
    // Audit 854065 (pending swap): afirmasi pelanggan atas tawaran tukar
    // asisten → selesaikan swap di sini (stateless, deterministik).
    const swap = GoalTracker.resolveAffirmativeSwap({ cartItems: cart } as CustomerGoalSession, history, catalog);
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
        return toks.filter((t) => offerText.includes(t)).length >= 2;
      })
      .sort((a, b) => b.name.length - a.name.length);
    if (candidates.length === 0) return null;
    const offered = candidates[0];
    const scope = GoalTracker.detectRecipientScope(offerText, offered);
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

  /**
   * Ekstraksi profil anak otomatis dari satu pesan (deterministik, 0 token):
   * usia ("2 bulan", "3 tahun", "baru lahir"), gejala, dan peran (Adik/Kakak).
   * Mengembalikan children baru (tidak mutasi session).
   */
  /**
   * Guard anti-kontaminasi silang: pesan yang murni membahas kehamilan ibu
   * (usia kehamilan mingguan) DILARANG ditulis ke profil anak.
   * Tanpa guard ini "uk 38 weeks" bocor menjadi childProfile.ageMonths = 9.
   */
  public static isMaternalOnlyMessage(text: string): boolean {
    const lower = (text || '').toLowerCase();
    if (!lower) return false;
    // 'uk' (usia kehamilan, mis. "uk 38") WAJIB token mandiri — includes
    // lepas ("uk "/" uk") false-fire pada kata berakhiran -uk ("batuk "),
    // yang membungkam pencatatan gejala anak (bug ditemukan via test
    // adversarial audit 222655: "lagi batuk pilek" dikira maternal-only).
    let normalizedUk = '';
    for (let i = 0; i < lower.length; i++) {
      const ch = lower[i];
      normalizedUk += ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) ? ch : ' ';
    }
    const hasUkToken = normalizedUk.split(' ').some((t) => t === 'uk');
    const hasMaternalSignal = lower.includes('hamil')
      || lower.includes('bumil')
      || lower.includes('kehamilan')
      || lower.includes('week')
      || lower.includes('wks')
      || lower.includes('trimester')
      || lower.includes('nifas')
      || lower.includes('menyusui')
      || lower.includes('laktasi')
      || lower.includes('induksi')
      || lower.includes('oksitosin')
      || lower.includes('perineum')
      || hasUkToken
      || lower.includes('usia kandungan');
    if (!hasMaternalSignal) return false;
    const hasChildSignal = lower.includes('bayi')
      || lower.includes('baby')
      || lower.includes('anak saya')
      || lower.includes('adik')
      || lower.includes('adek')
      || lower.includes('kakak')
      || lower.includes('si kecil')
      || lower.includes('newborn')
      || lower.includes('selapan');
    return !hasChildSignal;
  }

  /**
   * Deteksi subjek layanan multi-audience dari teks (data-driven includes, tanpa regex):
   * MOMS (ibu), BABY/KIDS (anak), BOTH (keduanya), atau undefined bila netral.
   */
  public static detectTargetAudience(text: string): TargetAudienceType | undefined {
    const lower = (text || '').toLowerCase();
    if (!lower) return undefined;
    const momHit = lower.includes('hamil') || lower.includes('bumil') || lower.includes('kehamilan')
      || lower.includes('week') || lower.includes('nifas') || lower.includes('menyusui')
      || lower.includes('laktasi') || lower.includes('induksi') || lower.includes('oksitosin')
      || lower.includes('untuk saya') || lower.includes('buat saya') || lower.includes('saya sendiri')
      || lower.includes('bunda sendiri') || lower.includes('perineum') || lower.includes('prenatal')
      || lower.includes('postpartum') || lower.includes('paska') || lower.includes('pasca melahirkan');
    const babyHit = lower.includes('bayi') || lower.includes('baby') || lower.includes('newborn')
      || lower.includes('selapan') || lower.includes('adik') || lower.includes('adek')
      || lower.includes('si kecil');
    const kidsHit = lower.includes('kakak') || lower.includes('anak pertama') || lower.includes('anak ke')
      || lower.includes('balita') || lower.includes('kids') || lower.includes('anak saya');
    const childHit = babyHit || kidsHit;
    if (momHit && childHit) return 'BOTH';
    if (momHit) return 'MOMS';
    if (kidsHit && !babyHit) return 'KIDS';
    if (childHit) return 'BABY';
    return undefined;
  }

  /**
   * Ekstrak usia kehamilan (minggu) dari teks tanpa regex semantik:
   * pindai token angka di sekitar penanda minggu (weeks/week/minggu/wks).
   * Contoh: "uk 38 weeks" -> 38, "usia kehamilan 38 minggu" -> 38.
   */
  public static parseGestationalWeeks(text: string): number | undefined {
    const lower = (text || '').toLowerCase();
    if (!lower) return undefined;
    const weekMarkers = ['weeks', 'week', 'minggu', 'wks', 'wk', ' mgg'];
    const hasWeekMarker = weekMarkers.some((mk) => lower.includes(mk));
    if (!hasWeekMarker) return undefined;
    // Tokenisasi sederhana: pisahkan non alfanumerik menjadi spasi lalu split
    let normalized = '';
    for (let i = 0; i < lower.length; i++) {
      const ch = lower[i];
      const isAlnum = (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9');
      normalized += isAlnum ? ch : ' ';
    }
    const tokens = normalized.split(' ').filter((t) => t.length > 0);
    const isWeekToken = (t: string): boolean => t === 'weeks' || t === 'week' || t === 'minggu' || t === 'wks' || t === 'wk' || t === 'mgg' || t === 'w';
    const parseLeadingNumber = (t: string): number | undefined => {
      let numStr = '';
      for (let i = 0; i < t.length; i++) {
        const c = t[i];
        if (c >= '0' && c <= '9') numStr += c;
        else break;
      }
      if (!numStr) return undefined;
      const n = parseInt(numStr, 10);
      return Number.isFinite(n) && n >= 4 && n <= 45 ? n : undefined;
    };
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (isWeekToken(tok)) {
        // Cari angka mundur hingga 3 token ke belakang (misal "uk 38 weeks")
        for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
          const n = parseLeadingNumber(tokens[j]);
          if (n !== undefined) return n;
          // Token gabungan seperti "38weeks" sudah terpisah karena normalisasi; tangani "38w"
          if (tokens[j].length > 1 && tokens[j].endsWith('w')) {
            const inner = parseLeadingNumber(tokens[j]);
            if (inner !== undefined) return inner;
          }
        }
      }
      // Token gabungan "38weeks"/"38minggu" tanpa spasi sudah terpisah oleh normalisasi?
      // Tangani pola "38w" / "38wk" langsung
      if ((tok.endsWith('w') || tok.endsWith('wk') || tok.endsWith('wks')) && tok.length <= 5) {
        const n = parseLeadingNumber(tok);
        if (n !== undefined) {
          // Pastikan konteks maternal di sekitarnya
          const window = tokens.slice(Math.max(0, i - 3), i + 3).join(' ');
          if (window.includes('uk') || window.includes('hamil') || window.includes('kehamilan') || hasWeekMarker) return n;
        }
      }
    }
    return undefined;
  }

  /**
   * Ekstraksi profil ibu otomatis dari satu pesan (deterministik, 0 token):
   * usia kehamilan (minggu), stage (PREGNANT/POSTPARTUM/GENERAL), keluhan ibu.
   * Mengembalikan momProfile baru (tidak mutasi session) atau undefined bila
   * tidak ada sinyal maternal.
   */
  public static syncMomProfile(
    session: CustomerGoalSession,
    text: string
  ): MomProfileState | undefined {
    const lower = (text || '').toLowerCase();
    if (!lower) return session.momProfile;
    const audience = GoalTracker.detectTargetAudience(text);
    const gestationalWeeks = GoalTracker.parseGestationalWeeks(text);
    const mentionsPostpartum = lower.includes('nifas') || lower.includes('paska') || lower.includes('pasca')
      || lower.includes('baru melahirkan') || lower.includes('postpartum') || lower.includes('menyusui');
    const mentionsPregnant = lower.includes('hamil') || lower.includes('bumil') || lower.includes('kehamilan')
      || lower.includes('usia kandungan') || lower.includes('trimester') || gestationalWeeks !== undefined
      || lower.includes('induksi') || lower.includes('perineum') || lower.includes('prenatal');
    const mentionsMomRelax = lower.includes('untuk saya') || lower.includes('buat saya') || lower.includes('saya sendiri')
      || lower.includes('bunda sendiri') || lower.includes('relaksasi ibu') || lower.includes('pijat ibu');
    if (!mentionsPregnant && !mentionsPostpartum && !mentionsMomRelax && audience !== 'MOMS' && audience !== 'BOTH') {
      return session.momProfile;
    }
    const MOM_COMPLAINT_WORDS = ['pegal', 'capek', 'lelah', 'letih', 'bengkak', 'nyeri', 'ngilu', 'kram', 'pinggang', 'punggung', 'kaki', 'tangan kesemutan', 'susah tidur', 'tidak bisa tidur', 'mual', 'pusing', 'kontraksi', 'kencang', 'asi', 'laktasi', 'menyusui', 'puting', 'bendungan', 'stres', 'cemas', 'sakit pinggang', 'boyok'];
    const foundComplaints = MOM_COMPLAINT_WORDS.filter((s) => lower.includes(s));
    const prev = session.momProfile || { complaints: [] };
    let stage: MomStage = prev.stage || 'GENERAL';
    if (mentionsPregnant) stage = 'PREGNANT';
    else if (mentionsPostpartum) stage = 'POSTPARTUM';
    else if (prev.stage) stage = prev.stage;
    else stage = 'GENERAL';
    const mergedComplaints = [...(prev.complaints || [])];
    for (const c of foundComplaints) {
      if (!mergedComplaints.includes(c)) mergedComplaints.push(c);
    }
    const next: MomProfileState = {
      stage,
      complaints: mergedComplaints,
    };
    if (gestationalWeeks !== undefined) next.gestationalWeeks = gestationalWeeks;
    else if (prev.gestationalWeeks !== undefined) next.gestationalWeeks = prev.gestationalWeeks;
    if (prev.postpartumPeriod) next.postpartumPeriod = prev.postpartumPeriod;
    // Deteksi durasi paska salin sederhana: cari pola "N minggu/bulan" di dekat kata nifas/paska
    if (stage === 'POSTPARTUM' && !next.postpartumPeriod) {
      let normalized = '';
      for (let i = 0; i < lower.length; i++) {
        const ch = lower[i];
        normalized += ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) ? ch : ' ';
      }
      const tokens = normalized.split(' ').filter((t) => t.length > 0);
      for (let i = 0; i < tokens.length; i++) {
        if (tokens[i] === 'minggu' || tokens[i] === 'bulan' || tokens[i] === 'hari') {
          const prevTok = tokens[i - 1] || '';
          let numStr = '';
          for (let k = 0; k < prevTok.length; k++) {
            const c = prevTok[k];
            if (c >= '0' && c <= '9') numStr += c;
            else break;
          }
          if (numStr) {
            next.postpartumPeriod = `${numStr} ${tokens[i]}`;
            break;
          }
        }
      }
    }
    return next;
  }

  /**
   * Ekstraksi angka usia → bulan dari teks lowercased (bersama untuk sync &
   * detektor disambiguasi; pola satuan teknis bulan/tahun/minggu + "baru lahir",
   * BUKAN gatekeeper intent). "2 bulan"→2, "3 tahun"→36, "baru lahir"→0.
   */
  public static extractAgesMonths(lower: string): number[] {
    const ages: number[] = [];
    const ageRe = /(\d+(?:[.,]\d+)?)\s*(bulan|bln|tahun|thn|th)\b/g;
    let m: RegExpExecArray | null;
    while ((m = ageRe.exec(lower)) !== null) {
      const val = parseFloat(m[1].replace(',', '.'));
      if (!Number.isFinite(val)) continue;
      const unit = m[2];
      ages.push(unit.startsWith('tahun') || unit.startsWith('thn') || unit === 'th' ? Math.round(val * 12) : Math.round(val));
    }
    if (lower.includes('baru lahir')) ages.push(0);
    // Usia bayi dalam minggu ("bayi 3 minggu", "newborn 2 weeks"): guard ketat
    // agar tak menelan usia kehamilan — hanya bila ada sinyal eksplisit
    // bayi/anak DAN tidak ada sinyal proyeksi kehamilan.
    // Konversi satuan teknis (1 bulan = 4.345 minggu).
    if (ages.length === 0) {
      const hasBabySignal = lower.includes('bayi') || lower.includes('baby')
        || lower.includes('newborn') || lower.includes('anak') || lower.includes('adik')
        || lower.includes('adek') || lower.includes('si kecil');
      const hasPregnancyProjection = lower.includes('hamil') || lower.includes('lahiran')
        || lower.includes('kandungan') || lower.includes('trimester') || lower.includes('hpl')
        || lower.includes('persalinan') || lower.includes('pembukaan');
      if (hasBabySignal && !hasPregnancyProjection) {
        const weekRe = /(\d+(?:[.,]\d+)?)\s*(minggu|mgg|weeks?|wk|w)\b/g;
        let wm: RegExpExecArray | null;
        while ((wm = weekRe.exec(lower)) !== null) {
          const val = parseFloat(wm[1].replace(',', '.'));
          if (!Number.isFinite(val) || val <= 0 || val > 60) continue;
          ages.push(Math.round(val / 4.345));
        }
      }
    }
    return ages;
  }

  /**
   * Sinyal eksplisit jumlah anak (data-driven includes, tanpa regex intent):
   * penegas multi ("anak saya 2"), label peran (Adik/Kakak), atau penegas
   * satu anak ("1 anak saja"). Dipakai untuk membersihkan latch
   * `isMultiChildUnconfirmed` — BUKAN gatekeeper perilaku LLM.
   */
  public static isExplicitChildCountSignal(text: string): boolean {
    const lower = (text || '').toLowerCase();
    if (!lower) return false;
    const multiWords = ['anak saya 2', 'dua anak', '2 anak', 'keduanya',
      'adik kakak', 'kakak adik', 'adik dan kakak', 'kakak dan adik'];
    if (multiWords.some((w) => lower.includes(w))) return true;
    if (lower.includes('kakak') || (lower.includes('kaka') && !lower.includes('kakak'))
      || lower.includes('adik') || lower.includes('adek')) return true;
    const oneChild = ['1 anak', 'satu anak', 'cuma satu', 'hanya satu',
      'cuman satu', 'anak tunggal', 'anaknya satu', 'satu aja'];
    if (oneChild.some((w) => lower.includes(w))) return true;
    return false;
  }

  /**
   * Gerbang disambiguasi multi-anak, sesi 214956 (murni, tanpa mutasi):
   * true bila pesan ini memunculkan kandidat anak KEDUA yang belum
   * dikonfirmasi — 2 usia berbeda dalam satu pesan, ATAU satu usia baru yang
   * berbeda dari anak tercatat — TANPA sinyal jumlah eksplisit. Pesan
   * maternal murni tidak pernah memicu (anti kontaminasi silang).
   */
  public static detectUnconfirmedMultiChild(
    prevChildren: ChildState[] | undefined,
    text: string
  ): boolean {
    const lower = (text || '').toLowerCase();
    if (!lower) return false;
    if (GoalTracker.isMaternalOnlyMessage(text)) return false;
    if (GoalTracker.isExplicitChildCountSignal(text)) return false;
    const distinct = [...new Set(GoalTracker.extractAgesMonths(lower))];
    if (distinct.length >= 2) return true;
    if (distinct.length === 1) {
      const prevAges = (prevChildren || [])
        .map((c) => c.ageMonths)
        .filter((n): n is number => typeof n === 'number');
      if (prevAges.length >= 1 && !prevAges.includes(distinct[0])) return true;
    }
    return false;
  }

  public static syncChildrenProfiles(
    session: CustomerGoalSession,
    text: string
  ): ChildState[] {
    const lower = (text || '').toLowerCase();
    if (!lower) return [...(session.children || [])];
    // Anti-kontaminasi silang: pesan murni maternal DILARANG menyentuh profil anak.
    if (GoalTracker.isMaternalOnlyMessage(text)) return [...(session.children || [])];
    const children: ChildState[] = (session.children || []).map((c) => ({
      ...c,
      symptoms: [...(c.symptoms || [])],
    }));
    const ensureChild = (idx: 0 | 1, roleLabel: string): ChildState => {
      if (!children[idx]) children[idx] = { roleLabel, symptoms: [] };
      else if (!children[idx].roleLabel) children[idx].roleLabel = roleLabel;
      return children[idx];
    };

    // Sinyal peran & multi-anak dibaca DULU (tanpa mutasi) agar penetapan usia tepat sasaran.
    const mentionsKakak = lower.includes('kakak') || (lower.includes('kaka') && !lower.includes('kakak'));
    const mentionsAdik = lower.includes('adik') || lower.includes('adek');
    const mentionsMulti = lower.includes('anak saya 2') || lower.includes('dua anak') || lower.includes('2 anak') || lower.includes('keduanya');

    // Usia via helper bersama (bulan/tahun + "baru lahir" + minggu bayi).
    const ages: number[] = GoalTracker.extractAgesMonths(lower);

    const SYMPTOM_WORDS = ['pilek', 'batuk', 'demam', 'kembung', 'kolik', 'grok', 'rewel', 'susah tidur', 'gtm', 'diare', 'bapil', 'flu', 'kuning', 'ruam', 'makan', 'lahap', 'sulit makan', 'doyan makan', 'hidung',
      // Audit 337101: riwayat trauma sebagai konteks keluhan (_security path
      // skrining ditangani persona + RAG; di sini hanya pencatatan konteks).
      'jatuh', 'jatoh', 'terbentur', 'benjol'];
    const foundSymptoms = SYMPTOM_WORDS.filter((s) => lower.includes(s));

    const addSymptoms = (child: ChildState) => {
      for (const s of foundSymptoms) {
        if (!child.symptoms.includes(s)) child.symptoms.push(s);
      }
    };

    if (mentionsMulti) {
      ensureChild(0, 'Adik');
      ensureChild(1, 'Kakak');
    }
    if (ages.length >= 2) {
      // Tetapkan berurutan: usia pertama → anak pertama, dst.
      ages.forEach((age, i) => {
        const child = ensureChild(i === 0 ? 0 : 1, i === 0 ? 'Adik' : 'Kakak');
        child.ageMonths = age;
      });
      if (foundSymptoms.length > 0) addSymptoms(ensureChild(0, 'Adik'));
    } else if (ages.length === 1 || foundSymptoms.length > 0) {
      const newAge = ages.length === 1 ? ages[0] : null;
      // Tokenisasi untuk penanda referensial anak-lain (audit 854065).
      let normRef = '';
      for (let i = 0; i < lower.length; i++) {
        const ch = lower[i];
        normRef += (ch >= 'a' && ch <= 'z') ? ch : ' ';
      }
      const refTokens = new Set(normRef.split(' ').filter((t) => t.length > 0));
      // Penanda kuat anak-LAIN (audit 854065: "kalau anak saya yang umur
      // 2 tahun"). Bare "yang" SENGAJA dikecualikan — "yang 2 bulan" telanjang
      // lebih mungkin usia susulan anak yang sama → isi idx0 (cabang e).
      const hasReferentialMarker = ['kalau', 'satunya', 'kedua'].some((t) => refTokens.has(t));
      const firstHasCare = (children[0]?.symptoms || []).length > 0
        || (session.cartItems || []).some((c) => (c.recipientScope || 'GENERAL') === 'CHILD_1');
      const ageMatchIdx = newAge != null
        ? children.findIndex((c) => c.ageMonths != null && c.ageMonths === newAge)
        : -1;
      if (mentionsKakak || mentionsAdik) {
        // (a) Peran eksplisit menang ("kakak 3 tahun" → idx1).
        const idx: 0 | 1 = mentionsKakak ? 1 : 0;
        const child = ensureChild(idx, idx === 1 ? 'Kakak' : 'Adik');
        if (newAge != null) child.ageMonths = newAge;
        addSymptoms(child);
      } else if (ageMatchIdx === 0 || ageMatchIdx === 1) {
        // (b) Usia cocok anak existing → update anak itu (anti duplikat).
        const target = ensureChild(ageMatchIdx as 0 | 1, children[ageMatchIdx].roleLabel || (ageMatchIdx === 1 ? 'Kakak' : 'Adik'));
        addSymptoms(target);
      } else if (newAge != null && !mentionsMulti && children[0]
        && ((children[0].ageMonths != null && children[0].ageMonths !== newAge)
          || (children[0].ageMonths == null && firstHasCare && hasReferentialMarker))) {
        // (c) Audit 222655: anak pertama ber-usia beda → slot kedua by usia.
        // (d) Audit 854065: anak pertama TANPA usia tapi punya keluhan/cart
        //     + usia baru berpenanda referensial ("kalau anak saya yang...")
        //     → slot kedua Kakak (DILARANG menimpa konteks pilek adik).
        //     Tanpa penanda referensial ("umur 2 bulan" telanjang) → isi idx0
        //     (asumsi usia susulan anak yang sama).
        const firstAge = children[0].ageMonths as number | undefined;
        if (children[1]?.ageMonths != null) {
          // Slot penuh (2 anak): update anak dengan usia terdekat (cap model Adik/Kakak).
          const d0 = firstAge != null ? Math.abs(firstAge - newAge) : Number.MAX_SAFE_INTEGER;
          const d1 = Math.abs((children[1].ageMonths as number) - newAge);
          const target = d1 < d0 ? ensureChild(1, 'Kakak') : ensureChild(0, children[0].roleLabel || 'Adik');
          target.ageMonths = newAge;
          addSymptoms(target);
        } else if (firstAge != null && newAge < firstAge) {
          // Adik baru lebih muda → selip di depan; kakak lama geser ke idx 1.
          children.unshift({ roleLabel: 'Adik', ageMonths: newAge, symptoms: [] });
          if (!children[1].roleLabel || children[1].roleLabel === 'Si Kecil') {
            children[1].roleLabel = 'Kakak';
          }
          addSymptoms(children[0]);
        } else {
          const kakak = ensureChild(1, 'Kakak');
          kakak.ageMonths = newAge;
          if (!children[0].roleLabel || children[0].roleLabel === 'Si Kecil') {
            children[0].roleLabel = 'Adik';
          }
          addSymptoms(kakak);
        }
      } else {
        // (e) Default: isi anak pertama (usia susulan / gejala).
        const child = ensureChild(0, mentionsAdik ? 'Adik' : 'Si Kecil');
        if (newAge != null) child.ageMonths = newAge;
        addSymptoms(child);
      }
    } else {
      if (mentionsAdik) ensureChild(0, 'Adik');
      if (mentionsKakak) ensureChild(1, 'Kakak');
    }

    // childProfile selalu mirror children[0] (backward compat).
    return children;
  }

  /** Tandai ongkir QUOTED (baru disampaikan) — idempoten, tidak downgrade CONFIRMED. */
  public static async markOngkirQuoted(conversationId: string, tenantId = DEFAULT_TENANT_ID): Promise<CustomerGoalSession> {
    const current = await this.getGoalSession(conversationId, tenantId);
    if (current.ongkirStatus === 'CONFIRMED' || current.ongkirStatus === 'QUOTED') return current;
    return this.updateGoalSession(conversationId, { ongkirStatus: 'QUOTED' }, tenantId);
  }

  /** Tandai ongkir CONFIRMED (customer lanjut booking) — idempoten. */
  public static async markOngkirConfirmed(conversationId: string, tenantId = DEFAULT_TENANT_ID): Promise<CustomerGoalSession> {
    const current = await this.getGoalSession(conversationId, tenantId);
    if (current.ongkirStatus === 'CONFIRMED') return current;
    return this.updateGoalSession(conversationId, { ongkirStatus: 'CONFIRMED' }, tenantId);
  }

  /**
   * Format session state menjadi ringkasan faktual ringkas untuk prompt LLM.
   * Termasuk pre-grounding rekomendasi katalog deterministik: jika ada keluhan
   * dan belum ada treatment terpilih, layanan teratas dari katalog didorong ke
   * status agar LLM terpandu — bahkan bila tool_choice dilewati model.
   */
  public static formatGoalSessionForPrompt(session: CustomerGoalSession): string {
    // Pre-grounding deterministik (Zero-Code) — audience-aware:
    // keluhan ibu (momProfile.complaints) dan keluhan anak digabung sesuai subjek.
    const childSymptoms: string[] = [
      ...(session.childProfile?.symptoms || []),
      ...((session.children || []).flatMap((c) => c.symptoms || [])),
    ].filter((s, i, arr) => arr.indexOf(s) === i);
    const momComplaints: string[] = [...(session.momProfile?.complaints || [])]
      .filter((s, i, arr) => arr.indexOf(s) === i);
    const isMomSubject = session.targetAudience === 'MOMS' || session.targetAudience === 'BOTH' || Boolean(session.momProfile?.gestationalWeeks != null || session.momProfile?.stage);
    const allSymptoms: string[] = isMomSubject && momComplaints.length > 0 && childSymptoms.length === 0
      ? momComplaints
      : [...childSymptoms, ...(session.targetAudience === 'BOTH' ? momComplaints : [])]
        .filter((s, i, arr) => arr.indexOf(s) === i);
    let pregroundedRecommendation: string | null = null;
    if (allSymptoms.length > 0 && !session.selectedTreatment) {
      try {
        const categoryHint = session.targetAudience === 'MOMS' ? 'MOMS' as any : session.targetAudience === 'BOTH' ? undefined : session.targetAudience as any;
        const rec = treatmentCatalogService.recommendServiceBySymptoms(allSymptoms, session.childProfile?.ageMonths ?? session.children?.[0]?.ageMonths ?? null, categoryHint);
        if (rec) {
          const subjectLabel = isMomSubject && momComplaints.length > 0 && childSymptoms.length === 0 ? 'keluhan Bunda' : 'keluhan si kecil';
          pregroundedRecommendation = `• Rekomendasi Sesuai Keluhan (${allSymptoms.join(', ')}): *${rec.name}* (Promo ${`Rp ${rec.promoPrice.toLocaleString('id-ID')}`}) — ${rec.description}\n  [MANDAT WAJIB: Tawarkan layanan rekomendasi di atas untuk ${subjectLabel} ini. DILARANG mengganti dengan nama paket lain!]\n  [MANDAT ANTI-RELAKSASI-MURNI (audit 337101): si kecil ada keluhan fisik di atas — DILARANG merekomendasikan paket relaksasi murni (untuk bayi sehat tanpa keluhan)! WAJIB paket terapi penanganan keluhan di atas.]`;
        }
      } catch (_) {}
    } else if (allSymptoms.length === 0 && !session.selectedTreatment) {
      // Bayi sehat tanpa keluhan → paket relaksasi default dari katalog
      try {
        const def = treatmentCatalogService.getDefaultRelaxationService();
        if (def) {
          pregroundedRecommendation = `• Rekomendasi Paket Dasar (Bayi Sehat Tanpa Keluhan): *${def.name}* (Promo ${`Rp ${def.promoPrice.toLocaleString('id-ID')}`}) — ${def.description}\n  [MANDAT: Tawarkan paket dasar di atas untuk bayi sehat; DILARANG menyebut paket terapi sakit bila tidak ada keluhan!]`;
        }
      } catch (_) {}
    }

    const lines: string[] = [
      `[STATUS DATA CUSTOMER SAAT INI]`,
      `• Sapaan: ${session.genderGreeting} ${session.customerName ? `(${session.customerName})` : ''}`,
    ];

    if (pregroundedRecommendation) lines.push(pregroundedRecommendation);

    if (session.location?.kelurahan || session.location?.distanceKm) {
      lines.push(`• Lokasi: ${session.location.kelurahan || '-'}, ${session.location.kecamatan || '-'}, ${session.location.kota || '-'} (Jarak: ${session.location.distanceKm || '-'} km) [STATUS: SUDAH DIKETAHUI - DILARANG TANYA ALAMAT LAGI!]`);
      if (session.location.ongkirPromo != null) {
        const ongkirState = session.ongkirStatus === 'CONFIRMED'
          ? 'SUDAH DIKONFIRMASI - DILARANG ULANG HITUNGAN KM/ONGKIR!'
          : session.ongkirStatus === 'QUOTED'
            ? 'SUDAH DISAMPAIKAN - DILARANG ULANG HITUNGAN KM/ONGKIR!'
            : null;
        lines.push(`• Ongkir: Rp ${session.location.ongkirPromo.toLocaleString('id-ID')} (Promo dari normal Rp ${session.location.ongkirNormal?.toLocaleString('id-ID') || '-'})` + (ongkirState ? ` [STATUS: ${ongkirState}]` : ''));
      }
    } else {
      lines.push(`• Lokasi: Belum diketahui (Perlu ditanyakan kelurahan/kecamatannya)`);
    }

    if (session.cartItems && session.cartItems.length > 0) {
      const fmtRp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;
      const ageSuffixFor = (scope?: string, label?: string): string => {
        if (label && /\(\d+\s*(bln|th)\)/.test(label)) return '';
        const kids = session.children || [];
        const child = scope === 'CHILD_2' ? kids[1] : scope === 'CHILD_1' ? kids[0] : undefined;
        if (!child || child.ageMonths == null) return '';
        return child.ageMonths >= 12 && child.ageMonths % 12 === 0
          ? ` (${Math.round(child.ageMonths / 12)} th)`
          : ` (${child.ageMonths} bln)`;
      };
      const rows = session.cartItems.map((it) => {
        const scope = it.recipientScope || 'GENERAL';
        const hasAgeInLabel = it.recipientLabel ? /\(\d+\s*(bln|th)\)/.test(it.recipientLabel) : false;
        const who = it.recipientLabel
          || (scope === 'MOMS' ? 'Bunda' : scope === 'CHILD_2' ? 'Kakak' : scope === 'CHILD_1' ? 'Si Kecil' : 'Si Kecil');
        const priceLabel = it.type === 'ADDON'
          ? `Tambahan: ${fmtRp(it.promoPrice ?? it.price)}`
          : it.type === 'SERVICE'
            ? `Layanan: ${fmtRp(it.promoPrice ?? it.price)}`
            : `Promo: ${fmtRp(it.promoPrice ?? it.price)}`;
        return `  - [Untuk ${who}${ageSuffixFor(scope, it.recipientLabel)}] ${it.name} (${priceLabel})`;
      });
      lines.push(`• Keranjang Layanan Terpilih:\n${rows.join('\n')}`);
      const subtotal = session.cartItems.reduce((s, it) => s + (it.promoPrice ?? it.price), 0);
      const ongkir = session.location?.ongkirPromo ?? 0;
      const grandTotal = subtotal + ongkir;
      const rincian = [...session.cartItems.map((it) => `${it.name} ${fmtRp(it.promoPrice ?? it.price)}`), `Ongkir ${fmtRp(ongkir)}`].join(' + ');
      // Audit 854065 (MODE KONSULTASI vs TRANSASIONAL): angka total resmi
      // HANYA diekspos ke LLM bila customer sudah bertanya harga
      // (priceDiscussed) — tanpa ini, LLM menjiplak total saat konsultasi
      // (Turn 3: Rp 95.000 + todong jadwal tanpa ditanya harga).
      if (session.priceDiscussed) {
        lines.push(`• Total Akumulasi Biaya: ${fmtRp(grandTotal)} (Treatment ${fmtRp(subtotal)} + Ongkir ${fmtRp(ongkir)})`);
        lines.push(`[MANDAT INTEGRITAS MATEMATIKA: Total Akumulasi Biaya Resmi adalah ${fmtRp(grandTotal)} (Rincian: ${rincian}). Saat menyebutkan total biaya, WAJIB gunakan angka resmi ${fmtRp(grandTotal)} ini. DILARANG menghitung sendiri, menebak, atau mengubah nominal!]`);
      } else {
        lines.push(`[MODE KONSULTASI: customer BELUM bertanya harga/total — DILARANG menyebut atau menjumlahkan nominal uang apa pun (harga treatment, ongkir, grand total)! Fokus pada manfaat klinis tiap layanan di atas. Total resmi (${fmtRp(grandTotal)}) DISEMBUNYIKAN dari balasan hingga customer bertanya harga.]`);
      }
      // Audit 854065 Phase 5: estimasi durasi multi-item dari durasi resmi
      // katalog (data-driven, tanpa tebakan "~40 menit" hafalan). Item yang
      // tak dikenal katalog dilewati (anti fabrikasi); blok dihilangkan bila
      // tak ada satupun durasi resmi ditemukan.
      if (session.cartItems.length >= 2) {
        try {
          const allSvc = treatmentCatalogService.getAllServices(true);
          const durParts: string[] = [];
          let durTotal = 0;
          for (const it of session.cartItems) {
            const svc = allSvc.find((s) => s.name.toLowerCase() === (it.name || '').toLowerCase());
            const d = svc && typeof svc.durationMinutes === 'number' ? svc.durationMinutes : null;
            if (d != null && d > 0) {
              durParts.push(`${it.name} ${d} mnt`);
              durTotal += d;
            }
          }
          if (durParts.length > 0 && durTotal > 0) {
            const jam = durTotal >= 60 ? ` (~${(durTotal / 60).toFixed(1).replace('.', ',')} jam)` : '';
            lines.push(`• Total Estimasi Durasi Perawatan: ~${durTotal} menit${jam} (Rincian: ${durParts.join(' + ')}).`);
            lines.push(`[MANDAT ESTIMASI WAKTU: Saat customer menanyakan total jam/lama waktu pengerjaan, WAJIB jumlahkan seluruh durasi layanan di keranjang di atas secara utuh, termasuk durasi perawatan Bunda. DILARANG melupakan layanan Bunda!]`);
          }
        } catch (_) {}
      }
    }

    // ── Audience-aware patient summary (anti pediatric-centric myopia) ──
    // MOMS/BOTH: tampilkan Data Bunda; BABY/KIDS: tampilkan Data Si Kecil; BOTH: keduanya.
    const hasMom = Boolean(session.momProfile && (session.momProfile.gestationalWeeks != null || session.momProfile.stage || (session.momProfile.complaints || []).length > 0 || session.targetAudience === 'MOMS' || session.targetAudience === 'BOTH'));
    const kids = session.children && session.children.length > 0
      ? session.children
      : (session.childProfile ? [session.childProfile] : []);
    const hasKids = kids.length > 0 && (kids.some((k) => k.ageMonths != null || (k.symptoms || []).length > 0) || session.targetAudience === 'BABY' || session.targetAudience === 'KIDS' || session.targetAudience === 'BOTH');
    if (session.targetAudience) {
      lines.push(`• Subjek Perawatan: ${session.targetAudience === 'MOMS' ? 'Bunda (Ibu)' : session.targetAudience === 'BOTH' ? 'Bunda & Si Kecil (Mom & Baby)' : session.targetAudience === 'KIDS' ? 'Anak (Kids)' : 'Bayi (Baby)'}`);
    }
    if (hasMom) {
      const mp = session.momProfile || { complaints: [] as string[] };
      const stageLabel = mp.stage === 'PREGNANT' ? 'Ibu Hamil' : mp.stage === 'POSTPARTUM' ? 'Paska Salin/Nifas' : 'Ibu (Relaksasi Umum)';
      const gestLabel = mp.gestationalWeeks != null ? `Usia Kehamilan ${mp.gestationalWeeks} minggu` : (mp.stage === 'PREGNANT' ? 'Usia kehamilan belum spesifik' : `Kondisi: ${stageLabel}`);
      const postpartumLabel = mp.postpartumPeriod ? `, Paska salin: ${mp.postpartumPeriod}` : '';
      const complaintLabel = (mp.complaints || []).length > 0 ? `, Keluhan Bunda: ${mp.complaints.join(', ')}` : '';
      lines.push(`• Data Bunda (Pasien): ${gestLabel}${mp.stage && mp.gestationalWeeks == null && mp.stage !== 'PREGNANT' ? ` (${stageLabel})` : mp.stage === 'PREGNANT' && mp.gestationalWeeks != null ? ` (${stageLabel})` : ''}${postpartumLabel}${complaintLabel} [STATUS: SUDAH DIKETAHUI - DILARANG MENGONVERSI KE USIA ANAK!]`);
    }
    if (hasKids) {
      if (kids.length > 1) {
        // Audit 222655: grounding multi-pasien — treatment per anak dari cart
        // (CHILD_1→anak idx0, CHILD_2→anak idx1) + aturan 1 kunjungan 1 ongkir.
        const cartTreatmentFor = (idx: 0 | 1): string => {
          const scope = idx === 0 ? 'CHILD_1' : 'CHILD_2';
          const hit = (session.cartItems || []).find((it) => it.recipientScope === scope);
          return hit ? ` — Treatment terpilih: ${hit.name} (${`Rp ${(hit.promoPrice ?? hit.price).toLocaleString('id-ID')}`})` : '';
        };
        const kidLines = kids.map((k, i) => {
          const label = k.roleLabel || 'Anak';
          const age = k.ageMonths != null
            ? (k.ageMonths >= 12 && k.ageMonths % 12 === 0 ? `${Math.round(k.ageMonths / 12)} tahun (${k.ageMonths} bulan)` : `${k.ageMonths} bulan`)
            : 'usia belum diketahui';
          const sym = (k.symptoms && k.symptoms.length > 0) ? `, Keluhan: ${k.symptoms.join(', ')}` : ', Sehat/Relaksasi';
          return `  - ${label}: Usia ${age}${sym}${i <= 1 ? cartTreatmentFor(i as 0 | 1) : ''}`;
        });
        lines.push(`[DATA PASIEN: MULTI-ANAK (${kids.length} ANAK DALAM 1 KUNJUNGAN)]\n${kidLines.join('\n')}\n  • Aturan Kunjungan: Keduanya bisa dikerjakan berurutan dalam 1x kunjungan dengan 1x ongkir promo.`);
      } else if (kids.length === 1) {
        const cp = kids[0];
        lines.push(`• Data Si Kecil: Usia ${cp.ageMonths != null ? cp.ageMonths + ' bulan' : 'belum spesifik'}${(cp.symptoms || []).length > 0 ? `, Keluhan: ${cp.symptoms.join(', ')}` : ''}`);
      }
    }

    // Gerbang disambiguasi multi-anak, sesi 214956: bila 2 usia berbeda
    // tercatat TANPA konfirmasi eksplisit dan customer mulai membahas
    // pemesanan/paket, WAJIB tanya konfirmasi lembut SEBELUM mengunci total —
    // DILARANG menebak 1 vs 2 anak atau membuang salah satu sepihak.
    // Label usia dirender dinamis dari state (bukan hafalan angka).
    if (session.isMultiChildUnconfirmed === true) {
      const agedKids = (session.children || []).filter((k) => k.ageMonths != null);
      const bookingContext = (session.cartItems || []).length > 0
        || Boolean(session.selectedTreatment)
        || Boolean(session.booking?.preferredDate)
        || session.targetAudience === 'BOTH' || session.targetAudience === 'MOMS';
      if (agedKids.length >= 2 && bookingContext) {
        const ageLabel = (months: number): string =>
          months < 24 ? `${months} bln` : `${Math.round(months / 12)} th`;
        const kidDesc = agedKids.slice(0, 2).map((k, i) =>
          `${i === 0 ? 'Adik' : 'Kakak'} ${ageLabel(k.ageMonths as number)}`).join(' & ');
        lines.push(`[MANDAT KLARIFIKASI JUMLAH ANAK - WAJIB KONFIRMASI SEBELUM MENTOTAL]\n  • Customer terdeteksi menyebutkan 2 usia anak berbeda (${kidDesc}) tanpa konfirmasi eksplisit.\n  • DILARANG MENEBAK ATAU MEMBUANG SALAH SATU ANAK SECARA SEPIHAK!\n  • WAJIB tanyakan dengan ramah apakah booking ini untuk 2 anak sekaligus (${kidDesc}) bersama Bunda, atau hanya untuk 1 anak.\n  • Edukasikan keuntungan promo: jika pesan untuk 2 anak + Bunda, seluruhnya dikerjakan berurutan dalam 1 kunjungan dan tetap hemat 1x ongkir promo saja!`);
      }
    }

    // Phase 2 — Clinical linkage (bayi lahir → fase Bunda OTOMATIS postpartum):
    // usia si kecil yang tercatat berarti bayi SUDAH lahir; kecuali Bunda
    // sedang hamil lagi (momProfile PREGNANT/gestationalWeeks), fase klinis
    // Bunda adalah PASCA MELAHIRKAN/NIFAS/MENYUSUI — Prenatal DILARANG.
    // Grounding deterministik ini memandu LLM mengisi momStage: 'POSTPARTUM'
    // pada tool get_catalog_and_price kategori MOMS.
    const babyAgeMonths = session.children?.[0]?.ageMonths ?? session.childProfile?.ageMonths ?? null;
    const momIsPregnant = session.momProfile?.stage === 'PREGNANT' || session.momProfile?.gestationalWeeks != null;
    if (babyAgeMonths != null && !momIsPregnant) {
      const ageText = babyAgeMonths >= 12 && babyAgeMonths % 12 === 0
        ? `${Math.round(babyAgeMonths / 12)} tahun`
        : babyAgeMonths < 1
          ? `${Math.max(1, Math.round(babyAgeMonths * 4.345))} minggu`
          : `${babyAgeMonths} bulan`;
      lines.push(`• Fase Bunda: PASCA MELAHIRKAN / NIFAS / MENYUSUI (Si kecil sudah lahir, usia: ${ageText}) [MANDAT KLINIS: DILARANG menawarkan Prenatal Massage (Pijat Hamil) untuk Bunda yang bayinya sudah lahir! Tawarkan Oksitosin Massage Fullbody atau Paket Laktasi untuk pemulihan dan kelancaran ASI. Saat memanggil get_catalog_and_price kategori MOMS, isi momStage: 'POSTPARTUM'.]`);
    }

    if (session.selectedTreatment) {
      lines.push(`• Treatment Terpilih: ${session.selectedTreatment}`);
    } else {
      lines.push(`• Treatment Terpilih: Belum dipilih`);
    }

    if (session.booking?.preferredDate) {
      lines.push(`• Jadwal Booking: ${session.booking.preferredDate} ${session.booking.preferredTime || ''}`);
    }

    return lines.join('\n');
  }
}
