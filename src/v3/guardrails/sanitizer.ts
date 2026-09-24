import { getMaxCharsPerReply } from '../../config/persona';

export class OutputSanitizer {
  /** Plafon default tenant-aware (sesi 381894): umum 1200, konteks katalog/keranjang 1500. */
  public static readonly DEFAULT_MAX_CHARS = 1200;
  public static readonly CATALOG_MAX_CHARS = 1500;

  /**
   * Fixing D1/Fase 3 (sesi 767713): hapus kalimat defleksi "cek ke tim" yang
   * muncul saat AI ragu. HANYA kalimat yang SELURUHNYA berisi defleksi yang
   * dibuang; kalimat dengan substansi (jawaban/manfaat/jadwal) dipertahankan.
   * Deterministik, level kalimat (anti-mutilasi kata).
   */
  public static stripVagueTeamDeferral(text: string): string {
    if (!text || typeof text !== 'string') return text;
    // Frasa defleksi keraguan (bukan klaim jadwal normal).
    const DEFERRAL = /(cek|konfirmasi|tanyakan|pastikan)\s+(dulu\s+)?(ke|kepada|sama|dengan)?\s*(tim|team|admin|rekan)\b|informasinya akan kami cek|akan kami cekkan ke tim|belum bisa kami pastikan|nanti kami cek dulu/i;
    // Jangan sentuh kalimat yang memang soal JADWAL (itu sah: "kami cekkan ketersediaan jadwal").
    const SCHEDULE = /jadwal|slot|ketersediaan|hari|tanggal|kedatangan/i;
    // Pertahankan STRUKTUR baris (jangan gabung dengan spasi) agar sanitizer
    // hilir yang bergantung pada pemisah paragraf tetap bekerja.
    const lines = text.split('\n');
    const keptLines = lines.map((line) => {
      if (!line.trim()) return line;
      const parts = line.split(/(?<=[.!?])\s+/);
      const kept = parts.filter((s) => {
        if (!DEFERRAL.test(s)) return true;
        if (SCHEDULE.test(s)) return true;
        return false;
      });
      return kept.join(' ').trim();
    });
    const out = keptLines.join('\n').replace(/[ \t]{2,}/g, ' ').trim();
    return out.length > 0 ? out : text;
  }

  /**
   * Pembersih artefak placeholder sistem (audit 310995): buang salinan token
   * template bertanda kurung siku yang dipakai di PROMPT (bukan bahasa
   * customer), mis. "*Rp [Total]*", "[Harga]", "[OngkirPromo]", "[jarak]".
   * Pola 1 menangani bentuk nominal ber-placeholder; pola 2 menangani token
   * sistem telanjang. Tanpa memotong kata/angka nyata di tengah kalimat.
   */
  public static stripSystemPlaceholders(text: string): string {
    if (!text) return text;
    if (!/\[(?:total|harga|ongkir|promo|normal|promoongkir|ongkirpromo|nominal|nama treatment|kelurahan|jarak|kecamatan|normalprice|promoprice|durasi|x)\]/i.test(text)) {
      return text; // fast-path: tak ada artefak → teks tak disentuh (anti-mutilasi)
    }
    return text
      // "*Rp [Total]*" / "Rp [total]" / "*Rp[Harga]*" (+ kata sambung "totalnya jadi")
      .replace(/(?:totalnya\s*(?:men)?jadi\s*)?\*?\s*Rp\s*\[(?:total|harga|ongkir|promo|normal|promoongkir|ongkirpromo|nominal)\]\s*\*?/gi, ' ')
      // Token sistem telanjang: [Total], [Harga], [Nama Treatment], [Kelurahan], [jarak], dll.
      .replace(/\[(?:total|harga|ongkir|promo|normal|promoongkir|ongkirpromo|nominal|nama treatment|kelurahan|jarak|kecamatan|normalprice|promoprice|durasi|x)\]/gi, ' ')
      // Hanya rapikan spasi IN-LINE (bukan newline) & pemisah menggantung.
      .replace(/[^\S\r\n]{2,}/g, ' ')
      .replace(/[^\S\r\n]+([,.!?])/g, '$1')
      .replace(/[^\S\r\n]+$/gm, '')
      .trim();
  }

  /**
   * Membersihkan tag thinking, monolog internal, dan artefak AI dari balasan sebelum dikirim ke WhatsApp.
   * Plafon karakter tenant-aware: opts.maxChars eksplisit > TenantPersona.max_chars_per_reply (DB)
   * > default konteks-sadar (1500 katalog / 1200 umum). Param ke-4 number tetap didukung
   * demi kompatibilitas pemanggil lama.
   */
  public static cleanOutboundReply(
    rawText: string,
    customerInput?: string,
    isFollowUp: boolean = false,
    maxCharsOrOpts?: number | { tenantId?: string; maxChars?: number; isCatalogContext?: boolean }
  ): string {
    if (!rawText || typeof rawText !== 'string') return '';

    let text = rawText;

    // 0a. Fixing D1/Fase 3 (sesi 767713): buang kalimat "melempar ke tim" yang
    // dihasilkan AI saat ragu (bukan konteks jadwal). Deterministik, level
    // kalimat — hanya kalimat defleksi murni yang dibuang; kalimat valid tetap.
    text = OutputSanitizer.stripVagueTeamDeferral(text);

    // 0. Anti-bocor placeholder sistem (audit 310995): LLM dilarang menyalin
    // token template bertanda kurung siku (mis. "*Rp [total]*", "[Harga]")
    // ke balasan customer. Kendali gaya deterministik post-generasi.
    text = OutputSanitizer.stripSystemPlaceholders(text);

    // 1. Hapus tag <think>...</think> dan [THINKING]...[/THINKING]
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
    text = text.replace(/\[THINKING\][\s\S]*?\[\/THINKING\]/gi, '');

    // 1b. Hapus artefak native tool-calling LLM (DeepSeek DSML, XML tool
    // call, result tags — audit DeepSeek Flash): model via gateway
    // OpenAI-compatible kadang memuntahkan format tool XML ke properti teks
    // `content`. Pembersihan teknis mesin non-semantik — tak menyentuh kata
    // bahasa alami customer (mis. kata "result" tanpa kurung siku lolos).
    //
    // Plan Fase 4 revisi (sesi 89-turn, log llm-2026-09-21): pola riil model
    // adalah `<\u009C\u009CDSML\u009C\u009D ...` — pembungkus tag = KARAKTER
    // KONTROL C1 (U+009C/U+009D) atau pipe fullwidth (｜), slash penutup DI
    // ANTARA wrapper chars. Regex lama `<｜｜DSML｜｜` tidak pernah match.
    //
    // KONTRAK (trim-from-first, KHUSUS DSML): Draf Call 2 yang memuat artefak
    // native tool-call DSML dianggap DRAF KORUP — seluruh konten dari artefak
    // DSML pertama sampai akhir dibuang; hanya teks natural SEBELUM artefak
    // yang dipertahankan. Sisa yang jadi kosong dipulihkan recovery grounded
    // di guardrail-pipeline (CATALOG/DELIVERY_RECOVERY). Teks SETELAH artefak
    // TIDAK dijamin — sanitizer tak bisa membedakan kalimat natural vs
    // fragmen mesin (anti-hasil-parsial-menyesatkan).
    //
    // <result>/<tool_call> berperilaku LAIN: tag XML berpasangan rapi →
    // hapus TAG-nya saja (pasangan), teks di sekitarnya tetap sah.
    const DSML_RE = /<[^\w\s]{0,4}\/?[^\w\s]{0,4}DSML[^\w\s]{0,4}/i;
    const dsmlMatch = text.match(DSML_RE);
    if (dsmlMatch && dsmlMatch.index != null) {
      text = text.slice(0, dsmlMatch.index);
    }
    text = text.replace(/<result>[\s\S]*?<\/result>/gi, '');
    text = text.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '');
    text = text.replace(/<\/?(?:calls|invoke|parameter|name|args)[^>]*>/gi, '');

    // 2. Hapus blok kode markdown jika model membungkus balasan dengan ```
    text = text.replace(/^```(?:markdown|text)?\s*/i, '').replace(/\s*```$/i, '');

    // 3. Hapus pola monolog internal bahasa Indonesia (AI self-talk)
    const monologuePatterns = [
      /^(?:Kita|Saya|Mari\s+kita)\s+perlu\s+(?:menyusun|merespons|menjawab|membalas|memperhatikan)[\s\S]*?(?=\n\n|Halo|Hai|Pagi|Siang|Sore|Malam|Bunda|Bapak|$)/i,
      /^(?:Konteks|Analisis|Instruksi|Aturan|Catatan|Perhatikan\s+aturan)\s*:[\s\S]*?(?=\n\n|Halo|Hai|Pagi|Siang|Sore|Malam|Bunda|Bapak|$)/i,
      /^(?:Lihat\s+contoh|Dalam\s+peran\s+sebagai|Etika\s+roleplay|Sebagai\s+Bidan\s+Yusi,\s*saya\s+akan\s+menjawab\s*:)[\s\S]*?(?=\n\n|Halo|Hai|Pagi|Siang|Sore|Malam|Bunda|Bapak|$)/i,
    ];

    for (const pattern of monologuePatterns) {
      text = text.replace(pattern, '').trim();
    }

    // 3b. Reparasi artefak ragu/keceplosan model (deterministik — Mandat #3:
    //     kendali gaya via kode, bukan kepatuhan prompt). Pola struktural
    //     fragmen + "..." + filler koreksi (eh/euh/anu) + koma opsional.
    text = OutputSanitizer.sanitizeHesitationArtifacts(text);

    // 4. Aturan Enter Setelah Emot: Hapus titik setelah emot & sisipkan \n\n jika diikuti kalimat baru
    text = text.replace(/([\p{Extended_Pictographic}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]+)\s*\./gu, '$1');
    text = text.replace(/(?<!^)(?<!\n)([\p{Extended_Pictographic}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]+)\s+([A-Z*#0-9])/gu, '$1\n\n$2');

    // 5. Pastikan semua format nominal harga dibungkus bintang tunggal (*Rp 10.000*)
    text = text.replace(/(?<!\*)\b(Rp\s*\d{1,3}(?:\.\d{3})*(?:,\d+)?)\b(?!\*)/g, '*$1*');

    // 6. Normalisasi spasi dan baris baru berlebih (sesi 381894: blank-line
    // ber-spasi "\n   \n" diserap menjadi "\n\n" agar hitung batas paragraf benar)
    text = text.replace(/\n[ \t]+\n/g, '\n\n').replace(/\n{3,}/g, '\n\n').trim();

    // 7. Guardrail minimal (Mandat Minimal-Regex Phase 4):
    // - stripEnglishLeakage & sanitizeFirstPersonPronoun DIHAPUS — sudah ditangani
    //   via Positive Few-Shot Exemplars + prompt persona DB (Phase 1 & 3.2)
    // - Hanya pertahankan sanitizer non-mutilasi: STR mention & followUp greeting minimal
    text = OutputSanitizer.sanitizeUnpromptedStrMention(text, customerInput);
    text = OutputSanitizer.sanitizeFollowUpGreetingRepetition(text, isFollowUp);
    // Rule 6 (anti-overuse "Bunda"): chat pembuka maksimal 2x; chat lanjutan
    // maksimal 1x (sudah via sanitizeFollowUpGreetingRepetition). Deterministik
    // di pipeline output, bukan mengandalkan kepatuhan teks prompt.
    if (!isFollowUp) {
      text = OutputSanitizer.limitVocativeQuotaForTurn(text, false);
    }
    text = OutputSanitizer.truncateToMaxChars(text, OutputSanitizer.resolveMaxChars(maxCharsOrOpts));
    text = text.replace(/[^\S\r\n]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

    return text;
  }

  /**
   * Fallback deterministik: ubah sebutan "Bidan ber-STR aktif" menjadi
   * "Bidan kami", KECUALI customer eksplisit menanyakan kualifikasi bidan.
   */
  public static sanitizeUnpromptedStrMention(text: string, customerInput?: string): string {
    if (!text) return text;
    const isAskingQualification = !!customerInput && /(sertifikat|STR\b|legalitas|surat\s+tanda\s+registrasi|bidan\s+asli|terapis|yang\s+(menangani|mijat|mijit|nanganin|datang)|ditangani\s+(oleh\s+)?siapa|petugasnya)/i.test(customerInput);
    if (isAskingQualification) return text;
    return text
      .replace(/\boleh\s+Bidan\s+ber-STR\s+aktif\b/gi, 'oleh Bidan kami')
      .replace(/\bBidan\s+ber-STR\s+aktif\b/gi, 'Bidan kami');
  }

  /**
   * Resolusi plafon karakter tenant-aware (sesi 381894, keputusan user 1200/1500):
   * maxChars eksplisit > TenantPersona.max_chars_per_reply (DB, via getMaxCharsPerReply)
   * > default konteks-sadar (1500 katalog / 1200 umum). DB null/tak terbaca → default.
   */
  public static resolveMaxChars(
    maxCharsOrOpts?: number | { tenantId?: string; maxChars?: number; isCatalogContext?: boolean }
  ): number {
    if (typeof maxCharsOrOpts === 'number' && maxCharsOrOpts > 0) return maxCharsOrOpts;
    const opts = (typeof maxCharsOrOpts === 'object' && maxCharsOrOpts) ? maxCharsOrOpts : {};
    if (opts.maxChars && opts.maxChars > 0) return opts.maxChars;
    if (opts.tenantId) {
      try {
        const dbVal = getMaxCharsPerReply(opts.tenantId);
        if (typeof dbVal === 'number' && dbVal > 0) return dbVal;
      } catch (_) {
        // DB/cache belum termuat → jatuh ke default konteks-sadar di bawah.
      }
    }
    return opts.isCatalogContext ? OutputSanitizer.CATALOG_MAX_CHARS : OutputSanitizer.DEFAULT_MAX_CHARS;
  }

  /**
   * Hanging-header detector (sesi 381894): kandidat potongan yang berakhiran titik
   * dua, tanda hubung, kata sambung, atau frasa pengantar daftar DILARANG dipakai
   * sebagai titik potong (meninggalkan kalimat menggantung seperti
   * "Untuk treatment, ada beberapa pilihan menarik untuk si kecil:").
   */
  private static isHangingEnding(candidate: string): boolean {
    const t = (candidate || '').trimEnd();
    if (!t) return true;
    if (/[:\-–—]$/.test(t)) return true;
    if (/\b(dan|atau|yang|untuk|dengan|adalah|yaitu|yakni|seperti|antara)$/i.test(t)) return true;
    if (/(untuk si kecil|berikut rincian|pilihan treatment|pilihan menarik|pilihan (lainnya|paket)|daftar (harga|paket)|pricelist|rinciannya|pilihannya apa)\s*:?\s*$/i.test(t)) return true;
    return false;
  }

  /**
   * Akhir item daftar bernomor terakhir yang lengkap sebelum batas: cari start item
   * bernomor terakhir ("\n1. ", "\n2. ", ...) lalu kembalikan indeks akhir kalimat
   * (./!? atau emoji penutup) pertama setelahnya. Null bila tak ada.
   */
  private static findLastCompleteListItemEnd(rawSlice: string): number {
    const startRe = /\n\s*\d+\.\s/g;
    let m: RegExpExecArray | null;
    let lastStart = -1;
    while ((m = startRe.exec(rawSlice)) !== null) {
      lastStart = m.index;
    }
    if (lastStart < 0) return -1;
    const tail = rawSlice.slice(lastStart);
    const punctRe = /[.!?]/g;
    let pm: RegExpExecArray | null;
    let endRel = -1;
    while ((pm = punctRe.exec(tail)) !== null) {
      const idx = pm.index;
      const ch = pm[0];
      if (ch === '.') {
        const prev = idx > 0 ? tail[idx - 1] : '';
        const next = idx + 1 < tail.length ? tail[idx + 1] : '';
        const prevIsLetter = /[a-zA-Z\u00C0-\u024F]/.test(prev);
        const nextIsBoundary = next === '' || next === ' ' || next === '\n' || next === '\r' || next === '\t';
        if (!prevIsLetter || !nextIsBoundary) continue;
      }
      endRel = idx;
    }
    if (endRel > 0) return lastStart + endRel;
    const emojiRe = /[\p{Extended_Pictographic}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]+(?=\s|\n|$)/gu;
    let em: RegExpExecArray | null;
    let emojiEnd = -1;
    while ((em = emojiRe.exec(tail)) !== null) {
      emojiEnd = lastStart + em.index + em[0].length - 1;
    }
    return emojiEnd;
  }

  /**
   * Memotong teks secara elegan di batas kalimat terakhir sebelum maxChars
   * (default 1200; konteks katalog 1500 — Tie-break tenant-aware via resolveMaxChars).
   * Prioritas: 1) batas paragraf (toleran blank-line ber-spasi, anti hanging-header),
   * 2) akhir item daftar bernomor lengkap, 3) akhir kalimat (./!? atau emoji), 4) spasi.
   */
  public static truncateToMaxChars(text: string, maxChars: number = 1200): string {
    if (!text || text.length <= maxChars) return text;
    const rawSlice = text.slice(0, maxChars);
    // 1. Prioritas Utama: pemisah paragraf ganda terdekat (toleran "\n   \n").
    // Kumpulkan semua break, iterasi dari terakhir; tolak yang hanging.
    const breakRe = /\n\s*\n/g;
    const breaks: number[] = [];
    let bm: RegExpExecArray | null;
    while ((bm = breakRe.exec(rawSlice)) !== null) {
      breaks.push(bm.index);
    }
    let hangingSeen = false;
    for (let i = breaks.length - 1; i >= 0; i--) {
      const idx = breaks[i];
      if (idx <= 100) continue;
      const candidate = rawSlice.slice(0, idx).trimEnd();
      if (OutputSanitizer.isHangingEnding(candidate)) {
        hangingSeen = true;
        continue;
      }
      return candidate;
    }
    // 1b. Bila break terakhir menggantung di kepala daftar bernomor (sesi 381894),
    // jangan mundur ke pra-header (membuang seluruh katalog) — potong di akhir
    // item bernomor lengkap terakhir sebagai gantinya.
    if (hangingSeen && /\n\s*\d+\.\s/.test(rawSlice)) {
      const itemEnd = OutputSanitizer.findLastCompleteListItemEnd(rawSlice);
      if (itemEnd > 100) {
        return rawSlice.slice(0, itemEnd + 1).trimEnd();
      }
    }
    // 2. Prioritas Kedua: cari akhir kalimat valid (./!? ATAU emoji penutup diikuti spasi/newline)
    let lastSentenceEnd = -1;
    const punctRe = /[.!?]/g;
    let m: RegExpExecArray | null;
    while ((m = punctRe.exec(rawSlice)) !== null) {
      const idx = m.index;
      const ch = m[0];
      if (ch === '.') {
        const prev = idx > 0 ? rawSlice[idx - 1] : '';
        const next = idx + 1 < rawSlice.length ? rawSlice[idx + 1] : '';
        const nextIsBoundary = next === '' || next === ' ' || next === '\n' || next === '\r' || next === '\t';
        const isDecimal = /\d/.test(prev) && /\d/.test(next);
        const lineStart = rawSlice.lastIndexOf('\n', idx - 1) + 1;
        const beforeLine = rawSlice.slice(lineStart, idx);
        const isListNumber = /^\s*\d+$/.test(beforeLine) && next === ' ';
        const prevIsWordEnd = /[a-zA-Z\u00C0-\u024F0-9)\]*"'’”]/.test(prev);
        if (!prevIsWordEnd || !nextIsBoundary || isDecimal || isListNumber) continue;
      }
      lastSentenceEnd = idx;
    }
    // Emoji penutup sebagai batas kalimat (mis. "Bunda 😊\n\nApakah...")
    const emojiRe = /[\p{Extended_Pictographic}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]+(?=\s|\n|$)/gu;
    let em: RegExpExecArray | null;
    while ((em = emojiRe.exec(rawSlice)) !== null) {
      const endIdx = em.index + em[0].length - 1;
      if (endIdx > lastSentenceEnd) lastSentenceEnd = endIdx;
    }
    if (lastSentenceEnd > 0) {
      return rawSlice.slice(0, lastSentenceEnd + 1).trimEnd();
    }
    // 3. Fallback: potong di spasi terakhir agar tidak memutus kata di tengah
    const lastSpace = rawSlice.lastIndexOf(' ');
    if (lastSpace > 0) {
      return rawSlice.slice(0, lastSpace).trimEnd();
    }
    return rawSlice.trimEnd();
  }

  /**
   * Menghilangkan sisa-sisa istilah bahasa Inggris.
   *
   * @deprecated Dikeluarkan dari pipeline cleanOutboundReply (ditangani via
   * Few-Shot Exemplars + prompt persona). Dipertahankan sebagai wrapper publik
   * karena dicakup unit test (v3-persona-rules.test.ts) & impor historis.
   */
  public static stripEnglishLeakage(text: string): string {
    if (!text) return '';
    return text
      .replace(/\s*\(full\s+body\s+massage[^)]*\)/gi, '')
      .replace(/\bfull\s+body\s+massage(\s+bayi)?\b/gi, 'pijat seluruh badan')
      .replace(/\bhomecare\s+treatment\b/gi, 'layanan Homecare')
      .replace(/\bappointment(-nya)?\b/gi, 'jadwal reservasi')
      .replace(/\bschedule(-nya)?\b/gi, 'jadwal')
      .replace(/\blittle\s+one\b/gi, 'si kecil')
      .replace(/\bmommy\b/gi, 'Bunda');
  }

  /**
   * Mengoreksi penggunaan kata ganti klinik (saya/aku → kami).
   * Catatan: grup verba dibuat capturing agar 'kami $1' menyimpan kata kerja,
   * bukan literal "$1" (grup non-capturing tidak mengisi $1).
   *
   * @deprecated Dikeluarkan dari pipeline cleanOutboundReply (ditangani via
   * Few-Shot Exemplars + prompt persona). Dipertahankan sebagai wrapper publik
   * karena dicakup unit test (v3-persona-rules.test.ts) & impor historis.
   */
  public static sanitizeFirstPersonPronoun(text: string): string {
    if (!text) return '';
    // Ganti "Ada yang bisa saya bantu" -> "Ada yang bisa kami bantu"
    // Ganti "saya sarankan" -> "kami sarankan"
    return text
      .replace(/\bAda\s+yang\s+bisa\s+saya\s+bantu\b/gi, 'Ada yang bisa kami bantu')
      .replace(/\b(?:saya|aku)\s+(bantu|sarankan|cekkan|rekomendasikan)\b/gi, 'kami $1');
  }

  /**
   * Butir 8 — Reparasi artefak ragu/keceplosan (deterministik, struktural):
   * fragmen kata + elipsis + filler koreksi ("... eh,") dihapus beserta
   * fragmennya ("jadi insyaa... eh, kami bantu" → "jadi kami bantu").
   * Pola STRUKTURAL (bukan hafalan kalimat): berlaku untuk kata apa pun.
   * Non-mutilasi: hanya menyentuh fragmen+filler, kalimat sekitar utuh.
   */
  public static sanitizeHesitationArtifacts(text: string): string {
    if (!text) return text;
    let out = text;
    // Fragmen + "..." + filler koreksi (eh/euh/anu) + koma opsional → buang
    out = out.replace(/(\S+)\s*\.\.\.\s*(?:eh|euh|anu|itu)\s*,?\s*/gi, '');
    // Sisa elipsis ganda akibat penghapusan → rapikan spasi in-line ganda (pertahankan newline)
    out = out.replace(/[^\S\r\n]{2,}/g, ' ');
    return out;
  }

  /**
   * Multi-turn anti-repetition guardrail (Phase 4 minimal):
   * HANYA memotong sapaan duplikat bila pesan terdiri dari >=2 paragraf
   * dan paragraf pertama murni sapaan pembuka Turn-0 (bukan regex global).
   * Menangani kasus emot memecah "Halo Bunda! ✨ Terima kasih..." menjadi 2 paragraf.
   */
  public static sanitizeFollowUpGreetingRepetition(text: string, isFollowUp: boolean = false): string {
    if (!text || !isFollowUp) return text;
    let result = text;
    const paragraphs = text.split(/\n\s*\n/);
    if (paragraphs.length >= 2) {
      const isGreetingPara = (p: string): boolean => {
        const t = p.trim().toLowerCase();
        return (
          /^(halo|hai|hei|hey)\s+(bunda|bun|kak|min)\b/.test(t) ||
          /^selamat\s+(pagi|siang|sore|malam)\b/.test(t) ||
          /^terima\s+kasih\s+sudah\s+menghubungi/.test(t) ||
          /^perkenalkan,\s+saya\s+bidan\s+yusi/.test(t)
        );
      };
      // Hapus berurutan semua paragraf awal yang murni sapaan (handle emot split)
      let cut = 0;
      while (cut < paragraphs.length - 1 && isGreetingPara(paragraphs[cut])) {
        cut++;
      }
      if (cut > 0) result = paragraphs.slice(cut).join('\n\n').trim();
    }
    return OutputSanitizer.limitVocativeQuota(result);
  }

  /**
   * Kuota sapaan Turn-0: HANYA membatasi bila jumlah kemunculan melebihi
   * kuota (default 2 untuk chat pembuka). Chat lanjutan tetap memakai
   * limitVocativeQuota(1) via sanitizeFollowUpGreetingRepetition.
   */
  public static limitVocativeQuotaForTurn(text: string, isFollowUp: boolean): string {
    if (!text) return text;
    return OutputSanitizer.limitVocativeQuota(text, isFollowUp ? 1 : 2);
  }

  /**
   * Kuota sapaan vokatif deterministik (audit 993955 Turn 9 + 391501 Fase 1):
   * panggilan "Bunda"/"Bapak" maksimal 1x di chat lanjutan. Pertahankan
   * kemunculan PERTAMA; pengulangan sesudahnya dibersihkan rapi tanpa
   * memutilasi kata di tengah kalimat. Proteksi subjek tata bahasa
   * (sesi 391501): "Bunda" di awal kalimat/klausa yang diikuti verba/modal
   * (hanya/cukup/bisa/perlu/dapat/mau/ingin/sudah/belum/tidak/harus/tinggal)
   * adalah subjek, BUKAN vokatif — tidak dihitung kuota & tidak dihapus.
   */
  public static limitVocativeQuota(text: string, quota: number = 1): string {
    // Varian vokatif yang dihitung sebagai SATU kuota: "Bunda", "Bapak", dan
    // singkatan akrab "bund"/"bun" (audit Rule 6: "Bunda ... bund" = 2x panggilan).
    const pattern = /\b(Bunda|Bapak|bund|bun)\b/gi;
    // Verba/modal yang menandai subjek tata bahasa (391501).
    const SUBJECT_FOLLOW_RE = /^(?:hanya|cukup|bisa|perlu|dapat|mau|ingin|sudah|belum|tidak|harus|tinggal)\b/i;
    // Preposisi Indonesia (Fase 5, anti-mutilasi): kata sapaan yang DIdahului
    // preposisi berperan sebagai OBJEK PREPOSISI ("untuk Bunda", "ke Bunda",
    // "dari Bunda"), BUKAN panggilan vokatif — DILARANG dihapus / dihitung kuota.
    //
    // Zero-Dangling Rule (Fase 4, anti-mutilasi semantik): konjungsi koordinatif
    // ("dan", "atau", "serta", "maupun") juga melindungi sapaan — menghapusnya
    // meninggalkan kata sambung menggantung ("atau?") yang merusak sintaksis.
    // Cek ini adalah GERBANG INTEGRITAS GRAMATIKAL, bukan daftar hafalan frasa
    // user: "dan/atau/serta/maupun" WAJIB selalu punya pelengkap, tak peduli
    // konteks kalimatnya.
    const PREPOSITION_BEFORE_RE = /(?:^|[\s(])(?:untuk|buat|ke|dari|pada|dengan|bersama|bagi|sama|punya|milik|menemani|dan|atau|serta|maupun)\s+$/i;
    // Plan regresi Fase 1.2 (anti-mutilasi klausa relatif): relativizer "yang"
    // TIDAK PERNAH mendahului vokatif — "yang Bunda maksud / tanyakan" selalu
    // menempatkan sapaan sebagai partisipan klausa (subjek), BUKAN panggilan.
    // Aturan gramatikal produktif (bukan daftar kata user), berlaku umum.
    const RELATIVIZER_BEFORE_RE = /(?:^|[\s(])yang\s+$/i;
    // Sesi 779408 (Mid-Sentence Mutilation Ban): sapaan yang berposisi sebagai
    // SUBJEK/AGEN klausa di TENGAH kalimat — didahului modal verb ("ingin",
    // "bisa", "mau", "perlu", ...) atau konjungsi subordinatif ("kalau",
    // "jika", "apabila", ...). Proteksi lama hanya cek awal kalimat, sehingga
    // "Ada yang ingin Bunda konsultasikan..." kehilangan kata "Bunda" →
    // gramatikal rusak. Ini gerbang gramatikal produktif, bukan hafalan frasa.
    const MODAL_BEFORE_RE = /(?:^|[\s(])(?:ingin|mau|bisa|perlu|dapat|sedang|sudah|akan|belum|harus|boleh|sempat)\s+$/i;
    const SUBORDINATE_BEFORE_RE = /(?:^|[\s(])(?:kalau|jika|apabila|bila|apakah|agar|supaya|saat|ketika)\s+$/i;
    let seen = 0;
    let strippedCount = 0;
    return text.replace(pattern, (match, _g, offset: number, full: string) => {
      // 391501: proteksi subjek — cek posisi awal kalimat/klausa + verba.
      const before = full.slice(0, offset);
      // Fase 5: proteksi objek preposisi — cek kata tepat sebelum sapaan.
      // Objek preposisi DILARANG dihapus (anti-mutilasi), TETAPI tetap
      // menghabiskan kuota agar tidak ada panggilan vokatif tambahan di pesan
      // yang sama (kontrol overuse Rule 6 tetap terjaga).
      if (PREPOSITION_BEFORE_RE.test(before)) {
        seen += 1;
        return match;
      }
      // Plan regresi Fase 1.2: subjek klausa relatif — pertahankan utuh,
      // tetap hitung kuota (kontrol overuse Rule 6 terjaga).
      if (RELATIVIZER_BEFORE_RE.test(before)) {
        seen += 1;
        return match;
      }
      // Sesi 779408: subjek/agen klausa yang didahului modal verb atau
      // konjungsi subordinatif di TENGAH kalimat — DILARANG dipotong.
      // Tetap hitung kuota agar kontrol overuse tidak longgar.
      if (MODAL_BEFORE_RE.test(before) || SUBORDINATE_BEFORE_RE.test(before)) {
        seen += 1;
        return match;
      }
      // Sesi 951450 (anti-mutilasi kalimat tanya): vokatif TERMINAL pertanyaan
      // ("berapa bulan ya Bund?") adalah bagian integral klausa tanya — DILARANG
      // dihapus walau melampaui kuota (kuota tetap dipakai, tapi teks utuh).
      // Vokatif terminal kalimat PERNYATAAN ("dulu ya Bunda 😊") tetap dipangkas.
      // HANYA dilestarikan bila BELUM ada vokatif yang dibuang di pesan ini — jika
      // quota sudah memaksa penghapusan (overuse berantai, mis. "Halo Bunda! ...
      // Bunda. ... Bunda?"), panggilan terminal ikut dibatasi agar kuota sapaan
      // tegas tak bocor (Fase 5, sesi 951450 ∩ anti-overuse Rule 6).
      const restAfter = full.slice(offset + match.length);
      if (strippedCount === 0 && /^\s*[?؟][\s\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]*$/u.test(restAfter)) {
        seen += 1;
        return match;
      }
      // Cari karakter non-spasi terakhir sebelum match.
      let j = before.length - 1;
      while (j >= 0 && /[ \t]/.test(before[j])) j--;
      const prevChar = j >= 0 ? before[j] : '';
      const isSentenceStart = j < 0 || /[.!?\n]/.test(prevChar);
      if (isSentenceStart) {
        const after = full.slice(offset + match.length).replace(/^[ \t]+/, '');
        if (SUBJECT_FOLLOW_RE.test(after)) {
          seen += 1;
          return match; // subjek tata bahasa — pertahankan (tetap hitung kuota)
        }
      }
      seen += 1;
      if (seen <= quota) return match;
      strippedCount += 1;
      return '\u0000'; // marker sementara, dibersihkan di bawah
    }).replace(/,\s*\u0000\s*:/g, ':')
      .replace(/\u0000\s*[,،]?\s*/g, ' ')
      .replace(/,\s*:/g, ':')
      .replace(/,\s*([!?.])/g, '$1')
      .replace(/,\s*(?=[\p{Extended_Pictographic}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}])/gu, ' ')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\s+([,.!?])/g, '$1')
      .replace(/[ \t]+\n/g, '\n')
      .trim();
  }

  /**
   * Pemotong kalimat deterministik (Rule 1): batasi maksimal N kalimat.
   * Batas dihitung pada akhir kalimat valid (./!? dengan huruf-sebelum +
   * boundary-sesudah — anti memotong desimal "60.000"/jam "09.30" — atau emoji
   * penutup). Tanpa batas yang cukup → teks utuh (anti-mutilasi).
   */
  public static trimToMaxSentences(text: string, maxSentences: number = 3): string {
    if (!text || maxSentences <= 0) return text;
    const ends: number[] = [];
    const pushEnd = (idx: number): void => {
      if (idx >= 0 && (ends.length === 0 || idx > ends[ends.length - 1])) ends.push(idx);
    };
    const punctRe = /[.!?]/g;
    let m: RegExpExecArray | null;
    while ((m = punctRe.exec(text)) !== null) {
      const idx = m.index;
      if (m[0] === '.') {
        const prev = idx > 0 ? text[idx - 1] : '';
        const next = idx + 1 < text.length ? text[idx + 1] : '';
        const nextIsBoundary = next === '' || next === ' ' || next === '\n' || next === '\r' || next === '\t';
        // Abaikan desimal/angka bertitik (60.000, 09.30): digit diikuti digit.
        const isDecimal = /\d/.test(prev) && /\d/.test(next);
        // Abaikan titik penomoran daftar ("1. ", "2. " di awal baris).
        const lineStart = text.lastIndexOf('\n', idx - 1) + 1;
        const beforeLine = text.slice(lineStart, idx);
        const isListNumber = /^\s*\d+$/.test(beforeLine) && next === ' ';
        if (!nextIsBoundary || isDecimal || isListNumber) continue;
        // Titik akhir kalimat sah bila didahului huruf ATAU penutup klausa
        // ()"*]) / digit akhir kalimat (mis. "... total 100.").
        const prevIsWordEnd = /[a-zA-Z\u00C0-\u024F0-9)\]*"'’”]/.test(prev);
        if (!prevIsWordEnd) continue;
      }
      pushEnd(idx);
    }
    const emojiRe = /[\p{Extended_Pictographic}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]+(?=\s|\n|$)/gu;
    let em: RegExpExecArray | null;
    while ((em = emojiRe.exec(text)) !== null) {
      pushEnd(em.index + em[0].length - 1);
    }
    // Bullet list naratif: setiap baris bullet dianggap batas kalimat
    const bulletRe = /\n\s*(?:[-•*]|\d+[.)])\s+/g;
    let bm: RegExpExecArray | null;
    while ((bm = bulletRe.exec(text)) !== null) {
      pushEnd(bm.index);
    }
    ends.sort((a, b) => a - b);
    if (ends.length <= maxSentences) return text;
    return text.slice(0, ends[maxSentences - 1] + 1).trimEnd();
  }

  /**
   * Deteksi konten terstruktur (senarai bernomor/bullet, formulir, rincian
   * katalog) yang DILARANG dipotong oleh trimmer kalimat. Balasan prosa
   * (sapaan/penjelasan) tanpa penanda ini aman dipangkas ke batas kalimat.
   */
  public static hasStructuredContent(text: string): boolean {
    if (!text) return false;
    // Hanya formulir reservasi dan rincian nota resmi yang dikecualikan
    // dari trimmer — bullet • narasi biasa TIDAK mengecualikan (anti-kaset).
    if (/Nama Bunda\s*:|Hari dan tanggal\s*:/i.test(text)) return true;
    if (/Total Keseluruhan\s*:|Subtotal\s*:/i.test(text)) return true;
    return false;
  }

  /**
   * Trimmer Rule 1 sadar-header: header sapaan Turn-0 yang di-prepend
   * deterministik (varian prefix pendek `Halo X! ✨ Perkenalkan, saya Bidan
   * Yusi dari ...` maupun header kanonis SOP `Halo/Waalaikumsalam Bunda ✨ +
   * Terima kasih ... + Perkenalkan ...`) TIDAK dihitung sebagai bagian kuota
   * 3 kalimat balasan inti — jika dihitung, jawaban substantif (mis.
   * rekomendasi treatment) atau justru pemantik domisili ikut terpotong.
   * Header dipertahankan utuh; sisa teks dipangkas ke `maxSentences`.
   */
  public static trimToMaxSentencesPreservingGreetingHeader(text: string, maxSentences = 3): string {
    if (!text) return text;
    const headerMatch = text.match(/^Halo\s+[^!?.\n]+!\s*✨\s*Perkenalkan,\s*saya\s+Bidan\s+Yusi[^.]*\.\s*/i)
      ?? text.match(/^(?:Halo|Waalaikumsalam)\s+Bunda\s*✨\s*Terima kasih sudah menghubungi kami\.\s*Perkenalkan,\s*saya\s+Bidan\s+Yusi[^.]*\.\s*/i);
    if (!headerMatch) return OutputSanitizer.trimToMaxSentences(text, maxSentences);
    const header = headerMatch[0];
    const rest = text.slice(header.length).trimStart();
    const trimmedRest = OutputSanitizer.trimToMaxSentences(rest, maxSentences);
    return `${header}${trimmedRest}`.trimEnd();
  }

  /**
   * Validasi kelayakan balasan: apakah teks cukup panjang dan bermakna.
   */
  public static isValidReply(text: string): boolean {
    if (!text || text.trim().length < 5) return false;
    
    // Tolak jika balasan hanya berisi karakter tunggal atau artefak (misal: "S", ".", "ok")
    const cleaned = text.trim().toLowerCase();
    if (/^[a-z0-9.?!,\s]{1,4}$/i.test(cleaned)) return false;

    // Tolak jika teks masih mengandung kata-kata instruksi sistem
    if (/^(?:kita perlu menyusun|analisis konteks|instruksi prompt)/i.test(cleaned)) {
      return false;
    }

    return true;
  }
}
