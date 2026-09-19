/**
 * src/v3/guardrails/factual-claim-validator.ts
 * Validasi silang klaim NON-ANGKA di draf balasan terhadap data tool turn ini.
 * (Angka ditangani numeric-fact-validator; di sini: nama layanan, aturan
 * vaksin, anjuran SOP, durasi tekstual, klaim efikasi absolut.)
 *
 * Prinsip: yang dicek adalah KONSISTENSI terhadap output tool
 * (get_catalog_and_price, get_clinic_policy_faq, search_knowledge_faq),
 * bukan daftar hafalan bisnis di kode. Pola bahasa generik (klaim absolut)
 * adalah guardrail linguistik, setara dengan ekstraksi numerik teknis.
 */

import { getGazetteerKecamatanNames } from '../../utils/gazetteer';

export interface FactualValidationResult {
  isValid: boolean;
  violations: string[];
}

interface ToolExec {
  name: string;
  args?: any;
  result: any;
}

/** Klaim efikasi absolut — tidak boleh muncul tanpa syarat dari data mana pun. */
const ABSOLUTE_EFFICACY_RE =
  /menyembuhkan|dijamin\s+(sembuh|sehat|berhasil)|sembuh\s+total|100%\s*(sembuh|efektif|aman|berhasil)|tanpa\s+efek\s+samping|pasti\s+sembuh/i;

/** Penanda pembahasan vaksin/imunisasi. */
const VACCINE_RE = /vaksin|imunisasi|\bbcg\b|\bpolio\b|\bdpt\b/i;

/** Penanda anjuran klinis/SOP (butuh landasan artikel bila substantif). */
const ADVISORY_RE =
  /sebaiknya|seharusnya|disarankan|rutinkan|rutin\s+\w+|setiap\s+hari|tidak\s+boleh|dilarang|wajib\s+\w+/i;

/**
 * Bingkai penolakan/defleksi sopan ("belum tersedia, diteruskan ke CS", penolakan resep obat/medis).
 * TEMPORARY STOP-GAP (lihat tiket structural-refusal-tagging):
 * Mengecualikan defleksi rujukan medis (ke dokter/faskes/RS dan penolakan resep obat)
 * dari tuduhan anjuran klinis tak berdasar (D3).
 */
const REFUSAL_FRAME_RE =
  /belum\s+tersedia|tidak\s+tersedia|tidak\s+melayani|belum\s+ada|teruskan\s+ke|\bCS\b|admin|tidak\s+(bisa|dapat|memiliki\s+wewenang)\s+(memberikan\s+)?(resep|saran\s+medis|obat)|konsultasi\s+(langsung\s+)?(dengan|ke)\s+(dokter|faskes|puskesmas|rumah\s+sakit|rs)|periksakan\s+(ke|dengan)\s+dokter/i;

/** Atribusi domisili kecamatan ke customer ("Area Kecamatan X", "rumah Bunda di X"). */
const DOMICILE_ATTR_RE =
  /area\s+kecamatan\s+([a-z][a-z\s]{2,40}?)(?:\s+ini|\s+masih|\s+adalah|[,.!?]|$)|rumah\s+(?:bunda|anda)\s+di\s+([a-z][a-z\s]{2,40}?)(?:[,.!?]|$)|lokasi\s+(?:bunda|anda)\s+di\s+([a-z][a-z\s]{2,40}?)(?:[,.!?]|$)/i;

/** Pengecualian: fakta homebase klinik sendiri ("homebase kami di X"). */
const HOMEBASE_EXEMPT_RE = /homebase\s+(kami|klinik)|klinik\s+kami\s+di/i;

/**
 * Pencocokan frasa kata-utuh (sliding window token): "warung" DILARANG
 * membebaskan klaim "waru"; "ke kenjeran berapa ya" membebaskan "kenjeran".
 * Tokenisasi teknis, bukan hafalan kalimat.
 */
function mentionsPhrase(haystack: string, phrase: string): boolean {
  const hToks = (haystack || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const pToks = (phrase || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (pToks.length === 0 || hToks.length < pToks.length) return false;
  for (let i = 0; i <= hToks.length - pToks.length; i++) {
    if (pToks.every((t, j) => hToks[i + j] === t)) return true;
  }
  return false;
}

export interface FactualValidationOptions {
  /** True bila sesi sudah memuat kelurahan/kecamatan customer. */
  locationKnown?: boolean;
  /**
   * Plan regresi Fase 1 (Sesi 580976): pesan customer turn ini. Kecamatan
   * yang DISEBUT CUSTOMER atau DIKEMBALIKAN tool calculate_delivery adalah
   * grounding sah — BUKAN halusinasi — walau session.location masih kosong.
   */
  customerInput?: string;
  /**
   * Fase 6 K2 (Issue #74) — metadata struktural penolakan/eskalasi.
   * True bila turn ini mengeksekusi escalate_to_human ATAU dipicu sinyal
   * deterministik trauma-jatuh/vaksin (dihitung call-site, BUKAN dari frasa
   * balasan). Melewatkan D3 secara deterministik; REFUSAL_FRAME_RE tetap
   * sebagai fallback warisan bila tag tak tersedia.
   */
  isRefusalOrEscalation?: boolean;
}

/** Kata generik satu-kata yang boleh di-bold tanpa padanan katalog. */
const GENERIC_BOLD_WORDS = new Set([
  'pijat', 'bayi', 'baby', 'bunda', 'bund', 'moms', 'mom', 'spa', 'treatment',
  'perawatan', 'layanan', 'homecare', 'promo', 'diskon', 'jadwal', 'ongkir',
  'paket', 'harga', 'gratis', 'bayar', 'jadwalkan', 'ayah', 'bapak', 'ibu',
]);

/** Penanda bahwa teks bold/quoted merujuk nama layanan (baru dicek ke katalog). */
const TREATMENT_MARKER_RE =
  /pijat|spa|massage|terapi|paket|treatment|laktasi|moksa|oksitosin|cukur|mandi|moms|baby|bayi|vaksin|facial|totok/i;

/**
 * D8 — Narasi asal homebase/basecamp yang disisipkan ke balasan BUKAN
 * tanya-lokasi (mis. info jarak/ongkir "dari basecamp kami di Waru").
 * Pola linguistik generik (bingkai asal), bukan hafalan kalimat:
 * "dari|pada + basecamp|homebase|klinik|kantor|tempat + kami|kita|klinik + di"
 * atau "basecamp|homebase + kami|kita|klinik + berada|ada|berlokasi + di".
 * Gate berbasis KONTRAK TOOL turn ini (bukan pola kalimat user): hanya aktif
 * bila calculate_delivery sukses DAN get_clinic_policy_faq TIDAK terpanggil
 * (jawaban asal klinik yang sah selalu lewat policy tool — lihat
 * LOCATION_HIERARCHY_BLOCK langkah 2). Ditangani via kognisi re-prompt
 * (preseden D7), BUKAN mutilasi regex tengah kalimat.
 */
const ORIGIN_NARRATION_RE =
  /\b(dari|pada)\s+(basecamp|homebase|klinik|kantor|tempat)\s+(kami|kita|klinik)\s+di\b|\b(basecamp|homebase)\s+(kami|kita|klinik)\s+(berada|ada|berlokasi)\s+di\b/i;

function significantTokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length > 2 && !GENERIC_BOLD_WORDS.has(t));
}

function catalogNames(tools: ToolExec[]): string[] {
  const names: string[] = [];
  for (const t of tools) {
    if (t?.name === 'get_catalog_and_price' && Array.isArray(t?.result?.treatments)) {
      for (const tr of t.result.treatments) {
        if (typeof tr?.name === 'string' && tr.name.trim()) names.push(tr.name.trim().toLowerCase());
      }
    }
  }
  return names;
}

function catalogDurations(tools: ToolExec[]): number[] {
  const out: number[] = [];
  for (const t of tools) {
    if (t?.name === 'get_catalog_and_price' && Array.isArray(t?.result?.treatments)) {
      for (const tr of t.result.treatments) {
        const d = Number(tr?.durationMinutes);
        if (Number.isFinite(d) && d > 0) out.push(Math.round(d));
      }
    }
  }
  return out;
}

function toolCalled(tools: ToolExec[], name: string): boolean {
  return tools.some((t) => t?.name === name);
}

function knowledgeHasChunks(tools: ToolExec[]): boolean {
  return tools.some(
    (t) => t?.name === 'search_knowledge_faq' && Array.isArray(t?.result?.chunks) && t.result.chunks.length > 0
  );
}

function policyToolCalled(tools: ToolExec[]): boolean {
  return tools.some((t) => t?.name === 'get_clinic_policy_faq' && t?.result?.success !== false);
}

function hasSubstantiveChunks(chunks?: Array<{ content?: string; title?: string }>): boolean {
  return Array.isArray(chunks) && chunks.some((c) => !!(c?.content && c.content.trim().length > 20));
}

function mentionsVaccine(text: string): boolean {
  return /vaksin|imunisasi/i.test(text || '');
}

/** Ekspresi keagamaan yang dilarang muncul tanpa pemicu dari customer. */
const UNPROMPTED_RELIGIOUS_RE = /\b(alhamdulillah|bismillah|in?sh?[ay]+a+h?\s*allah|insyaallah|inshaallah|puji\s*tuhan)\b/i;
const CUSTOMER_RELIGIOUS_TRIGGER_RE = /\b(assalamu|alhamdulillah|bismillah|in?sh?[ay]+a+h?\s*allah|insyaallah|inshaallah|puji\s*tuhan)\b/i;

/** Rekomendasi obat farmasi kimia di luar wewenang spa — wajib rujuk dokter. */
const UNAUTHORIZED_MEDICATION_RE =
  /\b(paracetamol|parasetamol|ibuprofen|antibiotik|amoxicillin|amoksisilin|sanmol|pamol|tempra|proris|bufect)\b/i;

export function validateFactualClaims(
  replyText: string,
  executedTools: ToolExec[],
  _retrievedChunks?: Array<{ content?: string }>,
  opts?: FactualValidationOptions
): FactualValidationResult {
  const violations: string[] = [];
  const reply = replyText || '';
  if (!reply.trim()) return { isValid: true, violations: [] };

  // D5 — klaim efikasi absolut: selalu dilarang tanpa pengecualian data.
  if (ABSOLUTE_EFFICACY_RE.test(reply)) {
    violations.push('Klaim efikasi absolut ("menyembuhkan/dijamin/100%/tanpa efek samping") tanpa landasan data tool.');
  }

  // D2 — klaim vaksin wajib berlandaskan tool kebijakan klinik ATAU artikel
  // knowledge vaksin (search_knowledge_faq / pre-grounding retrievedChunks).
  const vaccineGrounded =
    toolCalled(executedTools, 'get_clinic_policy_faq') ||
    (Array.isArray(_retrievedChunks) &&
      _retrievedChunks.some((c: any) => mentionsVaccine(`${c?.title || ''} ${c?.content || ''}`))) ||
    executedTools.some(
      (t) =>
        t?.name === 'search_knowledge_faq' &&
        mentionsVaccine(JSON.stringify(t?.result || ''))
    );
  if (VACCINE_RE.test(reply) && !vaccineGrounded) {
    violations.push('Pembahasan vaksin/imunisasi tanpa landasan tool get_clinic_policy_faq atau artikel knowledge.');
  }

  // D7 — Netralitas Agama: asisten DILARANG memulai percakapan dengan kata
  // keagamaan ("Alhamdulillah", "Bismillah", "Insya Allah", "Puji Tuhan")
  // secara sepihak tanpa dipicu customer. Ditangani via kognisi (re-prompt),
  // BUKAN via mutilasi regex di tengah kalimat.
  const hasCustomerReligiousTrigger = !!opts?.customerInput && CUSTOMER_RELIGIOUS_TRIGGER_RE.test(opts.customerInput);
  if (!hasCustomerReligiousTrigger && UNPROMPTED_RELIGIOUS_RE.test(reply)) {
    violations.push('D7_UNPROMPTED_RELIGIOUS_PHRASE: Draf balasan memuat kata keagamaan sepihak tanpa dipicu customer. Jaga netralitas agama dan susun ulang kalimat secara profesional.');
  }

  // Obat farmasi kimia — spa DILARANG resep mandiri; wajib rujuk dokter.
  // Dikecualikan bila balasan adalah rujukan medis / penolakan resep.
  if (UNAUTHORIZED_MEDICATION_RE.test(reply) && !REFUSAL_FRAME_RE.test(reply) && !opts?.isRefusalOrEscalation) {
    violations.push('Rekomendasi obat farmasi kimia (paracetamol/ibuprofen/antibiotik) di luar wewenang homecare spa. Arahkan konsultasi ke dokter bila perlu obat.');
  }

  // D8 — narasi asal basecamp/homebase pada info ongkir (gate kontrak tool):
  // calculate_delivery sukses + policy tool TIDAK terpanggil + bingkai asal
  // generik → invalid (re-prompt kognitif di guardrail-pipeline). Jawaban asal
  // klinik yang sah (policy tool terpanggil) dan balasan tanpa delivery tool
  // dibebaskan — tanpa mencocokkan kalimat user.
  const deliverySucceeded = (executedTools || []).some(
    (t) => t?.name === 'calculate_delivery' && (t?.result as any)?.success === true
  );
  if (deliverySucceeded && !toolCalled(executedTools, 'get_clinic_policy_faq') && ORIGIN_NARRATION_RE.test(reply)) {
    violations.push('D8_ORIGIN_NARRATION: Draf balasan menyisipkan narasi asal ("dari basecamp/homebase/klinik kami di ...") padahal konteks turn ini adalah info jarak/ongkir dari calculate_delivery, bukan pertanyaan lokasi klinik. Tulis ulang HANYA dari data resmi tool (jarak km, ongkir promo, area jangkauan) tanpa menyebut asal/basecamp klinik.');
  }

  // D1 — nama layanan di-bold/dikutip wajib ada di katalog turn ini.
  const names = catalogNames(executedTools);
  if (names.length > 0) {
    const spans: string[] = [];
    const boldRe = /\*([^*]{2,60})\*/g;
    let m: RegExpExecArray | null;
    while ((m = boldRe.exec(reply)) !== null) spans.push(m[1].trim());
    const quoteRe = /"([^"]{2,60})"/g;
    while ((m = quoteRe.exec(reply)) !== null) spans.push(m[1].trim());
    for (const span of spans) {
      const lower = span.toLowerCase();
      if (!TREATMENT_MARKER_RE.test(span)) continue;
      if (GENERIC_BOLD_WORDS.has(lower)) continue;
      // Token-subset ketat: semua token signifikan span harus tercakup SATU
      // nama katalog (setelah buang kata generik). "Pijat Laktasi Premium"
      // vs katalog "Pijat Laktasi" → token "premium" tak tercakup → invalid.
      const spanTokens = significantTokens(span);
      const matched = names.some((n) => {
        const nameTokens = significantTokens(n);
        return spanTokens.length > 0 && spanTokens.every((t) => nameTokens.includes(t));
      });
      if (!matched) {
        violations.push(`Nama layanan "${span}" tidak ada di katalog turn ini.`);
      }
    }
  }

  // D4 — durasi tekstual wajib cocok dengan durasi katalog turn ini.
  const durations = catalogDurations(executedTools);
  if (durations.length > 0) {
    const minRe = /(\d+)\s*menit/gi;
    let dm: RegExpExecArray | null;
    while ((dm = minRe.exec(reply)) !== null) {
      const mins = Number(dm[1]);
      if (!durations.includes(mins)) {
        violations.push(`Durasi "${mins} menit" tidak cocok dengan katalog (${durations.join('/')}).`);
      }
    }
  }

  // D3 — anjuran SOP substantif wajib berlandaskan artikel knowledge ATAU
  // kebijakan klinik (get_clinic_policy_faq) ATAU pre-grounding retrievedChunks.
  // Penolakan sopan ("belum tersedia, diteruskan ke CS") dikecualikan.
  const hasSopGrounding =
    knowledgeHasChunks(executedTools) ||
    policyToolCalled(executedTools) ||
    hasSubstantiveChunks(_retrievedChunks);
  if (
    reply.length > 80 &&
    ADVISORY_RE.test(reply) &&
    !opts?.isRefusalOrEscalation &&
    !REFUSAL_FRAME_RE.test(reply) &&
    !hasSopGrounding
  ) {
    violations.push('Anjuran klinis/SOP tanpa landasan artikel knowledge atau kebijakan klinik.');
  }

  // D9 — Anti-Amnesia Lokasi: bila lokasi SUDAH diketahui, DILARANG menanyakan domisili lagi.
  if (opts?.locationKnown === true) {
    const ASKING_LOCATION_RE =
      /\b(rumah(?:nya)?\s+(?:bunda\s+)?di\s+(?:daerah|wilayah|kelurahan|kecamatan|mana)|daerah\s+mana\s+ya\s+bunda|lokasi(?:nya)?\s+di\s+mana|biar\s+sekalian\s+kami\s+pastikan\s+jangkauan|biar\s+sekalian\s+kami\s+bantu\s+cekkan\s+jangkauan)/i;
    if (ASKING_LOCATION_RE.test(reply) && !HOMEBASE_EXEMPT_RE.test(reply)) {
      violations.push('D9_LOCATION_AMNESIA: Lokasi sudah diketahui di sesi, DILARANG bertanya alamat/daerah lagi. Ganti dengan konfirmasi pengecekan jadwal atau tawaran perawatan.');
    }
  }

  // D6 — anti-halu domisili (kasus simulator 725870): bila sesi belum memuat
  // lokasi, draf DILARANG mengatribusikan kecamatan ke customer. Fakta homebase
  // klinik dikecualikan. Daftar kecamatan dari gazetteer runtime (data-driven).
  // Plan regresi Fase 1 (Sesi 580976, false positive): kecamatan yang disebut
  // customer di pesan turn ini ATAU dikembalikan tool calculate_delivery turn
  // ini adalah grounding sah — DILARANG dituduh halusinasi.
  if (opts?.locationKnown === false) {
    const dm = DOMICILE_ATTR_RE.exec(reply);
    const claimed = dm ? (dm[1] || dm[2] || dm[3] || '').trim().toLowerCase() : '';
    if (claimed && !HOMEBASE_EXEMPT_RE.test(reply)) {
      // Pengecualian Grounding Sah (data, bukan hafalan): customer atau tool.
      const isInputMentioned = !!opts?.customerInput && mentionsPhrase(opts.customerInput, claimed);
      const deliveryTool = (executedTools || []).find((t) => t?.name === 'calculate_delivery');
      const toolKecamatan = deliveryTool?.result?.kecamatan ? String(deliveryTool.result.kecamatan).toLowerCase() : '';
      const toolLocationText = typeof deliveryTool?.args?.locationText === 'string'
        ? deliveryTool.args.locationText.toLowerCase() : '';
      const isToolGrounded = (toolKecamatan && (claimed === toolKecamatan || mentionsPhrase(toolKecamatan, claimed) || mentionsPhrase(claimed, toolKecamatan)))
        || (toolLocationText && mentionsPhrase(toolLocationText, claimed));
      if (!isInputMentioned && !isToolGrounded) {
        let isRealKecamatan = false;
        try {
          const names: string[] = getGazetteerKecamatanNames() || [];
          isRealKecamatan = names.some(
            (n) => n && (claimed === n.toLowerCase() || claimed.includes(n.toLowerCase()))
          );
        } catch {}
        if (isRealKecamatan) {
          violations.push(`Domicile "${claimed}" disebut tanpa lokasi sesi — halusinasi slot kecamatan.`);
        }
      }
    }
  }

  return { isValid: violations.length === 0, violations };
}
