// ── PatientProfileExtractor — Pure demographic/profile extraction (zero side-effects) ──
// Extracted from goal-tracker.ts to isolate patient-profiling logic from DB/persistence.

import type { LocationState, BookingState, RecipientScope } from './goal-tracker';

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
  cartItems?: Array<{
    name: string;
    price: number;
    promoPrice?: number;
    type: 'PRIMARY' | 'ADDON' | 'SERVICE';
    category?: 'BABY' | 'KIDS' | 'MOMS' | 'BUNDLE' | 'ADDON';
    recipientLabel?: string;
    recipientScope?: RecipientScope;
  }>;
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

export class PatientProfileExtractor {
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
    const audience = PatientProfileExtractor.detectTargetAudience(text);
    const gestationalWeeks = PatientProfileExtractor.parseGestationalWeeks(text);
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
   * Heuristik sapaan honorifik CS "kakak" (bukan pasien anak).
   * Contoh: "yg kakak sebutkan", "kakak sebutkan", "makasih kakak", "halo kakak".
   * Dipakai untuk anti-false-positive CHILD_2 (audit 983902).
   */
  public static isKakakHonorific(text: string): boolean {
    const lower = (text || '').toLowerCase();
    if (!lower || !lower.includes('kakak') && !lower.includes('kaka ')) return false;
    // Pola: kata depan + kakak (yg/yang/dari/kata/tanya/ke/sama/halo/hai/makasih/terima kasih + kakak)
    if (/(?:\byg\b|\byang\b|\bdari\b|\bkata\b|\btanya\b|\bke\b|\bsama\b|\bhalo\b|\bhai\b|\bmakasih\b|terima\s+kasih)\s+kaka?k\b/i.test(lower)) return true;
    // Pola: kakak + kata kerja CS (sebutkan/jelaskan/bilang/info/sarankan/maksud/ada/ready/bisa/dong/ya)
    if (/\bkaka?k\b\s+(?:sebutkan|jelaskan|bilang|info|infokan|sarankan|maksud|ada|ready|bisa|dong|ya)\b/i.test(lower)) return true;
    // Sapaan langsung
    if (/\b(?:halo|hai|makasih|terima kasih)\s+kaka?k\b/i.test(lower)) return true;
    if (/\bmakasih\s+kaka?k\b/i.test(lower) || /\bterima\s+kasih\s+kaka?k\b/i.test(lower)) return true;
    return false;
  }

  private static isKakakFamilyContext(text: string): boolean {
    const lower = (text || '').toLowerCase();
    if (!lower) return false;
    return lower.includes('anak saya 2') || lower.includes('dua anak') || lower.includes('2 anak')
      || lower.includes('adik kakak') || lower.includes('kakak adik')
      || lower.includes('adik dan kakak') || lower.includes('kakak dan adik')
      || lower.includes('kakaknya umur') || lower.includes('kaka umur')
      || lower.includes('buat kakak') || lower.includes('untuk kakak')
      || lower.includes('kakak sama adik') || lower.includes('adik sama kakak');
  }

  /**
   * Sinyal eksplisit jumlah anak (data-driven includes, tanpa regex intent):
   * penegas multi ("anak saya 2"), label peran (Adik/Kakak), atau penegas
   * satu anak ("1 anak saja"). Dipakai untuk membersihkan latch
   * `isMultiChildUnconfirmed` — BUKAN gatekeeper perilaku LLM.
   * Honorifik "kakak sebutkan" DILARANG dihitung sebagai sinyal anak kedua.
   */
  public static isExplicitChildCountSignal(text: string): boolean {
    const lower = (text || '').toLowerCase();
    if (!lower) return false;
    const multiWords = ['anak saya 2', 'dua anak', '2 anak', 'keduanya',
      'adik kakak', 'kakak adik', 'adik dan kakak', 'kakak dan adik'];
    if (multiWords.some((w) => lower.includes(w))) return true;
    const hasKakak = (lower.includes('kakak') || (lower.includes('kaka') && !lower.includes('kakak'))) && !PatientProfileExtractor.isKakakHonorific(text);
    if (hasKakak || lower.includes('adik') || lower.includes('adek')) return true;
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
    if (PatientProfileExtractor.isMaternalOnlyMessage(text)) return false;
    if (PatientProfileExtractor.isExplicitChildCountSignal(text)) return false;
    const distinct = [...new Set(PatientProfileExtractor.extractAgesMonths(lower))];
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
    if (PatientProfileExtractor.isMaternalOnlyMessage(text)) return [...(session.children || [])];
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
    // Honorifik "kakak sebutkan / yg kakak ..." adalah sapaan CS, BUKAN pasien anak kedua.
    const rawMentionsKakak = lower.includes('kakak') || (lower.includes('kaka') && !lower.includes('kakak'));
    const isHonorific = rawMentionsKakak && PatientProfileExtractor.isKakakHonorific(text);
    const mentionsKakak = rawMentionsKakak && !isHonorific;
    const mentionsAdik = lower.includes('adik') || lower.includes('adek');
    const mentionsMulti = lower.includes('anak saya 2') || lower.includes('dua anak') || lower.includes('2 anak') || lower.includes('keduanya');

    // Usia via helper bersama (bulan/tahun + "baru lahir" + minggu bayi).
    const ages: number[] = PatientProfileExtractor.extractAgesMonths(lower);

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
}
