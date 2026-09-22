import { prisma } from '../../db/client';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { treatmentCatalogService } from '../../services/treatment-catalog.service';
import { CartManager } from './cart-manager';
import { PatientProfileExtractor } from './patient-extractor';
import { isAskedLocationRecently } from './conversation-summarizer';
import type {
  LocationState,
  ChildState,
  TargetAudienceType,
  MomStage,
  MomProfileState,
  BookingState,
  CartItem,
  OngkirStatus,
  CustomerGoalSession,
  RecipientScope,
} from '../domain/types';

// PLAN 8 FASE 6: definisi tipe kanonis di src/v3/domain/types.ts.
// Re-export menjaga seluruh import path lama tetap berfungsi.
export type {
  LocationState,
  ChildState,
  TargetAudienceType,
  MomStage,
  MomProfileState,
  BookingState,
  CartItem,
  OngkirStatus,
  CustomerGoalSession,
  RecipientScope,
} from '../domain/types';
export { GENERIC_CLINIC_TOKENS } from '../domain/types';

const DEFAULT_SESSION: CustomerGoalSession = {
  genderGreeting: 'Bunda',
};

/**
 * Ambang fase klinis Bunda berbasis usia si kecil (bulan) — grounding
 * formatGoalSessionForPrompt. Nifas ±0–2 bln, menyusui/balita 3–24 bln.
 * TODO(tenant-aware): ambang klinis idealnya dari kebijakan per-tenant di DB
 * (mis. tabel ClinicPolicy); tercatat di docs/KNOWN_ISSUES.md.
 */
export const NIFAS_MAX_AGE_MONTHS = 2;
export const TODDLER_MAX_AGE_MONTHS = 24;

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

      // Stage 4 (RC-02): sumber utama = Conversation.session_data (episodik).
      // Fallback ke Customer.preferences hanya bila session_data belum terisi
      // (kompatibilitas mundur selama transisi / conversation lama).
      const convSession: any = (conv as any).session_data || null;
      let prefs: any = convSession && typeof convSession === 'object'
        ? convSession
        : ((conv.customer?.preferences as any) || {});

      // Plan Fase 2.2 (sesi 89-turn): RESILIENT MEMORY FALLBACK — bila record
      // DB ada tapi session_data & preferences kosong padahal cache memori
      // memuat data substantif (lokasi/profil), pakai memori daripada me-reset
      // brutal ke DEFAULT_SESSION (anti-amnesia saat glitch/migrasi DB).
      const hasSubstantivePrefs = Boolean(
        prefs.location || prefs.targetAudience || prefs.momProfile ||
        prefs.childProfile || (Array.isArray(prefs.cartItems) && prefs.cartItems.length > 0) ||
        prefs.selectedTreatmentName || prefs.selectedTreatment
      );
      if (!hasSubstantivePrefs) {
        const mem = memorySessions.get(memoryKey(conversationId, tenantId));
        const hasSubstantiveMem = Boolean(
          mem && (
            mem.location || mem.targetAudience || mem.momProfile ||
            mem.childProfile || (Array.isArray(mem.cartItems) && mem.cartItems.length > 0) ||
            mem.selectedTreatment
          )
        );
        if (hasSubstantiveMem) {
          console.warn(JSON.stringify({ event: 'GOAL_TRACKER_MEMORY_FALLBACK', tenantId, conversationId, timestamp: new Date().toISOString() }));
          prefs = { ...mem, ...prefs };
        }
      }

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
        bookingCommitConfirmed: prefs.bookingCommitConfirmed === true ? true : undefined,
        formRetryCount: typeof prefs.formRetryCount === 'number' ? prefs.formRetryCount : undefined,
        lastCommitment: (prefs.lastCommitment === 'EXPLORING' || prefs.lastCommitment === 'CONSIDERING' || prefs.lastCommitment === 'COMMITTED')
          ? prefs.lastCommitment : undefined,
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
          // Stage 4 (RC-02) + Plan #1 (sesi 89-turn): persistensi EPISODIK dan
          // DURABLE diisolasi dalam blok try masing-masing. Sebelumnya satu blok
          // try raksasa membuat kegagalan tulis session_data (mis. kolom belum
          // di-migrate) MENGGUGURKAN mirror durable ke tabel Customer — akar
          // amnesia lokasi lintas-turn.
          try {
            await prisma.conversation.updateMany({
              where: { id: conversationId, tenant_id: tenantId },
              data: { session_data: merged as any } as any,
            });
          } catch (episodicErr: any) {
            console.warn(JSON.stringify({ event: 'GOAL_TRACKER_EPISODIC_WRITE_ERROR', tenantId, conversationId, error: episodicErr.message, timestamp: new Date().toISOString() }));
          }

          // Mirror DURABLE saja ke Customer (agar pembaca lama tetap benar:
          // alamat untuk CAPI/enrichment/staff, nama & kolom profil).
          const customerData: any = {};
          if (merged.customerName) customerData.name = merged.customerName;
          if (merged.location) {
            if (merged.location.kelurahan) customerData.kelurahan = merged.location.kelurahan;
            if (merged.location.kecamatan) customerData.kecamatan = merged.location.kecamatan;
            if (merged.location.kota) customerData.kota = merged.location.kota;
            if (merged.location.distanceKm != null) customerData.distance_km = merged.location.distanceKm;
            if (merged.location.ongkirPromo != null || merged.location.ongkirNormal != null) {
              customerData.ongkir = merged.location.ongkirPromo || merged.location.ongkirNormal;
            }
            if (merged.location.isOutOfCoverage != null) customerData.is_out_of_coverage = merged.location.isOutOfCoverage;
          }

          // Mirror preferences DURABLE saja (address/landmark/house_photo_url/
          // genderGreeting/customerName) — TIDAK menyertakan field episodik
          // (cartItems/booking/selectedTreatment) agar pembaca lama tidak
          // melihat state basi; state episodik hidup di Conversation.
          let prevPrefs: any = {};
          try {
            const cust = await prisma.customer.findFirst({
              where: { id: conv.customer_id, tenant_id: tenantId },
              select: { preferences: true },
            });
            prevPrefs = (cust?.preferences as any) || {};
          } catch { /* DB offline → mulai dari kosong */ }
          const durablePrefs: any = {
            ...prevPrefs,
            ...(merged.customerName ? { customerName: merged.customerName } : {}),
            ...(merged.genderGreeting ? { genderGreeting: merged.genderGreeting } : {}),
          };
          customerData.preferences = durablePrefs;

          await prisma.customer.updateMany({
            where: { id: conv.customer_id, tenant_id: tenantId },
            data: customerData
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
  public static formatGoalSessionForPrompt(
    session: CustomerGoalSession,
    opts?: { history?: Array<{ role: string; content: string }>; askedLocationRecently?: boolean; incomingText?: string }
  ): string {
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
    const isFeverContraindicated = session.feverContraindication === true;
    let pregroundedRecommendation: string | null = null;
    if (isFeverContraindicated) {
      pregroundedRecommendation = `[KONTRAINDIKASI DEMAM AKTIF]: Suhu tubuh si kecil terindikasi demam (≥38°C). Pijat/terapi DIKONTRAINDIKASIKAN sementara waktu hingga suhu tubuh kembali normal dan anak aktif. DILARANG mempromosikan atau menawarkan jadwal pemesanan paket berulang-ulang! Berikan respon empati singkat (maks 2-3 kalimat), edukasi observasi suhu, dan tegaskan pemijatan dapat dijadwalkan setelah si kecil pulih.`;
    } else if (allSymptoms.length > 0 && !session.selectedTreatment) {
      try {
        const categoryHint = session.targetAudience === 'MOMS' ? 'MOMS' as any : session.targetAudience === 'BOTH' ? undefined : session.targetAudience as any;
        const rec = treatmentCatalogService.recommendServiceBySymptoms(allSymptoms, session.childProfile?.ageMonths ?? session.children?.[0]?.ageMonths ?? null, categoryHint);
        if (rec) {
          const subjectLabel = isMomSubject && momComplaints.length > 0 && childSymptoms.length === 0 ? 'keluhan Bunda' : 'keluhan si kecil';
          pregroundedRecommendation = `• Rekomendasi Sesuai Keluhan (${allSymptoms.join(', ')}): *${rec.name}* (Promo ${`Rp ${rec.promoPrice.toLocaleString('id-ID')}`}) — ${rec.description}\n  [MANDAT WAJIB: Tawarkan layanan rekomendasi di atas untuk ${subjectLabel} ini. DILARANG mengganti dengan nama paket lain!]\n  [MANDAT ANTI-RELAKSASI-MURNI (audit 337101): si kecil ada keluhan fisik di atas — DILARANG merekomendasikan paket relaksasi murni (untuk bayi sehat tanpa keluhan)! WAJIB paket terapi penanganan keluhan di atas.]`;
        }
      } catch (_) {}
    } else if (allSymptoms.length === 0 && !session.selectedTreatment) {
      // Paket relaksasi default dari katalog (age-aware 391501 Fase 2).
      // Plan Fase 2.3 (sesi 89-turn): MATERNAL CONTEXT-AWARE — sesi ibu
      // (targetAudience MOMS/BOTH atau momProfile aktif) WAJIB direkomendasikan
      // paket ibu (MOMS/BOTH), BUKAN paket bayi. Label header ikut menyesuaikan.
      try {
        const isMomDefault = isMomSubject;
        const childAge = (session.childProfile as any)?.ageMonths ?? (session.children as any)?.[0]?.ageMonths ?? null;
        const categoryHint: any = isMomDefault
          ? (session.targetAudience === 'BOTH' ? 'BOTH' : 'MOMS')
          : session.targetAudience === 'KIDS' ? 'KIDS' : 'BABY';
        const def = treatmentCatalogService.getDefaultRelaxationService(categoryHint, isMomDefault ? null : childAge as number | null);
        if (def) {
          const headerLabel = isMomDefault
            ? 'Rekomendasi Paket Dasar (Ibu Sehat Relaksasi)'
            : 'Rekomendasi Paket Dasar (Bayi Sehat Tanpa Keluhan)';
          const targetLabel = isMomDefault ? 'Bunda' : 'bayi sehat';
          pregroundedRecommendation = `• ${headerLabel}: *${def.name}* — ${def.description}\n  [MANDAT: Tawarkan paket dasar di atas untuk ${targetLabel}; DILARANG menyebut paket terapi sakit bila tidak ada keluhan!]\n  [MANDAT: DILARANG memuntahkan harga/promo jika customer belum bertanya harga/biaya!]`;
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
      // Rule 2 (Strict Information Hiding, state-gated prompt pruning): nominal
      // ongkir DILARANG disuntik ke prompt LLM bila customer belum pernah
      // menanyakan biaya/ongkir (mode konsultasi). Menyembunyikan di payload
      // tool saja tidak cukup — grounding prompt ini adalah jalur bocor kedua.
      // Eksposur dibuka hanya bila transaksional (priceDiscussed) — konsisten
      // dengan gatekeeper audit 694493.
      if (session.location.ongkirPromo != null && session.priceDiscussed === true) {
        const ongkirState = session.ongkirStatus === 'CONFIRMED'
          ? 'SUDAH DIKONFIRMASI - DILARANG ULANG HITUNGAN KM/ONGKIR!'
          : session.ongkirStatus === 'QUOTED'
            ? 'SUDAH DISAMPAIKAN - DILARANG ULANG HITUNGAN KM/ONGKIR!'
            : null;
        lines.push(`• Ongkir: Rp ${session.location.ongkirPromo.toLocaleString('id-ID')} (Promo dari normal Rp ${session.location.ongkirNormal?.toLocaleString('id-ID') || '-'})` + (ongkirState ? ` [STATUS: ${ongkirState}]` : ''));
      }
    } else {
      const recentlyAsked = opts?.askedLocationRecently ?? (opts?.history ? isAskedLocationRecently(opts.history) : false);
      const locationResolved = Boolean(session.location?.kelurahan || session.location?.distanceKm != null);
      const locationPartiallyResolved = Boolean(session.location?.kelurahan || session.location?.kecamatan || session.location?.kota || session.location?.distanceKm != null);

      // Heuristic sama seperti conversation-summarizer: cek apakah user menjawab dengan nama lokasi
      const isLikelyLocationAnswer = (text: string): boolean => {
        const lower = text.toLowerCase().trim();
        if (lower.length === 0 || lower.length > 30) return false;
        if (lower.includes('?') || lower.includes(' apa') || lower.includes(' berapa') || lower.includes(' bisa')) return false;
        const questionKeywords = ['harga', 'tarif', 'biaya', 'promo', 'pijat', 'batuk', 'pilek', 'kembung', 'grok', 'kolik', 'gtm', 'nafsu', 'makan', 'tidur', 'rewel', 'pegala', 'capek', 'demam', 'panas', 'flu', 'cukur', 'rambut', 'jadwal', 'hari', 'jam', 'slot', 'kosong', 'tersedia', 'bulan', 'tahun', 'usia', 'umur', 'ikut', 'masuk', 'kategori', 'cukur', 'menit', 'durasi', 'lama', 'boleh', 'mau', 'ingin', 'perlu', 'butuh'];
        if (questionKeywords.some((kw) => lower.includes(kw))) return false;
        // Partikel percakapan yang BUKAN nama lokasi — hindari false positive pada filler
        const conversationalFillers = ['ya', 'kak', 'deh', 'dong', 'sih', 'nih', 'gitu', 'oke', 'baik', 'oh', 'siang', 'pagi', 'sore', 'malam', 'terima', 'kasih', 'makasih', 'trims', 'thanks'];
        const words = lower.split(/\s+/).filter(Boolean);
        // Jika SEMUA kata adalah filler percakapan → bukan jawaban lokasi
        if (words.every((w) => conversationalFillers.includes(w))) return false;
        // Jawaban lokasi cenderung 1-3 kata, tanpa kata tanya/layanan
        return words.length >= 1 && words.length <= 3;
      };

      const userAnsweredLocation = recentlyAsked && !locationResolved && opts?.incomingText && isLikelyLocationAnswer(opts.incomingText);
      if (recentlyAsked && !locationResolved && !userAnsweredLocation) {
        lines.push(`• Lokasi: Belum diketahui (Sudah ditanyakan di pesan sebelumnya — JANGAN menanyakan lokasi lagi pada turn ini, fokus jawab keluhan/pertanyaan Bunda)`);
      } else {
        lines.push(`• Lokasi: Belum diketahui (Perlu ditanyakan kelurahan/kecamatannya)`);
      }
    }

    if (session.cartItems && session.cartItems.length > 0) {
      const fmtRp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;
      let catalogServices: any[] = [];
      try {
        catalogServices = treatmentCatalogService.getAllServices(true);
      } catch (_) {}

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
        // Plan regresi Fase 2.3: fallback buta 'Si Kecil' dihapus. Scope
        // GENERAL/nihil merujuk audiens sesi: MOMS/momProfile → 'Bunda'.
        const who = it.recipientLabel
          || (scope === 'MOMS' ? 'Bunda' : scope === 'CHILD_2' ? 'Kakak' : scope === 'CHILD_1' ? 'Si Kecil'
            : (session.targetAudience === 'MOMS' || session.momProfile != null ? 'Bunda' : 'Si Kecil'));
        const priceLabel = it.type === 'ADDON'
          ? `Tambahan: ${fmtRp(it.promoPrice ?? it.price)}`
          : it.type === 'SERVICE'
            ? `Layanan: ${fmtRp(it.promoPrice ?? it.price)}`
            : `Promo: ${fmtRp(it.promoPrice ?? it.price)}`;

        // Sesi 887216: inject durasi resmi & batasan usia dari katalog DB secara data-driven
        const svc = catalogServices.find((s) => s.name.toLowerCase() === (it.name || '').toLowerCase());
        const metaParts: string[] = [];
        if (svc && typeof svc.durationMinutes === 'number' && svc.durationMinutes > 0) {
          metaParts.push(`Durasi Resmi: ${svc.durationMinutes} menit`);
        }
        if (svc?.ageTier?.label) {
          metaParts.push(`Batasan Usia: ${svc.ageTier.label}`);
        }
        const metaStr = metaParts.length > 0 ? ` [${metaParts.join(' | ')}]` : '';

        return `  - [Untuk ${who}${ageSuffixFor(scope, it.recipientLabel)}] ${it.name} (${priceLabel})${metaStr}`;
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
        lines.push(`[MANDAT INTEGRITAS MATEMATIKA: Total Akumulasi Biaya Resmi adalah ${fmtRp(grandTotal)} (Rincian: ${rincian}). HANYA sebutkan angka total ini bila customer di turn ini menanyakan biaya/harga/total, ATAU saat merangkum pesanan final sebelum konfirmasi booking! DILARANG KERAS menyebutkan angka total ini di tengah pembicaraan jadwal/jam tanpa ditanya customer! Saat menyebutkan total biaya, WAJIB gunakan angka resmi ${fmtRp(grandTotal)} ini. DILARANG menghitung sendiri, menebak, atau mengubah nominal!]`);
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
            lines.push(`[MANDAT ESTIMASI WAKTU: Total durasi ~${durTotal} menit ini HANYA boleh disampaikan jika customer menanyakan durasi/lama pengerjaan. DILARANG KERAS menyebutkan angka durasi menit jika tidak ditanyakan! Saat customer menanyakan total jam/lama waktu pengerjaan, WAJIB jumlahkan seluruh durasi layanan di keranjang di atas secara utuh, termasuk durasi perawatan Bunda. DILARANG melupakan layanan Bunda!]`);
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
      // Tier klinis usia-aware (audit Turn 6–8): NIFAS hanya untuk bayi baru
      // lahir; ibu balita BUKAN pasien nifas — DILARANG momStage POSTPARTUM.
      if (babyAgeMonths <= NIFAS_MAX_AGE_MONTHS) {
        lines.push(`• Fase Bunda: PASCA MELAHIRKAN / NIFAS (Si kecil baru lahir, usia: ${ageText}) [MANDAT KLINIS: DILARANG menawarkan Prenatal Massage (Pijat Hamil) untuk Bunda yang bayinya sudah lahir! Tawarkan Oksitosin Massage Fullbody atau Paket Laktasi untuk pemulihan dan kelancaran ASI. Saat memanggil get_catalog_and_price kategori MOMS, isi momStage: 'POSTPARTUM'.]`);
      } else if (babyAgeMonths <= TODDLER_MAX_AGE_MONTHS) {
        lines.push(`• Fase Bunda: MENYUSUI / IBU BALITA (Si kecil usia: ${ageText}) [MANDAT KLINIS: DILARANG menawarkan Prenatal Massage! Tawarkan Paket Laktasi, Oksitosin Massage Fullbody, atau Pijat Relaksasi Ibu. Saat memanggil get_catalog_and_price kategori MOMS, isi momStage: 'BREASTFEEDING'.]`);
      } else {
        lines.push(`• Fase Bunda: IBU ANAK (Si kecil usia: ${ageText}) [Fokus pada kebutuhan perawatan relaksasi/nutrisi anak. Saat memanggil get_catalog_and_price kategori MOMS, isi momStage: 'GENERAL'.]`);
      }
    }

    if (session.selectedTreatment) {
      lines.push(`• Treatment Terpilih: ${session.selectedTreatment}`);
    } else {
      lines.push(`• Treatment Terpilih: Belum dipilih`);
    }

    if (session.booking?.preferredDate) {
      lines.push(`• Jadwal Booking: ${session.booking.preferredDate} ${session.booking.preferredTime || ''}`);
    } else if (session.booking?.requestedTimeHint) {
      lines.push(`• Preferensi Waktu Diminta: ${session.booking.requestedTimeHint}`);
    }

    if (session.booking?.pendingScheduleCheck) {
      lines.push(`• Status Verifikasi Jadwal: Menunggu konfirmasi ketersediaan slot dari tim Bidan/Admin [JANGAN berjanji cek ulang bila customer hanya mengonfirmasi menunggu].`);
    }

    return lines.join('\n');
  }
}
