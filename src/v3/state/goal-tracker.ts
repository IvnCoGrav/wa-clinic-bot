import { prisma } from '../../db/client';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { treatmentCatalogService } from '../../services/treatment-catalog.service';
import { CartManager, CartItem as CartItemType, RecipientScope as RecipientScopeType, GENERIC_CLINIC_TOKENS as GENERIC_CLINIC_TOKENS_CONST } from './cart-manager';
import { PatientProfileExtractor } from './patient-extractor';

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
  // ── Cart delegation (CartManager) ──
  public static detectRecipientScope = CartManager.detectRecipientScope;
  public static isDurationOnlyQuestion = CartManager.isDurationOnlyQuestion;
  public static syncCartItems = CartManager.syncCartItems;
  public static resolveAffirmativeSwap = CartManager.resolveAffirmativeSwap;
  public static calcCartTotal = CartManager.calcCartTotal;

  // ── Patient extraction delegation (PatientProfileExtractor) ──
  public static detectExplicitGenderPreference = PatientProfileExtractor.detectExplicitGenderPreference;
  public static isMaternalOnlyMessage = PatientProfileExtractor.isMaternalOnlyMessage;
  public static detectTargetAudience = PatientProfileExtractor.detectTargetAudience;
  public static parseGestationalWeeks = PatientProfileExtractor.parseGestationalWeeks;
  public static syncMomProfile = PatientProfileExtractor.syncMomProfile;
  public static extractAgesMonths = PatientProfileExtractor.extractAgesMonths;
  public static isKakakHonorific = PatientProfileExtractor.isKakakHonorific;
  public static isExplicitChildCountSignal = PatientProfileExtractor.isExplicitChildCountSignal;
  public static detectUnconfirmedMultiChild = PatientProfileExtractor.detectUnconfirmedMultiChild;
  public static syncChildrenProfiles = PatientProfileExtractor.syncChildrenProfiles;

  // ── GoalSessionStore (full implementation) ──

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
          pregroundedRecommendation = `• Rekomendasi Paket Dasar (Bayi Sehat Tanpa Keluhan): *${def.name}* — ${def.description}\n  [MANDAT: Tawarkan paket dasar di atas untuk bayi sehat; DILARANG menyebut paket terapi sakit bila tidak ada keluhan!]\n  [MANDAT: DILARANG memuntahkan harga/promo jika customer belum bertanya harga/biaya!]`;
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
