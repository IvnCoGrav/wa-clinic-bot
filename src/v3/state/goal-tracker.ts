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
        childProfile: updates.childProfile ? { ...current.childProfile, ...updates.childProfile } : current.childProfile,
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

      // Selalu cache ke memory untuk fallback offline & concurrency
      memorySessions.set(memoryKey(conversationId, tenantId), { ...merged });

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
      return hits >= 2 && hits / toks.length >= 0.5;
    };
    const pushService = (s: (typeof services)[number], scope: RecipientScope, switching = false) => {
      const price = typeof s.originalPrice === 'number' ? s.originalPrice : 0;
      const type = s.isAddon ? 'ADDON' : (s.category === 'BUNDLE' ? 'SERVICE' : 'PRIMARY');
      const category = (s.category as CartItem['category']) || (s.isAddon ? 'ADDON' : undefined);
      const recipientLabel = scope === 'MOMS' ? 'Bunda' : scope === 'CHILD_2' ? 'Kakak' : scope === 'CHILD_1' ? 'Si Kecil' : undefined;
      // Replace: PRIMARY baru menggantikan PRIMARY lama pada scope yang sama HANYA
      // bila pesan menandakan pergantian eksplisit (ganti/pindah/batal/...).
      if (type === 'PRIMARY' && switching) {
        const idx = cart.findIndex((c) => c.type === 'PRIMARY' && (c.recipientScope || 'GENERAL') === scope);
        if (idx >= 0) {
          inCart.delete(keyOf(cart[idx].name, scope));
          cart[idx] = { name: s.name, price, promoPrice: typeof s.promoPrice === 'number' ? s.promoPrice : price, type, category, recipientLabel, recipientScope: scope };
          inCart.add(keyOf(s.name, scope));
          return;
        }
      }
      if (inCart.has(keyOf(s.name, scope))) return;
      cart.push({
        name: s.name, price,
        promoPrice: typeof s.promoPrice === 'number' ? s.promoPrice : price,
        type, category, recipientLabel, recipientScope: scope,
      });
      inCart.add(keyOf(s.name, scope));
    };
    // Sinyal pergantian eksplisit: PRIMARY baru menggantikan PRIMARY lama scope sama
    // HANYA bila pesan menandakan switch (bukan sekadar menyebut layanan tambahan).
    const isSwitchSignal = (text: string): boolean =>
      text.includes('ganti') || text.includes('pindah') || text.includes('jadinya') ||
      text.includes('bukan') || text.includes('batal') || text.includes('sebelumnya') ||
      text.includes('yang tadi');
    // Diproses KRONOLOGIS (tertua → terbaru) agar sinyal pergantian ("ganti ke ...")
    // menggantikan item lama secara natural, bukan sebaliknya.
    for (let i = 0; i < history.length; i++) {
      const text = (history[i]?.content || '').toLowerCase();
      if (!text || GoalTracker.isDurationOnlyQuestion(text)) continue;
      const switching = isSwitchSignal(text);
      // 1. Nama persis selalu dihitung (semua yang cocok, termasuk pesan asisten).
      const exactHits = services.filter((s) => text.includes(s.name.toLowerCase()));
      // 2. Tanpa nama persis, parafrasa hanya mengambil SATU yang terpanjang
      //    (paling spesifik) agar tidak mengotori keranjang dengan kandidat umum.
      //    Pesan asisten (role === 'assistant') DILARANG memicu fuzzyHits — sapaan
      //    bot ("Treatment moms & Baby...") tidak boleh memasukkan phantom item;
      //    asisten hanya boleh mencocokkan nama layanan resmi utuh (exactHits).
      const isAssistant = (history[i]?.role || '').toLowerCase() === 'assistant';
      const fuzzyHits = (exactHits.length === 0 && !isAssistant)
        ? services.filter((s) => fuzzyMatches(text, s.name)).sort((a, b) => b.name.length - a.name.length).slice(0, 1)
        : [];
      for (const s of [...exactHits, ...fuzzyHits]) {
        pushService(s, GoalTracker.detectRecipientScope(text, s), switching);
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
  public static syncChildrenProfiles(
    session: CustomerGoalSession,
    text: string
  ): ChildState[] {
    const lower = (text || '').toLowerCase();
    if (!lower) return [...(session.children || [])];
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
    // Pre-grounding deterministik (Zero-Code): rekomendasi dari katalog aktif
    const allSymptoms: string[] = [
      ...(session.childProfile?.symptoms || []),
      ...((session.children || []).flatMap((c) => c.symptoms || [])),
    ].filter((s, i, arr) => arr.indexOf(s) === i);
    let pregroundedRecommendation: string | null = null;
    if (allSymptoms.length > 0 && !session.selectedTreatment) {
      try {
        const rec = treatmentCatalogService.recommendServiceBySymptoms(allSymptoms, session.childProfile?.ageMonths ?? session.children?.[0]?.ageMonths ?? null);
        if (rec) {
          pregroundedRecommendation = `• Rekomendasi Sesuai Keluhan (${allSymptoms.join(', ')}): *${rec.name}* (Promo ${`Rp ${rec.promoPrice.toLocaleString('id-ID')}`}) — ${rec.description}\n  [MANDAT WAJIB: Tawarkan layanan rekomendasi di atas untuk keluhan si kecil ini. DILARANG mengganti dengan nama paket lain!]`;
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

    const kids = session.children && session.children.length > 0
      ? session.children
      : (session.childProfile ? [session.childProfile] : []);
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
    } else if (session.childProfile) {
      lines.push(`• Data Si Kecil: Usia ${session.childProfile.ageMonths != null ? session.childProfile.ageMonths + ' bulan' : 'belum spesifik'}${session.childProfile.symptoms.length > 0 ? `, Keluhan: ${session.childProfile.symptoms.join(', ')}` : ''}`);
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
