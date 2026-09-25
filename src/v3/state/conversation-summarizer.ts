import { CustomerGoalSession } from './goal-tracker';
import { treatmentCatalogService } from '../../services/treatment-catalog.service';
import { getCoverageCities } from '../../config/coverage';
import type { ExtractedEntities } from '../../types/nlu';

export interface V3SummaryOptions {
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  customerInput?: string;
}

/**
 * V3ConversationSummarizer — native V3 (0 token, <1ms)
 * Porting dari src/slot-engine/conversation-summarizer.ts agar menerima
 * CustomerGoalSession secara langsung tanpa adapter CustomerSlate.
 */
export class V3ConversationSummarizer {
  public static summarize(
    session: CustomerGoalSession,
    incomingText: string,
    options?: V3SummaryOptions
  ): string {
    const history = options?.history || [];
    const customerInput = options?.customerInput || incomingText || '';
    const sudahDibahas: string[] = [];
    const janganDiulang: string[] = [];
    const botRepliesCount = history.filter((h) => h.role === 'assistant').length;

    // Helper anti-duplikat larangan (phase-aware, tanpa regex keyword).
    const banOnce = (entry: string): void => {
      if (!janganDiulang.some((j) => j.toLowerCase().includes(entry.toLowerCase().slice(0, 24)))) {
        janganDiulang.push(entry);
      }
    };

    // 1. Lokasi & ongkir — PHASE-AWARE (Akar 2/4): saat ongkirStatus QUOTED/
    // CONFIRMED, larangan hitung-ulang ditambahkan OTOMATIS dari state (tanpa
    // cek keyword regex), selaras dengan phase directive ONGKIR_QUOTED di Call 1.
    if (session.location?.kelurahan || session.location?.distanceKm != null) {
      const locLabel = session.location.kelurahan || session.location.kecamatan || 'lokasi Bunda';
      const distLabel = session.location.distanceKm != null ? `, ~${session.location.distanceKm} km` : '';
      const promo = session.location.ongkirPromo;
      // Rule 2 (Strict Information Hiding): nominal ongkir HANYA disebut di
      // ringkasan prompt bila customer sudah pernah menanyakan biaya/ongkir
      // (priceDiscussed). Mode konsultasi → cukup lokasi tanpa nominal.
      if (promo != null && session.priceDiscussed === true) {
        sudahDibahas.push(`Ongkir Rp ${promo.toLocaleString('id-ID')} promo (${locLabel}${distLabel})`);
        banOnce('Info ongkir atau perhitungan jarak (sudah disampaikan di chat atas)');
      } else {
        sudahDibahas.push(`Lokasi: ${locLabel}${distLabel}`);
      }
    }
    if (session.ongkirStatus === 'QUOTED' || session.ongkirStatus === 'CONFIRMED') {
      banOnce('Menghitung ulang jarak/ongkir (sudah disampaikan — JANGAN panggil hitung ongkir lagi kecuali alamat baru)');
    }

    // 2. Konteks audiens multi-subjek (ibu vs anak vs keduanya) — anti amnesia & anti bocor
    const isMomSubject = session.targetAudience === 'MOMS' || session.targetAudience === 'BOTH' || Boolean(session.momProfile?.gestationalWeeks != null || session.momProfile?.stage);
    const ageMonths = session.childProfile?.ageMonths ?? session.children?.[0]?.ageMonths ?? null;
    if (session.momProfile?.gestationalWeeks != null) {
      sudahDibahas.push(`Usia kehamilan Bunda: ${session.momProfile.gestationalWeeks} minggu`);
      janganDiulang.push('Menanyakan usia kehamilan Bunda');
    } else if (session.momProfile?.stage === 'POSTPARTUM') {
      sudahDibahas.push(`Kondisi Bunda: paska salin/nifas${session.momProfile.postpartumPeriod ? ` (${session.momProfile.postpartumPeriod})` : ''}`);
      janganDiulang.push('Menanyakan kondisi persalinan Bunda');
    } else if (session.momProfile?.stage === 'PREGNANT') {
      sudahDibahas.push('Kondisi Bunda: sedang hamil (usia kehamilan belum spesifik)');
      janganDiulang.push('Menanyakan usia kehamilan Bunda');
    }
    if ((session.momProfile?.complaints || []).length > 0) {
      sudahDibahas.push(`Keluhan Bunda: ${session.momProfile!.complaints.join(', ')}`);
      janganDiulang.push('Menanyakan ulang keluhan fisik Bunda');
    }
    if (ageMonths != null && ageMonths > 0 && (!isMomSubject || (session.children || []).length > 0 || session.childProfile?.ageMonths != null)) {
      sudahDibahas.push(`Usia si kecil: ${ageMonths} bulan`);
      janganDiulang.push('Menanyakan usia atau umur anak (sudah diketahui)');
    }

    // 3. Keluhan & treatment — PHASE-AWARE: saat TREATMENT_DISCUSSED,
    // larangan tanya-ulang menyebut nama treatment spesifik (selaras dengan
    // phase directive), tanpa bergantung pada regex hasDayMention & sejenisnya.
    if (session.selectedTreatment) {
      sudahDibahas.push(`Treatment yang dipilih/ditanyakan: *${session.selectedTreatment}*`);
      banOnce(`Menanyakan 'rencana mau treatment apa' (sudah dibahas: ${session.selectedTreatment})`);
    } else {
      const symptoms = [
        ...(session.childProfile?.symptoms || []),
        ...((session.children || []).flatMap((c) => c.symptoms || [])),
      ].filter((s, i, arr) => arr.indexOf(s) === i);
      const momComplaints = [...(session.momProfile?.complaints || [])].filter((s, i, arr) => arr.indexOf(s) === i);
      const activeSymptoms = session.targetAudience === 'MOMS' ? momComplaints : symptoms;
      if (activeSymptoms.length > 0) {
        const allServices = treatmentCatalogService.getAllServices(true);
        const candidates = session.targetAudience === 'MOMS'
          ? treatmentCatalogService.filterServicesByAudience(allServices, { audienceIntent: 'MOMS', isMaternalKeyword: true })
          : ageMonths != null
            ? treatmentCatalogService.filterServicesByAudience(allServices, { ageMonths })
            : allServices;
        const matchedService = session.targetAudience === 'MOMS'
          ? treatmentCatalogService.recommendServiceBySymptoms(activeSymptoms, ageMonths, 'MOMS')?.name
          : treatmentCatalogService.recommendServiceBySymptoms(activeSymptoms, ageMonths, undefined)?.name;
        const suggested = matchedService || undefined;
        if (session.targetAudience === 'MOMS') {
          if (suggested) sudahDibahas.push(`Keluhan Bunda: ${momComplaints.join(', ')} (disarankan *${suggested}* dari katalog aktif)`);
          else sudahDibahas.push(`Keluhan Bunda: ${momComplaints.join(', ')}`);
          janganDiulang.push('Menanyakan ulang keluhan Bunda');
        } else if (session.targetAudience === 'BOTH') {
          const parts: string[] = [];
          if (momComplaints.length > 0) parts.push(`Bunda: ${momComplaints.join(', ')}`);
          if (symptoms.length > 0) parts.push(`Si kecil: ${symptoms.join(', ')}`);
          if (suggested) sudahDibahas.push(`Keluhan Mom & Baby — ${parts.join('; ')} (disarankan *${suggested}* dari katalog aktif)`);
          else sudahDibahas.push(`Keluhan Mom & Baby — ${parts.join('; ')}`);
          janganDiulang.push('Menanyakan ulang keluhan Bunda maupun si kecil');
        } else {
          if (suggested) sudahDibahas.push(`Keluhan si kecil: ${symptoms.join(', ')} (disarankan *${suggested}* dari katalog aktif)`);
          else sudahDibahas.push(`Keluhan si kecil: ${symptoms.join(', ')}`);
          janganDiulang.push('Menanyakan ulang keluhan si kecil');
        }
      }
    }

    // 4. Formulir reservasi
    if (session.booking?.preferredDate || session.booking?.reservationId) {
      sudahDibahas.push('Format formulir reservasi sudah pernah dibahas');
      janganDiulang.push('Mengirim ulang teks formulir reservasi panjang (cukup ingatkan melengkapi data)');
    }

    // 4b. Jadwal final anti-todong: hari yang sudah disepakati & tercatat
    // DILARANG ditanyakan/ditawarkan ulang dalam bentuk apa pun.
    const scheduleAgreed = Boolean(session.booking?.preferredDate || session.booking?.reservationId);
    if (scheduleAgreed) {
      const when = session.booking?.preferredDate || 'yang sudah disepakati';
      sudahDibahas.push(`Hari kunjungan (${when}) sudah disepakati dan tercatat`);
      janganDiulang.push(`Menanyakan atau menawarkan hari jadwal lagi (karena hari ${when} sudah final disepakati)!`);
    }

    // 5. Sapaan pembuka
    if (botRepliesCount > 0) {
      janganDiulang.push('Sapaan pembuka "Halo Bunda!" atau perkenalan diri "Perkenalkan saya Bidan Yusi..." (ini percakapan lanjutan, langsung jawab inti)');
    }

    // 6. Hari/jadwal — sesi 614425: saat hari SUDAH disebut DAN treatment
    // sudah disepakati, larangan "jangan tanya hari" saja membuat LLM buntu
    // sehingga malah menanyakan JAM spesifik. Ganti dengan arahan maju:
    // kunci reservasi via save_reservation, dan larang tanya jam spesifik.
    const rawInputLower = customerInput.toLowerCase();
    const hasDayMention = /\b(hari\s+(?:senin|selasa|rabu|kamis|jumat|sabtu|minggu)|besok|lusa|weekend|akhir\s+pekan|sabtu|minggu|senin|selasa|rabu|kamis|jumat)\b/i.test(rawInputLower);
    const treatmentAgreedForCommit = Boolean(session.selectedTreatment) || (session.cartItems && session.cartItems.length > 0);
    const commitReady = hasDayMention && treatmentAgreedForCommit && !scheduleAgreed;
    if (hasDayMention) {
      janganDiulang.push('Menanyakan "mau treatment di hari apa" (hari sudah disebut Bunda — JANGAN tanya ulang)');
      // TAHAP 2 (sesi 951450) — Rule 4 anti-todong usia saat negosiasi jadwal:
      // bila hari disebut sementara usia belum tercatat, DILARANG menodong usia.
      if (ageMonths == null) {
        janganDiulang.push('Menanyakan usia si kecil saat negosiasi jadwal (durasi usia tidak relevan untuk ketersediaan jadwal)');
      }
    }
    if (commitReady) {
      sudahDibahas.push('Bunda sudah menyebutkan hari kunjungan — siap dikunci menjadi reservasi');
      janganDiulang.push('Menanyakan JAM kunjungan spesifik ("jam berapa", "mau jam berapa") — jam diatur tim Bidan sesuai rute harian');
      janganDiulang.push('Meminta konfirmasi ulang treatment/hari yang sudah disepakati — langsung kunci reservasi');
    }

    // 7. Cool-off
    const askedLocationRecently = isAskedLocationRecently(history);
    const locationResolved = Boolean(session.location?.kelurahan || session.location?.distanceKm != null);
    const locationPartiallyResolved = Boolean(session.location?.kelurahan || session.location?.kecamatan || session.location?.kota || session.location?.distanceKm != null);

    // Heuristic: deteksi apakah input customer menjawab pertanyaan lokasi (nama kota/kecamatan/kelurahan)
    // tanpa menghafal daftar kota — cek pola jawaban singkat non-pertanyaan.
    // Revisi fondasional Sesi 640820: gabungan "bngurasi berapa kak" (≤4 kata + tanya biaya)
    // sebelumnya tercoret oleh `includes(' berapa')` → Router dicuci otak ke katalog harga.
    const isLikelyLocationAnswer = (text: string): boolean => {
      const lower = text.toLowerCase().trim();
      if (lower.length === 0 || lower.length > 30) return false;
      const words = lower.split(/\s+/).filter(Boolean);
      const isShortCompositeLocationFee = words.length <= 4 && (lower.includes('berapa') || lower.includes('brp') || lower.includes('ongkir'));
      if (!isShortCompositeLocationFee && (lower.includes('?') || lower.includes(' apa') || lower.includes(' berapa') || lower.includes(' bisa'))) return false;
      const questionKeywords = ['harga', 'tarif', 'biaya', 'promo', 'pijat', 'batuk', 'pilek', 'kembung', 'grok', 'kolik', 'gtm', 'nafsu', 'makan', 'tidur', 'rewel', 'pegala', 'capek', 'demam', 'panas', 'flu', 'cukur', 'rambut', 'jadwal', 'hari', 'jam', 'slot', 'kosong', 'tersedia', 'bulan', 'tahun', 'usia', 'umur', 'ikut', 'masuk', 'kategori', 'cukur', 'menit', 'durasi', 'lama', 'boleh', 'mau', 'ingin', 'perlu', 'butuh'];
      if (questionKeywords.some((kw) => lower.includes(kw))) return false;
      // Partikel percakapan yang BUKAN nama lokasi — hindari false positive pada filler
      const conversationalFillers = ['ya', 'kak', 'deh', 'dong', 'sih', 'nih', 'gitu', 'oke', 'baik', 'oh', 'siang', 'pagi', 'sore', 'malam', 'terima', 'kasih', 'makasih', 'trims', 'thanks'];
      const priceBase = ['berapa', 'brp', 'harga', 'tarif', 'biaya', 'ongkir', 'promo'];
      const fillerSet = new Set(conversationalFillers);
      const isPriceLike = (w: string): boolean => priceBase.some((kw) => w.includes(kw));
      // Pure price/filler (mis. "berapa", "berapa kak", "ongkirnya berapa") bukan jawaban lokasi
      if (words.every((w) => isPriceLike(w) || fillerSet.has(w))) return false;
      if (words.every((w) => fillerSet.has(w))) return false;
      // Jawaban lokasi cenderung 1-4 kata (4 untuk komposit "bngurasi berapa ya kak")
      return words.length >= 1 && words.length <= 4;
    };

    const userAnsweredLocation = askedLocationRecently && !locationResolved && isLikelyLocationAnswer(customerInput);
    // PLAN 12 Fase 3 — cek bukti lokasi/ongkir terpisah (hanya untuk cool-off, bukan untuk ringkasan fokus)
    const hasOngkirOrCoverageEvidence = (() => {
      const lower = (customerInput || '').toLowerCase();
      if (lower.includes('ongkir') || lower.includes('ongkos kirim') || lower.includes('jarak') || lower.includes('transport')) return true;
      try {
        for (const c of getCoverageCities() || []) {
          const name = String(c || '').toLowerCase();
          if (name.length >= 3 && lower.split(/[^a-z0-9]+/).includes(name)) return true;
        }
      } catch {}
      return false;
    })();
    if (askedLocationRecently && !locationResolved && !userAnsweredLocation && !hasOngkirOrCoverageEvidence) {
      janganDiulang.push('Menanyakan alamat/kelurahan rumah Bunda lagi (karena baru saja ditanyakan dan Bunda sedang fokus berkonsultasi). Berikan jawaban empatik tanpa menodong alamat!');
    }
    const recentAssistantMsgs = history.filter((h) => h.role === 'assistant').slice(-2);
    const askedScheduleRecently = recentAssistantMsgs.some((m) => {
      const c = (m.content || '').toLowerCase();
      return c.includes('di hari apa') || c.includes('hari atau tanggal') || c.includes('tanggal yang diinginkan')
        || c.includes('jadwal kunjungan') || c.includes('jadwal treatment') || c.includes('jadwal bidan')
        || c.includes('ketersediaan jadwal') || c.includes('rencana mau treatment di hari apa');
    });
    if (askedScheduleRecently && (!hasDayMention || scheduleAgreed)) {
      janganDiulang.push('Menanyakan "mau treatment di hari apa" atau menodong jadwal kunjungan lagi (karena baru saja ditanyakan). Jawab dengan ramah tanpa menodong!');
    }

    // 8. Topik sedang dibahas (simplified)
    // Sesi 973126: deteksi nominal berbasis token kata (bukan substring mentah
    // — substring 'rp' menelan kata 'bRp'/'beRapa'). Tokenisasi teknis: pecah per
    // kata, kupas tanda baca di ujung, lalu cek satuan nominal. Tanpa regex
    // semantik / tanpa memotong kalimat — murni branching summary.
    const hasNominalToken = (lower: string): boolean => {
      const tokens = lower.split(' ').map((t) => t.trim()).filter(Boolean);
      for (let raw of tokens) {
        const t = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
        if (!t) continue;
        if (t === 'rp' || t === 'rb' || t === 'rbu' || t === 'ribu' || t === 'juta') return true;
        // Suffix nominal dengan prefix angka: 100rb, 60ribu, 100rbu, 2juta, 100k
        const startsDigit = t.length > 0 && t[0] >= '0' && t[0] <= '9';
        if (startsDigit && (t.endsWith('rb') || t.endsWith('rbu') || t.endsWith('ribu') || t.endsWith('juta'))) return true;
        if (startsDigit && t.endsWith('k') && t.length >= 3) return true;
        if (startsDigit && t.startsWith('rp') && t.length > 2) return true;
      }
      return false;
    };
    // Fondasional broad-city (Fase 2): kota-dalam-coverage tanpa treatment terpilih → consultation-first
    const isBroadCoverageCity = (() => {
      try {
        const lower = (customerInput || '').toLowerCase();
        const tokens = lower.split(/[^a-z0-9]+/).filter(Boolean);
        for (const c of getCoverageCities() || []) {
          const name = String(c || '').toLowerCase().trim();
          if (!name) continue;
          if (tokens.includes(name)) return true;
          // alias 'sby'/'sda' → treat as surabaya/sidoarjo broad
          if ((name === 'sby' && tokens.includes('sby')) || (name === 'sda' && tokens.includes('sda'))) return true;
        }
      } catch {}
      return false;
    })();
    const broadConsultationFirst = Boolean(userAnsweredLocation && isBroadCoverageCity && !session.selectedTreatment && !(session.cartItems && session.cartItems.length > 0));
    // Simpan label kota untuk pesan konsultasi (ambil token coverage pertama yang match)
    const broadCityLabel = (() => {
      try {
        const lower = (customerInput || '').toLowerCase();
        const tokens = lower.split(/[^a-z0-9]+/).filter(Boolean);
        for (const c of getCoverageCities() || []) {
          const name = String(c || '').toLowerCase().trim();
          if (name && tokens.includes(name)) {
            if (name === 'sby') return 'Surabaya';
            if (name === 'sda') return 'Sidoarjo';
            return name.charAt(0).toUpperCase() + name.slice(1);
          }
        }
      } catch {}
      return 'kota tersebut';
    })();

    let sedangDibahas = 'Bunda mengajukan pertanyaan seputar layanan';
    let yangPerluDijawab = 'Jawab pertanyaan Bunda dengan ramah dan solutif sebagai Bidan Yusi, lalu arahkan ke langkah berikutnya';
    if (broadConsultationFirst) {
      sedangDibahas = `Bunda mengonfirmasi domisili di kota ${broadCityLabel} (wilayah operasional utama kami)`;
      yangPerluDijawab = `Sambut hangat dan konfirmasikan bahwa area ${broadCityLabel} siap dijangkau tim Bidan kami. Alihkan fokus ke kebutuhan perawatan: tanyakan ramah rencana perawatan untuk si kecil atau Bunda, sambil menanyakan area/patokan daerahnya secara santai.`;
    } else if (userAnsweredLocation) {
      sedangDibahas = 'Bunda menginfokan daerah tempat tinggal (masih berupa kota/wilayah luas)';
      yangPerluDijawab = 'Tanyakan nama kelurahan atau kecamatan spesifiknya dengan ramah agar kami bisa bantu cekkan jangkauan Bidan dan ongkir ke rumah Bunda.';
    } else if (commitReady) {
      sedangDibahas = 'Bunda sudah memilih treatment dan menyebutkan hari kunjungan';
      yangPerluDijawab = 'Lokasi sudah diketahui dan hari sudah disebut — KUNCI reservasi lewat save_reservation, sampaikan jadwal akan dikonfirmasi tim Bidan. DILARANG menanyakan JAM spesifik.';
    } else if (hasDayMention) {
      sedangDibahas = 'Bunda menanyakan ketersediaan jadwal';
      yangPerluDijawab = 'Pola "cekkan/infokan" HANYA bila lokasi Bunda sudah diketahui; bila lokasi BELUM diketahui, tanyakan domisili netral dulu (aturan persona 5a) dan DILARANG berjanji mengecek jadwal. (DILARANG bilang "Tentu bisa" sepihak). DILARANG menanyakan usia si kecil saat negosiasi jadwal.';
    } else if ((rawInputLower.includes('menit') || rawInputLower.includes('durasi') || rawInputLower.includes('berapa lama'))
      && hasNominalToken(rawInputLower)) {
      // Sesi 973126: pertanyaan komposit nominal + durasi tanpa nama paket pasti
      // (mis. "100rb berapa menit pijetnya"). BUKAN durasi paket yang sudah dipilih.
      // Paket BELUM dipilih → DILARANG menyuntik larangan "rencana mau treatment apa"
      // (larangan itu hanya dari selectedTreatment yang kini customer-agreed only).
      sedangDibahas = 'Bunda menanyakan paket dan durasi untuk nominal tertentu (tanpa nama paket pasti)';
      yangPerluDijawab = 'Jelaskan paket apa yang sesuai nominal tersebut dari hasil tool get_catalog_and_price (kutip klarifikasi nominal: promo/normal + durasi), sebutkan durasinya, dan tanyakan ramah apakah perawatan untuk Bunda atau si kecil.';
    } else if (rawInputLower.includes('menit') || rawInputLower.includes('durasi') || rawInputLower.includes('berapa lama')) {
      sedangDibahas = 'Bunda menanyakan durasi waktu pelaksanaan perawatan';
      yangPerluDijawab = 'STATEMENT-ONLY RESPONSE (TUTUP TANPA PERTANYAAN): Sebutkan durasi pelaksanaan resmi dari katalog beserta manfaatnya (maksimal 2-3 kalimat). DILARANG KERAS MENAMBAHKAN PERTANYAAN JADWAL / HARI!';
      banOnce('Menanyakan "mau rencana ambil treatment apa" atas jawaban durasi (informasi statement saja — tutup langsung tanpa pertanyaan jadwal/hari)');
    } else if ((rawInputLower.includes('bulan') || rawInputLower.includes('tahun') || rawInputLower.includes('umur') || rawInputLower.includes('usia'))
      && (rawInputLower.includes('ikut') || rawInputLower.includes('masuk') || rawInputLower.includes('kategori'))) {
      sedangDibahas = 'Bunda mengklarifikasi kategori usia dan kesesuaian perawatan si kecil';
      yangPerluDijawab = 'Jelaskan kesesuaian paket berdasarkan data resmi katalog DB (kategori BAYI untuk usia 0-24 bulan, kategori KIDS untuk 2-10 tahun). STATEMENT-ONLY RESPONSE: Jawab secara ramah dan tuntas tanpa menodong jadwal kunjungan.';
    } else if (rawInputLower.includes('berapa') || rawInputLower.includes('harga') || rawInputLower.includes('tarif') || rawInputLower.includes('biaya')) {
      // Fondasional Sesi 640820: hanya komposit pendek lokasi+biaya (≤4 kata, ada token lokasi bukan harga/filler)
      // yang diprioritaskan sebagai respons domisili; pure "berapa"/"harganya berapa?" tetap tarif umum.
      const compositeWords = rawInputLower.trim().split(/\s+/).filter(Boolean);
      const priceBaseSet = new Set(['berapa', 'brp', 'harga', 'tarif', 'biaya', 'ongkir', 'promo', 'kak', 'ya', 'deh', 'dong', 'sih', 'nih', 'gitu', 'oke', 'baik']);
      const isPriceLikeToken = (clean: string): boolean => {
        if (priceBaseSet.has(clean)) return true;
        return ['harga', 'tarif', 'biaya', 'berapa', 'brp', 'ongkir', 'promo'].some((kw) => clean.includes(kw));
      };
      const serviceBase = ['pijat', 'batuk', 'pilek', 'kembung', 'grok', 'kolik', 'gtm', 'nafsu', 'makan', 'tidur', 'rewel', 'pegala', 'capek', 'demam', 'panas', 'flu', 'cukur', 'rambut', 'jadwal', 'hari', 'jam', 'slot', 'bulan', 'tahun', 'usia', 'umur', 'menit', 'durasi', 'bayi', 'anak', 'lahap', 'ceria', 'terapi', 'oksitosin', 'moksa'];
      const hasLocationTokenInPriceQuery = compositeWords.some((w) => {
        const clean = w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase();
        if (clean.length < 3) return false;
        if (isPriceLikeToken(clean)) return false;
        if (['kak', 'ya', 'deh', 'dong', 'sih', 'nih', 'gitu', 'oke', 'baik'].includes(clean)) return false;
        if (serviceBase.some((kw) => clean.includes(kw))) return false;
        return true;
      });
      const isLocationFeeComposite = compositeWords.length > 0 && compositeWords.length <= 4 && hasLocationTokenInPriceQuery && (rawInputLower.includes('berapa') || rawInputLower.includes('brp') || rawInputLower.includes('ongkir'));
      if (askedLocationRecently && !locationResolved && isLocationFeeComposite) {
        sedangDibahas = 'Bunda merespons pertanyaan lokasi atau menanyakan jangkauan/biaya ke area tempat tinggal';
        yangPerluDijawab = 'Cek jangkauan dan ongkir ke lokasi Bunda via calculate_delivery, lalu jelaskan dengan ramah serta tawarkan paket perawatan yang sesuai.';
      } else {
        sedangDibahas = 'Bunda menanyakan biaya / tarif';
        yangPerluDijawab = 'Jawab pertanyaan biaya/tarif secara transparan dan solutif sesuai konteks percakapan (biaya layanan dari katalog atau estimasi ongkir ke wilayah yang ditanyakan).';
      }
    } else if (rawInputLower.includes('cukur') && (rawInputLower.includes('berapa') || rawInputLower.includes('biaya'))) {
      sedangDibahas = 'Bunda menanyakan TARIF biaya cukur rambut';
      yangPerluDijawab = 'Sebutkan biaya cukur rambut dan akumulasikan ke total biaya.';
    }

    const sudahDibahasStr = sudahDibahas.length > 0 ? sudahDibahas.map((s) => `• ${s}`).join('\n') : '• Percakapan baru dimulai (Turn awal)';
    const janganDiulangStr = janganDiulang.length > 0 ? janganDiulang.map((j) => `• 🚫 ${j}`).join('\n') : '• Tidak ada larangan khusus';

    return `[RINGKASAN KONTEKS PERCAKAPAN SAAT INI]
STATUS DATA YANG SUDAH DILALUI:
${sudahDibahasStr}

FOKUS SAAT INI:
• ⏳ Sedang ditanyakan: ${sedangDibahas}
• 🎯 Yang wajib dijawab: ${yangPerluDijawab}

PANDUAN ANTI-PENGULANGAN (WAJIB DIPATUHI):
${janganDiulangStr}`;
  }
}

/**
 * Mendeteksi apakah bot/asisten baru saja menanyakan domisili / alamat pada 1-2 turn terakhir.
 * Digunakan untuk cool-off penodongan lokasi (anti-kaset rusak).
 */
export function isAskedLocationRecently(history: Array<{ role: string; content: string }>): boolean {
  const recentAssistantMsgs = (history || []).filter((h) => h.role === 'assistant').slice(-2);
  return recentAssistantMsgs.some((m) => {
    const c = (m.content || '').toLowerCase();
    return c.includes('daerah atau kelurahan')
      || c.includes('kelurahan mana')
      || c.includes('rumahnya dimana')
      || c.includes('rumah bunda dimana')
      || c.includes('daerah mana')
      || c.includes('lokasi rumah')
      || c.includes('alamat rumah')
      || c.includes('tinggal dimana')
      || c.includes('posisi rumah')
      || c.includes('alamat lengkap');
  });
}

