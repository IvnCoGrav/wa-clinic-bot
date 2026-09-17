/**
 * medical-signal-detector.ts (Fase 2 — dekomposisi context-grounder).
 *
 * Detektor sinyal medis & waktu deterministik (data-driven includes, 0 token,
 * tanpa I/O kecuali pelabelan internal DB yang fail-safe). Diekstrak verbatim
 * dari context-grounder.ts; context-grounder.ts kini mendelegasikan ke sini.
 */

export function hasScheduleSignal(text: string): boolean {
  // Aturan deterministik sendiri (data-driven includes) — SENGAJA tidak
  // downstream dari extractFastIntents agar presisi label imun terhadap
  // drift classifier. Audit 315036: "sekarang"/"hari ini" adalah tanya slot
  // hanya bila didampingi kata ketersediaan; bare "batuknya kambuh
  // sekarang" adalah keluhan (DILARANG dilabeli jadwal).
  const lower = (text || '').toLowerCase();
  if (!lower) return false;
  const hasAny = (words: string[]): boolean => words.some((w) => lower.includes(w));
  // Sinyal jadwal kuat (mandiri, tanpa verifikasi tambahan).
  if (hasAny(['jadwal', 'kapan', 'tanggal', 'slot', 'besok', 'lusa', 'minggu depan',
    'hari biasa', 'weekday', 'weekdays',
    'bisa hari apa', 'hari apa', 'masih kosong', 'bisa sekarang',
    'jam berapa', 'ready jam', 'bisa jam'])) {
    return true;
  }
  // Sinyal waktu-sekarang: valid hanya bila didampingi kata ketersediaan.
  if (hasAny(['sekarang', 'hari ini'])) {
    return hasAny(['bisa', 'apakah', 'ready', 'kosong', 'datang', 'jadwal', 'slot']);
  }
  const DAY_WORDS = ['senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu', 'minggu', 'weekend'];
  // Digit WAJIB dipertahankan agar guard "3 minggu" (usia) tetap bekerja —
  // hanya huruf non-alnum yang dijadikan pemisah token.
  let normalized = '';
  for (let i = 0; i < lower.length; i++) {
    const ch = lower[i];
    normalized += ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) ? ch : ' ';
  }
  const tokens = normalized.split(' ').filter((t) => t.length > 0);
  const isDigitStart = (t: string): boolean => {
    if (!t) return false;
    const c = t.charCodeAt(0);
    return c >= 48 && c <= 57;
  };
  // Sinyal jam (sesi 180166 FM3, gaya token — tanpa regex semantik):
  // penanda jam/pukul (+singkatan "sktr") yang diikuti angka dalam 2 token
  // ke depan ("Sktr jam 10 pagi", "pukul 14.00"). Sapaan "Selamat pagi"
  // (tanpa penanda+angka) DILARANG dihitung sebagai sinyal jadwal.
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === 'jam' || tok === 'pukul' || tok === 'sktr') {
      if (isDigitStart(tokens[i + 1] || '') || isDigitStart(tokens[i + 2] || '')) return true;
    }
  }
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!DAY_WORDS.includes(tok)) continue;
    if (tok === 'minggu' && i > 0 && isDigitStart(tokens[i - 1])) continue;
    return true;
  }
  return false;
}

/**
 * Ekstrak preferensi jam kunjungan (sesi 180166 FM3, anti-amnesia waktu):
 * "Sktr jam 10 pagi" → "jam 10 pagi"; "pukul 14.00" → "pukul 14.00".
 * Pindai karakter manual (tanpa regex): penanda jam/pukul + angka +
 * opsional periode pagi/siang/sore/malam. Null bila tak ada.
 */
export function extractTimeOfDayHint(text: string): string | null {
  const lower = (text || '').toLowerCase();
  if (!lower) return null;
  const PERIODS = ['pagi', 'siang', 'sore', 'malam'];
  for (const marker of ['jam', 'pukul']) {
    let idx = lower.indexOf(marker);
    while (idx >= 0) {
      let j = idx + marker.length;
      while (j < lower.length && lower[j] === ' ') j++;
      let num = '';
      while (j < lower.length && ((lower[j] >= '0' && lower[j] <= '9') || lower[j] === '.' || lower[j] === ':')) {
        num += lower[j] === ':' ? '.' : lower[j];
        j++;
      }
      if (num.length > 0) {
        let rest = lower.slice(j).trimStart();
        let period = '';
        for (const p of PERIODS) {
          if (rest === p || rest.startsWith(p + ' ') || rest.startsWith(p + ',') || rest.startsWith(p + '.')) {
            period = ` ${p}`;
            break;
          }
        }
        return `${marker} ${num}${period}`;
      }
      idx = lower.indexOf(marker, idx + 1);
    }
  }
  return null;
}

/**
 * Pelabelan internal "Tanya Jadwal" — 100% DATABASE (tabel labels &
 * customer_labels via Prisma), ZERO API call ke WAHA (Mandat Larangan
 * Menyentuh Label WAHA). Idempoten via upsert; gagal DB (offline/testing)
 * hanya warn, tidak pernah menggagalkan turn percakapan.
 */
export async function assignInternalScheduleLabel(
  conversationId: string,
  tenantId: string
): Promise<void> {
  try {
    const { prisma } = await import('../../../db/client');
    const conv = await prisma.conversation.findFirst({
      where: { id: conversationId, tenant_id: tenantId },
    });
    const custId = (conv as any)?.customer_id as string | undefined;
    if (!custId) return;
    const NAME = 'Tanya Jadwal';
    let label = await prisma.label.findFirst({ where: { tenant_id: tenantId, name: NAME } });
    if (!label) {
      label = await prisma.label.create({ data: { tenant_id: tenantId, name: NAME, color: '#10B981' } });
    }
    await prisma.customerLabel.upsert({
      where: { customer_id_label_id: { customer_id: custId, label_id: label.id } },
      create: { customer_id: custId, label_id: label.id },
      update: {},
    });
    console.log(JSON.stringify({ event: 'V3_INTERNAL_LABEL_ASSIGNED', tenantId, conversationId, label: NAME, timestamp: new Date().toISOString() }));
  } catch (e: any) {
    console.warn(JSON.stringify({ event: 'V3_INTERNAL_LABEL_SKIP', tenantId, conversationId, error: e?.message || 'db offline', timestamp: new Date().toISOString() }));
  }
}

/**
 * Sinyal trauma jatuh/terbentur bayi (deterministik, data-driven includes)
 * untuk clinical-safety routing Call 1 (audit 337101). 'bentur' generik
 * hanya dihitung bila berkonteks bayi/jatuh (menghindari "kebentur meja
 * kantor" dewasa yang tak terkait pasien anak — tetap butuh kata bayi).
 */
export function hasFallInjurySignal(text: string): boolean {
  const lower = (text || '').toLowerCase();
  if (!lower) return false;
  const hasAny = (words: string[]): boolean => words.some((w) => lower.includes(w));
  if (hasAny(['jatuh', 'jatoh', 'terbentur', 'kebentur', 'kejedot', 'habis jatuh', 'baru jatuh'])) return true;
  return lower.includes('bentur')
    && hasAny(['bayi', 'baby', 'newborn', 'anak', 'si kecil', 'adik']);
}

/**
 * Ekstrak petunjuk waktu yang diminta customer (audit 337101 + Fase 6 K1):
 * token waktu deterministik (sekarang/hari ini/besok/lusa/nama hari) untuk
 * dicatat sebagai booking.requestedTimeHint — anti pengulangan tanya hari.
 * Koreksi-dulu: penanda koreksi (ganti/tapi/...) dimenangkan token TERAKHIR;
 * kolokasi "besok lusa" = lusa; tanpa penanda = first-wins; "3 minggu"
 * (usia) DILARANG dihitung sebagai hari Minggu. Null bila tidak ada.
 */
export function extractTimeHint(text: string): string | null {
  const lower = (text || '').toLowerCase();
  if (!lower) return null;
  if (lower.includes('minggu depan')) return 'minggu depan';
  if (lower.includes('hari biasa')) return 'hari biasa';
  if (lower.includes('weekdays')) return 'weekday';
  if (lower.includes('weekday')) return 'weekday';
  if (lower.includes('hari ini')) return 'hari ini';
  // Kolokasi "besok lusa" = lusa (satu leksem, bukan dua hari).
  if (lower.includes('besok lusa')) return 'lusa';
  let norm = '';
  for (let i = 0; i < lower.length; i++) {
    const ch = lower[i];
    norm += ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) ? ch : ' ';
  }
  const tokens = norm.split(' ').filter((t) => t.length > 0);
  const HINTS = ['sekarang', 'besok', 'lusa', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu', 'minggu', 'weekend', 'weekday'];
  const tokenSet = new Set(tokens);
  const hasCorrection = ['ganti', 'tapi', 'melainkan', 'rubah', 'ubah', 'koreksi', 'malah', 'tepatnya', 'bukan']
    .some((w) => tokenSet.has(w));
  const valid: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (HINTS.includes(t)) {
      if (t === 'minggu') {
        if (i > 0) {
          const c = tokens[i - 1].charCodeAt(0);
          if (c >= 48 && c <= 57) continue; // "3 minggu" = usia, bukan hari
        }
      }
      valid.push(t);
    }
  }
  if (valid.length === 0) return null;
  return hasCorrection ? valid[valid.length - 1] : valid[0];
}

/**
 * Sinyal imunisasi/vaksinasi (deterministik, data-driven includes) untuk
 * clinical-safety routing Call 1. 'suntik' generik hanya dihitung bila
 * berkonteks bayi/vaksin (menghindari "suntik KB" dewasa memicu SOP bayi).
 */
export function hasVaccineSignal(text: string): boolean {
  const lower = (text || '').toLowerCase();
  if (!lower) return false;
  const hasAny = (words: string[]): boolean => words.some((w) => lower.includes(w));
  if (hasAny(['vaksin', 'vaksinasi', 'imunisasi', 'kipi', 'bcg', 'polio', 'dpt'])) return true;
  return lower.includes('suntik')
    && hasAny(['bayi', 'baby', 'newborn', 'anak', 'imunisasi', 'vaksin']);
}

/**
 * Penentu pesan substantif untuk Hybrid RAG pre-retrieval (deterministik, 0 token).
 * Data-driven includes (tanpa regex intent gatekeeper): keluhan, perbedaan layanan,
 * syarat usia/SOP, kehamilan/induksi. Sapaan/harga murni/ongkir/jadwal dikecualikan
 * agar tidak membebani FTS.
 */
export function isSubstantiveForPreGrounding(text: string): boolean {
  const lower = (text || '').toLowerCase();
  if (!lower || lower.trim().length < 8) return false;
  // Sapaan murni tidak perlu grounding
  const greetingOnly = ['halo', 'hallo', 'hai', 'pagi', 'siang', 'sore', 'malam', 'assalamualaikum', 'permisi', 'tes', 'test', 'oke', 'ok', 'siap', 'makasih', 'terima kasih'];
  const tokens = lower.split(' ').filter((t) => t.length > 0);
  if (tokens.length <= 3 && greetingOnly.some((g) => lower.includes(g))) return false;
  const substantiveSignals = [
    // Keluhan fisik ibu & anak
    'sakit', 'nyeri', 'pegal', 'capek', 'lelah', 'bengkak', 'kembung', 'kolik', 'batuk', 'pilek', 'bapil',
    'flu', 'demam', 'rewel', 'grok', 'diare', 'gtm', 'susah makan', 'susah tidur', 'kontraksi', 'mual',
    'pusing', 'asi', 'laktasi', 'menyusui',
    // Perbedaan / pemilihan layanan
    'beda', 'perbedaan', 'pilih', 'rekomendasi', 'cocok', 'bagus', 'mending', 'sebaiknya',
    // Syarat usia / SOP klinik
    'usia', 'umur', 'bulan', 'tahun', 'minggu', 'week', 'boleh', 'aman', 'syarat', 'minimal',
    'mandi', 'susu', 'minyak', 'telon', 'balsem', 'cukur', 'gundul', 'tumbuh gigi', 'vaksin',
    // Audit 222655: varian slang imunisasi WAJIB memicu pre-grounding
    // ("habis imunisasi apa sebelum e" tidak mengandung kata "vaksin").
    'vaksinasi', 'imunisasi', 'suntik', 'kipi', 'bcg', 'polio', 'dpt',
    // Audit 337101: trauma jatuh WAJIB pre-grounding SOP skrining
    // (mencegah tercatutnya artikel mandi/relaksasi untuk kasus trauma).
    'jatuh', 'jatoh', 'terbentur', 'kebentur', 'kejedot', 'bentur', 'benjol', 'memar',
    'fisioterapi', 'newborn', 'hamil', 'kehamilan', 'nifas', 'induksi', 'oksitosin', 'prenatal',
    'perineum', 'kontraksi', 'pembukaan', 'hpl',
    // Penjelasan terapi / khasiat
    'fungsi', 'manfaat', 'khasiat', 'cara kerja', 'gimana', 'bagaimana', 'maksudnya', 'seperti apa',
    'treatment', 'terapi', 'moksa', 'inframerah', 'laktasi', 'pijat',
  ];
  return substantiveSignals.some((s) => lower.includes(s));
}
