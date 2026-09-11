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

/** Bingkai penolakan/defleksi sopan ("belum tersedia, diteruskan ke CS") — aman, bukan anjuran. */
const REFUSAL_FRAME_RE =
  /belum\s+tersedia|tidak\s+tersedia|tidak\s+melayani|belum\s+ada|teruskan\s+ke|\bCS\b|admin/i;

/** Atribusi domisili kecamatan ke customer ("Area Kecamatan X", "rumah Bunda di X"). */
const DOMICILE_ATTR_RE =
  /area\s+kecamatan\s+([a-z][a-z\s]{2,40}?)(?:\s+ini|\s+masih|\s+adalah|[,.!?]|$)|rumah\s+(?:bunda|anda)\s+di\s+([a-z][a-z\s]{2,40}?)(?:[,.!?]|$)|lokasi\s+(?:bunda|anda)\s+di\s+([a-z][a-z\s]{2,40}?)(?:[,.!?]|$)/i;

/** Pengecualian: fakta homebase klinik sendiri ("homebase kami di X"). */
const HOMEBASE_EXEMPT_RE = /homebase\s+(kami|klinik)|klinik\s+kami\s+di/i;

export interface FactualValidationOptions {
  /** True bila sesi sudah memuat kelurahan/kecamatan customer. */
  locationKnown?: boolean;
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
    !REFUSAL_FRAME_RE.test(reply) &&
    !hasSopGrounding
  ) {
    violations.push('Anjuran klinis/SOP tanpa landasan artikel knowledge atau kebijakan klinik.');
  }

  // D6 — anti-halu domisili (kasus simulator 725870): bila sesi belum memuat
  // lokasi, draf DILARANG mengatribusikan kecamatan ke customer. Fakta homebase
  // klinik dikecualikan. Daftar kecamatan dari gazetteer runtime (data-driven).
  if (opts?.locationKnown === false) {
    const dm = DOMICILE_ATTR_RE.exec(reply);
    const claimed = dm ? (dm[1] || dm[2] || dm[3] || '').trim().toLowerCase() : '';
    if (claimed && !HOMEBASE_EXEMPT_RE.test(reply)) {
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

  return { isValid: violations.length === 0, violations };
}
