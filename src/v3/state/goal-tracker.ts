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
  selectedTreatment?: string;
  booking?: BookingState;
  cartItems?: CartItem[];
  ongkirStatus?: OngkirStatus;
  totalPrice?: number;
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
      
      // Deteksi sapaan Bapak jika nama customer menunjukkan pria
      const custName = conv.customer?.name || prefs.customerName || '';
      const isMale = /\b(bapak|pak|ayah|papa|bapake|naufal|ahmad|budi|agus|dwi|eko|adi|ivan)\b/i.test(custName);

      return {
        customerName: custName || undefined,
        genderGreeting: isMale ? 'Bapak' : (prefs.genderGreeting || 'Bunda'),
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
   * Deteksi scope penerima dari teks pesan (data-driven keyword, tanpa regex):
   * MOMS (layanan ibu), CHILD_2 (kakak), CHILD_1 (adik/si kecil), GENERAL (netral).
   */
  public static detectRecipientScope(
    text: string,
    service?: { name?: string; category?: string; isAddon?: boolean }
  ): RecipientScope {
    const lower = (text || '').toLowerCase();
    const hasAny = (words: string[]) => words.some((w) => lower.includes(w));
    if (
      service?.category === 'MOMS' ||
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
    catalog: Array<{ name: string; promoPrice?: number | null; originalPrice?: number | null; category?: string; isAddon?: boolean }>
  ): CartItem[] {
    const cart: CartItem[] = [...(session.cartItems || [])];
    const keyOf = (name: string, scope: RecipientScope) => `${scope}::${name.toLowerCase()}`;
    const inCart = new Set(cart.map((c) => keyOf(c.name, c.recipientScope || 'GENERAL')));
    const services = [...(catalog || [])]
      .filter((s) => s && s.name && s.name.trim().length >= 4)
      .sort((a, b) => b.name.length - a.name.length);
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
    // Diproses KRONOLOGIS (tertua → terbaru) agar PRIMARY terbaru menimpa yang lama secara natural (domain rule)
    for (let i = 0; i < history.length; i++) {
      const text = (history[i]?.content || '').toLowerCase();
      if (!text || GoalTracker.isDurationOnlyQuestion(text)) continue;
      // 1. Nama persis selalu dihitung (semua yang cocok, termasuk pesan asisten).
      //    Filter Substring Overlap: bila nama layanan A adalah substring dari
      //    layanan B yang sama-sama cocok (mis. "Induksi Massage" vs
      //    "Induksi Massage Fullbody"), A gugur — yang spesifik/panjang menang
      //    agar keranjang tidak tertimpa harga yang salah (Rp 50k vs Rp 105k).
      const rawExactHits = services.filter((s) => text.includes(s.name.toLowerCase()));
      const exactHits = rawExactHits.filter((s) =>
        !rawExactHits.some((other) =>
          other !== s && other.name.toLowerCase().includes(s.name.toLowerCase())
        )
      );
      // 2. Tanpa nama persis, parafrasa hanya mengambil SATU yang terpanjang
      //    (paling spesifik) agar tidak mengotori keranjang dengan kandidat umum.
      //    Pesan asisten (role === 'assistant') DILARANG memicu fuzzyHits — sapaan
      //    bot ("Treatment moms & Baby...") tidak boleh memasukkan phantom item;
      //    asisten hanya boleh mencocokkan nama layanan resmi utuh (exactHits).
      const isAssistant = (history[i]?.role || '').toLowerCase() === 'assistant';
      const fuzzyHits = (exactHits.length === 0 && !isAssistant)
        ? services.filter((s) => fuzzyMatches(text, s.name)).sort((a, b) => b.name.length - a.name.length).slice(0, 2)
        : [];
      for (const s of [...exactHits, ...fuzzyHits]) {
        pushService(s, GoalTracker.detectRecipientScope(text, s));
      }
    }
    return cart;
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
      || lower.includes('uk ')
      || lower.includes(' uk')
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

    // Usia: "2 bulan", "3 tahun", "4 bln", "baru lahir" (=0 bulan).
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

    const SYMPTOM_WORDS = ['pilek', 'batuk', 'demam', 'kembung', 'kolik', 'grok', 'rewel', 'susah tidur', 'gtm', 'diare', 'bapil', 'flu', 'kuning', 'ruam', 'makan', 'lahap', 'sulit makan', 'doyan makan', 'hidung'];
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
      // Satu usia/gejala → anak berlabel peran bila disebut ("Kakak ... 3 tahun"
      // tidak boleh menimpa Adik), else anak pertama.
      const idx: 0 | 1 = mentionsKakak ? 1 : 0;
      const child = ensureChild(idx, idx === 1 ? 'Kakak' : (mentionsAdik ? 'Adik' : 'Si Kecil'));
      if (ages.length === 1) child.ageMonths = ages[0];
      addSymptoms(child);
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
          pregroundedRecommendation = `• Rekomendasi Sesuai Keluhan (${allSymptoms.join(', ')}): *${rec.name}* (Promo ${`Rp ${rec.promoPrice.toLocaleString('id-ID')}`}) — ${rec.description}\n  [MANDAT WAJIB: Tawarkan layanan rekomendasi di atas untuk ${subjectLabel} ini. DILARANG mengganti dengan nama paket lain!]`;
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
      lines.push(`• Total Akumulasi Biaya: ${fmtRp(subtotal + ongkir)} (Treatment ${fmtRp(subtotal)} + Ongkir ${fmtRp(ongkir)})`);
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
        const kidLines = kids.map((k) => {
          const label = k.roleLabel || 'Anak';
          const age = k.ageMonths != null
            ? (k.ageMonths >= 12 && k.ageMonths % 12 === 0 ? `${Math.round(k.ageMonths / 12)} tahun (${k.ageMonths} bulan)` : `${k.ageMonths} bulan`)
            : 'usia belum diketahui';
          const sym = (k.symptoms && k.symptoms.length > 0) ? `, Keluhan: ${k.symptoms.join(', ')}` : ', Sehat/Relaksasi';
          return `  - ${label}: Usia ${age}${sym}`;
        });
        lines.push(`• Data Si Kecil (${kids.length} Anak):\n${kidLines.join('\n')}`);
      } else if (kids.length === 1) {
        const cp = kids[0];
        lines.push(`• Data Si Kecil: Usia ${cp.ageMonths != null ? cp.ageMonths + ' bulan' : 'belum spesifik'}${(cp.symptoms || []).length > 0 ? `, Keluhan: ${cp.symptoms.join(', ')}` : ''}`);
      }
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
