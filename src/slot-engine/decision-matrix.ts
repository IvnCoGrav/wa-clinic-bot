import { CustomerSlate, ExtractedEntities, DecisionResult } from './types';
import { SlateStore } from './slate-store';
import { TEMPLATES } from '../config/persona';
import { ConversationState } from '@prisma/client';

export class DecisionMatrix {
  /**
   * Evaluasi deterministik prioritas keputusan (0 token LLM, murni TypeScript).
   */
  public static async evaluate(
    slate: CustomerSlate,
    extraction: ExtractedEntities,
    context?: {
      tenantId?: string;
      incomingText?: string;
      history?: Array<{ role: 'user' | 'assistant'; content: string }>;
      lastDiscussedTreatment?: string;
    }
  ): Promise<DecisionResult> {
    const updatedSlate = SlateStore.updateSlateWithExtraction(slate, extraction);
    const rawIncoming = context?.incomingText || '';
    const cleanText = rawIncoming.replace(/(?:Promo|ID|Iklan|Diskon)?\s*\[\s*[\w\s]{1,10}?\s*\]/gi, '').trim();
    const rawText = cleanText.toLowerCase();

    const { hasIslamicGreeting } = await import('../utils/islamic-greeting');
    const isIslamic = hasIslamicGreeting(rawIncoming);

    // =========================================================================
    // PRIORITY 1: DARURAT MEDIS KRITIS (Silent Handoff ke CS Manusia)
    // =========================================================================
    if (extraction.isMedicalEmergency || updatedSlate.medicalConcerns.length > 0) {
      updatedSlate.isHumanHandling = true;
      updatedSlate.humanHandlingReason = 'medical_concern';
      return {
        action: 'ESCALATE_HUMAN_EMERGENCY',
        reason: 'Customer mengeluhkan kondisi darurat medis fatal (kejang/tidak sadar/sesak berat).',
        updatedSlate,
        shouldSendPricelistImage: false,
      };
    }

    // =========================================================================
    // PRIORITY 1B: KOMPLAIN / KELUHAN LAYANAN (Silent Escalation ke CS Manusia)
    // =========================================================================
    const isComplaint =
      extraction.intents.includes('complaint') ||
      /\b(komplain|kecewa|pelayanan\s*(buruk|kurang|jelek)|terapis\s*(telat|kasar|tidak\s*ramah)|kecewa\s*banget|mau\s*protes)\b/i.test(rawText);

    if (isComplaint) {
      updatedSlate.isHumanHandling = true;
      updatedSlate.humanHandlingReason = 'customer_complaint';
      return {
        action: 'ESCALATE_HUMAN_COMPLAINT',
        reason: 'Customer menyampaikan keluhan/komplain pelayanan -> Silent escalation ke CS.',
        updatedSlate,
        shouldSendPricelistImage: false,
      };
    }

    // =========================================================================
    // PRIORITY 1C: PERMINTAAN CS / ADMIN MANUSIA (Direct Handover)
    // =========================================================================
    const isHumanAgentRequest =
      /\b(bicara\s+(dengan|sama)?\s*(orang|admin|manusia|cs)|mau\s+(ngomong|bicara|chat)\s+(sama|dengan)?\s*(admin|cs|orang|manusia)|hubungkan\s+ke\s+(admin|cs)|mau\s+cs\s*(asli|manusia)?|ini\s+bot\s+ya|minta\s+nomor\s+admin)\b/i.test(rawText);

    if (isHumanAgentRequest) {
      updatedSlate.isHumanHandling = true;
      updatedSlate.humanHandlingReason = 'human_agent_requested';
      return {
        action: 'ESCALATE_HUMAN_AGENT_REQUEST',
        reason: 'Customer meminta berbicara langsung dengan CS/Admin manusia.',
        updatedSlate,
        shouldSendPricelistImage: false,
        deterministicTemplateReply: TEMPLATES.humanAgentRequest(),
      };
    }

    // =========================================================================
    // PRIORITY 1D: RESCHEDULE / PEMBATALAN RESERVASI AKTIF (Handover)
    // =========================================================================
    const isRescheduleOrCancel =
      /\b(reschedule|ganti\s+jadwal|ubah\s+jadwal|pindah\s+jadwal|batal\s*(kan)?\s*(jadwal|booking|reservasi)|cancel\s*(jadwal|booking|reservasi)|batalkan\s*(jadwal|booking|reservasi))\b/i.test(rawText);

    if (isRescheduleOrCancel) {
      updatedSlate.isHumanHandling = true;
      updatedSlate.humanHandlingReason = 'reschedule_or_cancellation';
      return {
        action: 'ESCALATE_RESCHEDULE_CANCEL',
        reason: 'Customer meminta reschedule atau pembatalan jadwal -> Handover ke CS.',
        updatedSlate,
        shouldSendPricelistImage: false,
        deterministicTemplateReply: TEMPLATES.rescheduleOrCancel(),
      };
    }

    // =========================================================================
    // PRIORITY 1E: PERTANYAAN LAYANAN DI LUAR PRICELIST / KATALOG RESMI (Silent Escalation)
    // Sesuai SOP: jika customer menanyakan layanan di luar pricelist/katalog resmi
    // (misal: mandikan bayi, paket newborn harian, baby sitting, tindik, imunisasi, dll),
    // bot DIAM (silent) dan langsung mengalihkan penanganan ke CS/Bidan manusia.
    // =========================================================================
    const isPostVaccineConsultation =
      /\b(habis|setelah|pasca|baru|selesai)\s+(?:vaksin|imunisasi|imun)\b/i.test(rawText) ||
      /\b(?:vaksin|imunisasi|imun)\b.*?\b(berpengaruh|boleh\s*(?:kah|ga|gak|nggak|ta)|aman\s*(?:kah|ga|gak)|bisa\s+pijat|pijatnya)\b/i.test(rawText);

    const isUnlistedServiceQuery =
      !isPostVaccineConsultation &&
      (extraction.intents.includes('ask_unlisted_service') ||
        /\b(mandikan\s*bayi|mandiin\s*bayi|jasa\s*mandi|paket\s*mandi|baby\s*sitting|penitipan\s*(anak|bayi)|tindik(\s*telinga)?|jasa\s*(?:imunisasi|vaksin)|layanan\s*(?:imunisasi|vaksin)|suntik\s*(?:imunisasi|vaksin)|sunat|rawat\s*tali\s*pusat|rawat\s*luka|fisioterapi|paket\s*newborn|perawatan\s*newborn)\b/i.test(rawText));

    if (isUnlistedServiceQuery) {
      updatedSlate.isHumanHandling = true;
      updatedSlate.humanHandlingReason = 'unlisted_service';
      return {
        action: 'ESCALATE_HUMAN_UNLISTED_SERVICE',
        reason: 'Customer menanyakan layanan di luar pricelist/katalog resmi -> Silent escalation ke CS.',
        updatedSlate,
        shouldSendPricelistImage: false,
      };
    }

    // =========================================================================
    // PRIORITY 2: SEDANG DITANGANI CS MANUSIA (CS Takeover Guard)
    // =========================================================================
    if (updatedSlate.isHumanHandling) {
      return {
        action: 'SILENT_HUMAN_ACTIVE',
        reason: 'Percakapan sedang dalam penanganan manual oleh CS.',
        updatedSlate,
        shouldSendPricelistImage: false,
      };
    }

    const isInitialTurn = (context?.history?.filter(h => h.role === 'assistant').length ?? 0) === 0;
    const formatPolicyReply = (policyText: string) => {
      if (isInitialTurn) {
        return `${TEMPLATES.firstContactGreetingHeader({ isIslamic })}\n\n${policyText}`;
      }
      return policyText;
    };

    // =========================================================================
    // PRIORITY 3: IZIN BERTANYA / KONSULTASI AWAL
    // Sambut ramah secara terbuka, DILARANG menutup obrolan
    // =========================================================================
    const isConsultationInquiry = /\b(mau\s+tanya-?tanya|boleh\s+tanya|bisa\s+konsultasi|mau\s+konsultasi|tanya\s+dulu|konsul\s+dulu)\b/i.test(rawText);
    if (isConsultationInquiry && !rawText.includes('ongkir') && !rawText.includes('harga') && extraction.symptoms.length === 0) {
      const greetingHeader = isIslamic ? 'Waalaikumsalam Bunda! ✨' : 'Halo Bunda! ✨';
      return {
        action: 'RESOLVE_LOCATION_AND_DELIVERY',
        reason: 'Customer izin konsultasi -> Sambut ramah dan tanyakan kebutuhan perawatan.',
        updatedSlate,
        shouldSendPricelistImage: false,
        deterministicTemplateReply: `${greetingHeader}\nTentu boleh sekali, Bunda! 😊 Mau tanya seputar perawatan apa untuk si kecil atau Bunda? Silakan, kami siap bantu jelaskan yaa 🤗`,
      };
    }

    // =========================================================================
    // PRIORITY 2B: PERTANYAAN KEBIJAKAN OPERASIONAL DETERMINISTIK (0 Token)
    // =========================================================================

    // A. Kebijakan Transport / Ongkir Multi-Anak
    if (/\b(2\s*anak|dua\s*anak|3\s*anak|bunda\s*(dan|\+)\s*(anak|bayi)|ongkir.*(1\s*kali|satu\s*kali|dihitung\s*satu))\b/i.test(rawText) && (rawText.includes('ongkir') || rawText.includes('transport'))) {
      return {
        action: 'RESOLVE_LOCATION_AND_DELIVERY',
        reason: 'Customer bertanya kebijakan ongkir multi-anak/treatment -> Kirim template resmi.',
        updatedSlate,
        shouldSendPricelistImage: false,
        deterministicTemplateReply: formatPolicyReply(TEMPLATES.multiChildTransportPolicy()),
      };
    }

    // B. Kebijakan Metode Pembayaran
    if (/\b(metode\s*pembayaran|bayar\s*lewat|bisa\s*transfer|bisa\s*cash|bisa\s*qris|bayar\s*di\s*tempat|cod)\b/i.test(rawText) && (rawText.includes('bayar') || rawText.includes('transfer') || rawText.includes('pembayaran'))) {
      return {
        action: 'RESOLVE_LOCATION_AND_DELIVERY',
        reason: 'Customer bertanya metode pembayaran -> Kirim template metode pembayaran resmi.',
        updatedSlate,
        shouldSendPricelistImage: false,
        deterministicTemplateReply: formatPolicyReply(TEMPLATES.paymentMethodPolicy()),
      };
    }

    // C. Kebijakan Kualifikasi Terapis (Bidan Resmi STR)
    if (
      /\b(terapisnya\s+bidan|apakah\s+bidan\s*(resmi|asli)?|bidannya\s+(resmi|asli|punya\s+str)|punya\s+str|kualifikasi\s+terapis|lulusan\s+kebidanan|tersertifikasi)\b/i.test(rawText) &&
      (rawText.includes('terapis') || rawText.includes('str') || rawText.includes('resmi') || rawText.includes('asli') || rawText.includes('lulusan') || rawText.includes('sertifik'))
    ) {
      return {
        action: 'RESOLVE_LOCATION_AND_DELIVERY',
        reason: 'Customer bertanya kualifikasi bidan/terapis -> Kirim template kualifikasi resmi.',
        updatedSlate,
        shouldSendPricelistImage: false,
        deterministicTemplateReply: formatPolicyReply(TEMPLATES.therapistQualificationPolicy()),
      };
    }

    // D. Kebijakan Jangkauan Area Umum / Tanya Jangkauan Kota ("ke surabaya bisa ?", "bisa ke sidoarjo ?")
    const isCoverageQuery =
      /\b(melayani\s*(daerah|area|wilayah)|jangkauan\s*(kemana|mana)|bisa\s*ke\s*mana\s*aja|(?:ke|daerah|area|wilayah)\s+(?:sby|surabaya|sidoarjo|sda|gresik)\s+(?:bisa|melayani)|(?:bisa|melayani)\s+ke\s+(?:sby|surabaya|sidoarjo|sda|gresik)|(?:ke\s+)?(?:sby|surabaya|sidoarjo|sda)\s+(?:bisa|bisa\s+gak|bisa\s+kah|bisa\s+ya))\b/i.test(rawText);

    const isGenericCityCoverageOnly =
      !extraction.locationText ||
      ['sby', 'surabaya', 'sidoarjo', 'sda', 'gresik'].includes((extraction.locationText || '').toLowerCase().trim());

    if (isCoverageQuery && isGenericCityCoverageOnly && extraction.symptoms.length === 0 && !extraction.treatmentReferenced) {
      return {
        action: 'RESOLVE_LOCATION_AND_DELIVERY',
        reason: 'Customer bertanya area jangkauan umum / jangkauan kota -> Kirim template area operasional resmi.',
        updatedSlate,
        shouldSendPricelistImage: false,
        deterministicTemplateReply: formatPolicyReply(TEMPLATES.coverageAreaPolicy()),
      };
    }

    // E. Pertanyaan Alamat / Homebase Klinik
    const isClinicOriginQuery =
      extraction.intents.includes('ask_clinic_origin') ||
      /\b(?:ini\s+)?(?:daerah|asal|lokasi|posisi|base)\s*(?:mana|mn|mna|dmana|dimana)\b/i.test(rawText) ||
      /\b((?:alamat|lokasi|posisi)\s*(?:nya)?\s+(?:sby|surabaya|sidoarjo|dimana|di\s*mana|mana)|(?:lokasi|alamat|posisi)\s+klinik(?:nya)?(?:\s+ada)?\s+(?:dimana|di\s*mana|mana)|klinik(?:nya)?\s+(?:dimana|di\s*mana|mana|ada\s+dimana|ada\s+di\s*mana)|dari\s+mana)\b/i.test(rawText);

    const isGenericCityLocationOnly =
      !extraction.locationText ||
      /^(?:sby|surabaya|sidoarjo|sda|gresik)(?:\s+(?:barat|timur|selatan|utara|pusat|kota|pinggiran))?$/i.test((extraction.locationText || '').trim()) ||
      ['sby', 'surabaya', 'sidoarjo', 'sda'].includes((extraction.locationText || '').toLowerCase().trim());

    if (isClinicOriginQuery && isGenericCityLocationOnly && extraction.symptoms.length === 0) {
      return {
        action: 'RESOLVE_LOCATION_AND_DELIVERY',
        reason: 'Customer bertanya lokasi/asal klinik -> Kirim kebijakan homecare & tanyakan alamat rumah Bunda.',
        updatedSlate,
        shouldSendPricelistImage: false,
        deterministicTemplateReply: formatPolicyReply(TEMPLATES.clinicOriginPolicy()),
      };
    }

    // =========================================================================
    // PRIORITY 2C: INITIAL LEAD GREETING / SAPAAN PEMBUKA IKLAN PERTAMA
    // Mengirim template greeting resmi Kala Spa jika pesan pertama customer adalah sapaan umum/lead iklan
    // =========================================================================
    const isInitialConversation =
      (context?.history?.length ?? 0) === 0 ||
      !updatedSlate.isLocationConfirmed ||
      updatedSlate.projectedState === ConversationState.INITIAL;

    const hasSpecificClinicalOrPricingQuestion =
      extraction.intents.includes('ask_price') ||
      extraction.intents.includes('consult_symptom') ||
      extraction.intents.includes('ask_schedule') ||
      extraction.intents.includes('select_treatment') ||
      Boolean(extraction.treatmentReferenced) ||
      extraction.childAgeMonths !== null ||
      extraction.symptoms.length > 0 ||
      /\b(berapa|brp|harga|tarif|biaya|ongkir|pricelist|usia|umur|\d+\s*(?:bln|bulan|thn|tahun)|jadwal|slot|kapan|jam\s*\d+|besok|lusa)\b/i.test(rawText);

    const isPureLeadOpener =
      /^(?:halo|hola|hi|hei|p|assalamu'?alaikum|assalamualaikum|(?:selamat|selmat|slmt|met)\s+(?:pagi|siang|sore|malam)|pagi|siang|sore|malam|permisi|bisa|bisa\s+kah|bisa\s+gak|bisa\s+ya|apakah\s+bisa|bisa\s+homecare|mau\s+tanya|info|info\s+lengkap|tertarik|min|bunda|admin)[!.\s?]*$/i.test(cleanText) ||
      /\b(tertarik\s+dengan\s+layanan|layanan\s+homecare|home\s*treatment|home\s*service|info\s+lengkap|mau\s+tanya\s+layanan|tanya\s+layanan|mau\s+reservasi|mau\s+booking|bisa\s+reservasi|bisa\s+booking|cara\s+reservasi|cara\s+booking|bagaimana\s+caranya|gimana\s+caranya|alur\s+reservasi|alur\s+booking|mau\s+pesan|cara\s+pesan|info\s+reservasi)\b/i.test(rawText);

    const isLeadGreeting =
      cleanText.length > 0 &&
      isInitialConversation &&
      !updatedSlate.isOutOfCoverage &&
      !hasSpecificClinicalOrPricingQuestion &&
      !extraction.locationText &&
      !extraction.treatmentReferenced &&
      isPureLeadOpener;

    if (isLeadGreeting) {
      return {
        action: 'RESOLVE_LOCATION_AND_DELIVERY',
        reason: 'Sapaan pembuka lead pertama -> Kirim template greeting resmi Kala Spa.',
        updatedSlate,
        shouldSendPricelistImage: false,
        deterministicTemplateReply: TEMPLATES.greeting({ isIslamic }),
      };
    }

    // =========================================================================
    // PRIORITY 2D: Tanya Suami / Perlu Waktu Pertimbangan
    // =========================================================================
    if (
      /\b(tanya|diskusi|ngobrol|rembuk|runding)\w*\s+(?:sama|dengan)?\s*(suami|keluarga|ayah|pak\s*su)\b/i.test(rawText) ||
      /\b(pikir|pikir-pikir|nunggu)\s*(dulu)?\b/i.test(rawText)
    ) {
      return {
        action: 'RESOLVE_LOCATION_AND_DELIVERY',
        reason: 'Customer izin diskusi dengan suami/keluarga -> Kirim template respon hangat tanpa mendesak.',
        updatedSlate,
        shouldSendPricelistImage: false,
        deterministicTemplateReply: `Baik Bunda, silakan didiskusikan dulu dengan suami yaa 😊 Jika sudah siap atau ada yang ingin ditanyakan lagi seputar treatment, silakan hubungi kami kembali ya Bunda. Kami siap membantu 🤗`,
      };
    }

    // =========================================================================
    // PRIORITY 2E: NOT INTERESTED / PENOLAKAN HALUS (Tidak Jadi Total)
    // HANYA dipicu jika customer benar-benar membatalkan / tidak berminat sama sekali.
    // DILARANG dipicu jika customer hanya "change of mind" / ganti lokasi / ganti hari / ganti treatment (misal "gak jadi di wonokromo, di berbek aja")
    // =========================================================================
    const hasAlternativeOrCorrection =
      /\b(?:di|ke|pindah|ganti|jadinya|maksudnya|mau|ambil|paket|besok|hari|lusa|jam|aja|saja)\b/i.test(rawText) ||
      Boolean(extraction.locationText) ||
      Boolean(extraction.treatmentReferenced) ||
      Boolean(extraction.preferredDateText);

    const isNotInterested =
      !hasAlternativeOrCorrection &&
      /\b(tidak\s+jadi|gak\s+jadi|nggak\s+jadi|gajadi|belum\s+berminat|kemahalan\s*(kak|bund|min)?|batal\s+aja|cancel\s+aja|belum\s+butuh)\b/i.test(rawText);

    if (isNotInterested) {
      return {
        action: 'NOT_INTERESTED_COMPLETED',
        reason: 'Customer menyatakan tidak jadi / belum berminat -> Kirim penutup santun.',
        updatedSlate,
        shouldSendPricelistImage: false,
        deterministicTemplateReply: TEMPLATES.notInterestedReply(),
      };
    }

    // =========================================================================
    // PRIORITY 5: RESOLUSI LOKASI BARU & KALKULASI ONGKIR DETERMINISTIK
    // Dipicu jika ada locationText/streetDetail baru DAN (lokasi belum terkonfirmasi ATAU ada pergantian lokasi eksplisit)
    // =========================================================================
    const isExplicitLocationChange = /\b(ganti|pindah|salah|ubah|bukan\s+di|yang\s+bener)\b/i.test(rawText);

    // Deteksi apakah customer sedang mengirimkan teks lokasi/alamat pada pesan ini
    const hasLocationInCurrentMessage =
      (Boolean(extraction.locationText) && !['sby', 'surabaya', 'sidoarjo', 'sda'].includes((extraction.locationText || '').toLowerCase().trim())) ||
      Boolean(extraction.streetDetail) ||
      extraction.intents.includes('provide_location') ||
      extraction.intents.includes('supplement_address');

    // Apakah customer sedang bertanya hal klinis / treatment / jadwal / harga?
    const hasClinicalOrOtherInquiry =
      extraction.symptoms.length > 0 ||
      Boolean(extraction.treatmentReferenced) ||
      extraction.intents.includes('consult_symptom') ||
      extraction.intents.includes('select_treatment') ||
      extraction.intents.includes('ask_price') ||
      extraction.intents.includes('ask_schedule') ||
      extraction.intents.includes('request_booking') ||
      /\b(pijat|treatment|batuk|pilek|grok|demam|kolik|sembelit|usia|umur|harga|biaya|kapan|bisa|jadwal|slot)\b/i.test(rawText);

    // Double Ongkir Guard: Jika lokasi SUDAH terkonfirmasi DAN bot baru saja mengirimkan ongkir dalam 45s terakhir
    // HANYA dipicu jika customer mengirim ulang lokasi murni YANG SAMA TANPA pertanyaan klinis / treatment / jadwal
    const currentLocText = (extraction.locationText || '').toLowerCase().trim();
    const storedKelurahan = (updatedSlate.kelurahan || '').toLowerCase().trim();
    const storedKecamatan = (updatedSlate.kecamatan || '').toLowerCase().trim();
    const isSameLocation =
      Boolean(currentLocText) &&
      (currentLocText === storedKelurahan ||
        currentLocText === storedKecamatan ||
        (Boolean(storedKelurahan) && currentLocText.includes(storedKelurahan)) ||
        (Boolean(storedKecamatan) && currentLocText.includes(storedKecamatan)));

    const isDifferentLocation = Boolean(currentLocText) && !isSameLocation;

    const historyList = (context as any)?.history || [];
    const lastAssistant = historyList.slice().reverse().find((m: any) => m.role === 'assistant');
    const isRecentOngkirSent =
      lastAssistant &&
      (lastAssistant.content.includes('ongkir') || lastAssistant.content.includes('jarak')) &&
      ((lastAssistant as any).createdAt
        ? Date.now() - new Date((lastAssistant as any).createdAt).getTime() < 45000
        : true);

    if (
      updatedSlate.isLocationConfirmed &&
      !updatedSlate.isOutOfCoverage &&
      hasLocationInCurrentMessage &&
      isSameLocation &&
      !hasClinicalOrOtherInquiry &&
      isRecentOngkirSent &&
      !isExplicitLocationChange
    ) {
      return {
        action: 'RESOLVE_LOCATION_AND_DELIVERY',
        reason: 'Lokasi sama dikirim ulang dalam waktu singkat tanpa pertanyaan lain -> Cegah spam template ongkir dobel.',
        updatedSlate,
        shouldSendPricelistImage: false,
        deterministicTemplateReply: `Baik Bunda, lokasi di ${updatedSlate.kelurahan} sudah kami simpan yaa 😊\n\nRencana mau treatment apa bunda ?🤗`,
      };
    }

    const shouldResolveLocation =
      hasLocationInCurrentMessage &&
      (!updatedSlate.isLocationConfirmed || updatedSlate.isOutOfCoverage || isExplicitLocationChange || isDifferentLocation);

    if (shouldResolveLocation) {
      try {
        const { geocodingService } = await import('../integrations/google-maps/geocoding');
        const { deliveryService } = await import('../services/delivery.service');

        // Strategi Pencarian Bertingkat:
        // 1. Composite query: streetDetail + locationText
        // 2. Full raw incoming text
        // 3. locationText saja
        const compositeQuery = extraction.streetDetail
          ? `${extraction.streetDetail} ${extraction.locationText || ''}`.trim()
          : (extraction.locationText || rawText);

        let resolved = await geocodingService.geocodeText(compositeQuery);
        if (!resolved.isPrecise && rawText) {
          const rawResolved = await geocodingService.geocodeText(rawText);
          if (rawResolved.isPrecise) {
            resolved = rawResolved;
          }
        }
        if (!resolved.isPrecise && extraction.locationText) {
          const locResolved = await geocodingService.geocodeText(extraction.locationText);
          if (locResolved.isPrecise) {
            resolved = locResolved;
          }
        }

        // Smart Disambiguation: Jika hasil geocoding mengembalikan daftar ambiguity (misal nama kecamatan),
        // cek apakah ada nama kelurahan yang spesifik disebut di query/pesan customer
        if (!resolved.lat && (resolved as any).ambiguityResults && (resolved as any).ambiguityResults.length > 0) {
          const ambiguityList: any[] = (resolved as any).ambiguityResults;
          const queryLower = `${compositeQuery} ${rawText}`.toLowerCase();
          
          const hasExplicitKelurahanPrefix = /\b(?:kelurahan|desa|kel|ds)\b/i.test(queryLower);
          const hasStreetAddress = Boolean(extraction.streetDetail);

          const matchedKelurahan = ambiguityList.find((item: any) => {
            if (!item.Kelurahan_Desa) return false;
            const kelLower = item.Kelurahan_Desa.toLowerCase().trim();
            const kecLower = (item.Kecamatan || '').toLowerCase().trim();

            if (kelLower !== kecLower) {
              return queryLower.includes(kelLower);
            }
            // Jika nama kelurahan sama persis dengan nama kecamatan (misal "Jambangan", "Waru", "Rungkut")
            // hanya cocok jika customer secara eksplisit menyebut "kelurahan jambangan" atau menyertakan detail jalan/perumahan
            return (hasExplicitKelurahanPrefix || hasStreetAddress) && queryLower.includes(kelLower);
          });

          if (matchedKelurahan && matchedKelurahan.Koordinat) {
            const parts = matchedKelurahan.Koordinat.split(',').map((p: string) => parseFloat(p.trim()));
            if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
              resolved = {
                isPrecise: true,
                kelurahan: matchedKelurahan.Kelurahan_Desa,
                kecamatan: matchedKelurahan.Kecamatan,
                kota: matchedKelurahan.Kabupaten_Kota || 'Surabaya',
                lat: parts[0],
                lng: parts[1],
                formattedAddress: `${matchedKelurahan.Kelurahan_Desa}, Kec. ${matchedKelurahan.Kecamatan}, ${matchedKelurahan.Kabupaten_Kota}`,
              };
            }
          } else {
            // Tidak ada kelurahan spesifik -> Input adalah nama kecamatan/wilayah luas yang ambigu (misal "Jambangan", "Waru", "Rungkut")
            const kecName = ambiguityList[0]?.Kecamatan || resolved.matchedSpan || extraction.locationText || 'tersebut';
            const kotaName = ambiguityList[0]?.Kabupaten_Kota || resolved.kota || null;
            const lowerSpan = (resolved.matchedSpan || kecName).toLowerCase().trim();
            const isCity = ['sidoarjo', 'surabaya', 'sda', 'sby', 'gresik'].includes(lowerSpan) || lowerSpan.includes('kabupaten') || lowerSpan.includes('kota');

            return {
              action: 'RESOLVE_LOCATION_AND_DELIVERY',
              reason: `Lokasi yang diinput merupakan nama kecamatan/wilayah luas (${kecName}) tanpa kelurahan spesifik -> Minta detail kelurahan.`,
              updatedSlate,
              shouldSendPricelistImage: false,
              deterministicTemplateReply: TEMPLATES.askKelurahanAmbiguous({
                kecamatanName: kecName,
                cityName: kotaName || kecName,
                isCity,
                options: ambiguityList,
              }),
            };
          }
        }

        // Jika lokasi yang disebutkan merupakan kuadran wilayah luas / nama kota umum tanpa kelurahan spesifik:
        const locLower = (extraction.locationText || compositeQuery || rawText || '').toLowerCase().trim();
        const isGenericCityOrQuadrant =
          /^(?:sidoarjo|surabaya|sda|sby|gresik)(?:\s+(?:barat|timur|selatan|utara|pusat|kota|pinggiran))?$/i.test(locLower) ||
          ['sidoarjo', 'surabaya', 'sda', 'sby', 'gresik'].includes(locLower);

        if ((isGenericCityOrQuadrant || !resolved.isPrecise) && !extraction.streetDetail && !resolved.kelurahan) {
          const areaDisplay = extraction.locationText || compositeQuery || 'area tersebut';
          return {
            action: 'RESOLVE_LOCATION_AND_DELIVERY',
            reason: `Lokasi yang diinput (${areaDisplay}) merupakan kawasan luas/umum tanpa kelurahan spesifik -> Minta detail kelurahan.`,
            updatedSlate,
            shouldSendPricelistImage: false,
            deterministicTemplateReply: `Boleh diinfokan detail kelurahan atau desa di ${areaDisplay} Bunda agar kami bantu cekkan ongkir presisinya? 😊`,
          };
        }

        if (!resolved.isPrecise || !resolved.lat || !resolved.lng) {
          const areaDisplay = extraction.locationText || compositeQuery || 'area tersebut';
          return {
            action: 'RESOLVE_LOCATION_AND_DELIVERY',
            reason: `Lokasi yang diinput (${areaDisplay}) belum terdeteksi presisi ke tingkat kelurahan/desa -> Minta detail kelurahan.`,
            updatedSlate,
            shouldSendPricelistImage: false,
            deterministicTemplateReply: `Boleh diinfokan detail kelurahan atau desa di ${areaDisplay} Bunda agar kami bantu cekkan ongkir presisinya? 😊`,
          };
        }

        if (resolved.isPrecise && resolved.lat && resolved.lng) {
          const delivery = await deliveryService.calculateDelivery({ lat: resolved.lat, lng: resolved.lng });

          updatedSlate.kelurahan = resolved.kelurahan || resolved.kecamatan || extraction.locationText || 'Surabaya';
          updatedSlate.kecamatan = resolved.kecamatan || null;
          updatedSlate.kota = resolved.kota || null;
          updatedSlate.lat = resolved.lat;
          updatedSlate.lng = resolved.lng;
          updatedSlate.distanceKm = Number(delivery.distanceKm.toFixed(2));
          updatedSlate.ongkirFee = delivery.normalPrice;
          updatedSlate.ongkirPromoFee = delivery.promoPrice;
          if (delivery.isOutOfCoverage) {
            updatedSlate.isLocationConfirmed = false;
            updatedSlate.isOutOfCoverage = true;
            updatedSlate.projectedState = SlateStore.computeProjectedState(updatedSlate);
            return {
              action: 'REJECT_OUT_OF_COVERAGE',
              reason: `Jarak lokasi (${updatedSlate.distanceKm} km) melebihi batas jangkauan layanan (maks 30 km).`,
              updatedSlate,
              shouldSendPricelistImage: false,
              deterministicTemplateReply: formatPolicyReply(TEMPLATES.outOfCoverage({
                distanceKm: updatedSlate.distanceKm || 30,
              })),
            };
          }

          updatedSlate.isLocationConfirmed = true;
          updatedSlate.isOutOfCoverage = false;
          updatedSlate.projectedState = SlateStore.computeProjectedState(updatedSlate);

          // Kirim pricelist image jika belum pernah terkirim
          const shouldSendPricelistImage = !updatedSlate.pricelistSent;
          if (shouldSendPricelistImage) {
            updatedSlate.pricelistSent = true;
          }

          // Jika customer HANYA mengirimkan lokasi (maupun disertai pertanyaan ongkir/kena berapa),
          // gunakan TEMPLATES.ongkirInfo deterministik resmi (SOP Kala Spa) yang kontekstual
          const isPureLocationMessage =
            !extraction.intents.includes('consult_symptom') &&
            !extraction.intents.includes('ask_clinic_origin') &&
            extraction.symptoms.length === 0;

          if (isPureLocationMessage) {
            // Zero hardcode: ambil treatment aktif dari state/riwayat, tanpa menebak paket
            const candidateTreatmentName =
              updatedSlate.selectedTreatmentName ||
              (context as any)?.lastDiscussedTreatment ||
              undefined;
            const preferredDate = extraction.preferredDateText || updatedSlate.preferredDate || undefined;

            return {
              action: 'RESOLVE_LOCATION_AND_DELIVERY',
              reason: `Lokasi terkonfirmasi (${updatedSlate.kelurahan}, ${updatedSlate.distanceKm} km, ongkir promo Rp ${updatedSlate.ongkirPromoFee?.toLocaleString('id-ID')}) -> Kirim template ongkir resmi kontekstual.`,
              updatedSlate,
              shouldSendPricelistImage,
              deterministicTemplateReply: TEMPLATES.ongkirInfo({
                distanceKm: updatedSlate.distanceKm || 0,
                normalPrice: updatedSlate.ongkirFee || 0,
                promoPrice: updatedSlate.ongkirPromoFee || 0,
                candidateTreatmentName,
                preferredDate,
              }),
            };
          }

          return {
            action: 'GENERATE_AI_RESPONSE',
            reason: `Lokasi terkonfirmasi (${updatedSlate.kelurahan}, ${updatedSlate.distanceKm} km, ongkir promo Rp ${updatedSlate.ongkirPromoFee?.toLocaleString('id-ID')}) -> Lanjutkan ke AI Response Generation dengan Grounding Jarak & Ongkir.`,
            updatedSlate,
            shouldSendPricelistImage,
          };
        }
      } catch (geoErr: any) {
        console.warn('[DECISION MATRIX GEOCODING ERROR]', geoErr.message);
      }
    }

    // =========================================================================
    // PRIORITY 6: JANGKAUAN MELEBIHI BATAS WILAYAH (Out of Coverage)
    // =========================================================================
    if (updatedSlate.isOutOfCoverage) {
      return {
        action: 'REJECT_OUT_OF_COVERAGE',
        reason: 'Lokasi customer berada di luar wilayah operasional klinik.',
        updatedSlate,
        shouldSendPricelistImage: false,
        deterministicTemplateReply: formatPolicyReply(TEMPLATES.outOfCoverage({
          distanceKm: updatedSlate.distanceKm || 30,
        })),
      };
    }



    // =========================================================================
    // PRIORITY 7: PERCAKAPAN RESERVASI & BOOKING READY
    // Alirkan ke ReplyGenerator (LLM 2) untuk menyusun jawaban empatik & smart form
    // =========================================================================
    const isBookingReady =
      updatedSlate.isLocationConfirmed &&
      Boolean(updatedSlate.selectedTreatmentName) &&
      (Boolean(updatedSlate.preferredDate) || extraction.intents.includes('request_booking') || extraction.intents.includes('ask_schedule'));

    if (isBookingReady && !updatedSlate.reservationFormSent) {
      try {
        const { fireCapiEvent } = await import('../services/capi.service');
        const { DEFAULT_TENANT_ID } = await import('../config/tenant');
        fireCapiEvent({
          eventName: 'InitiateCheckout',
          customer: { id: updatedSlate.customerId, phone: updatedSlate.phone } as any,
          tenantId: context?.tenantId || updatedSlate.tenantId || DEFAULT_TENANT_ID,
          customData: {
            source: 'BOT_FORM_SENT',
            treatment: updatedSlate.selectedTreatmentName || undefined,
          },
        });
      } catch (capiErr: any) {
        console.warn('[CAPI] InitiateCheckout (BOT_FORM_SENT) skipped in decision matrix:', capiErr.message);
      }
    }

    // Jika customer SECARA EKSPLISIT meminta teks format saja (misal: "minta form booking", "kirim formatnya")
    const isExplicitFormOnlyRequest = /\b(minta|kirim|mana|minta\s+teks)\s+(format|form|list)\s*(reservasi|booking)?\b/i.test(rawText);
    if (isExplicitFormOnlyRequest) {
      const reservationForm = TEMPLATES.reservationFormRequest({
        name: updatedSlate.name || undefined,
        address: updatedSlate.streetDetail
          ? `${updatedSlate.streetDetail}, ${updatedSlate.kelurahan}`
          : updatedSlate.kelurahan || undefined,
        kecamatan: updatedSlate.kecamatan || undefined,
        kota: updatedSlate.kota || undefined,
        phone: updatedSlate.phone || undefined,
        bookingDate: updatedSlate.preferredDate || undefined,
        treatmentBaby: updatedSlate.selectedTreatmentName || undefined,
      });

      updatedSlate.reservationFormSent = true;
      return {
        action: 'SEND_RESERVATION_FORM',
        reason: 'Customer secara eksplisit meminta format reservasi -> Mengirim format reservasi.',
        updatedSlate,
        shouldSendPricelistImage: false,
        deterministicTemplateReply: reservationForm,
      };
    }

    // =========================================================================
    // PRIORITY 8: KONSULTASI / FAQ / PERCAKAPAN UMUM (Single-Pass AI Generator)
    // =========================================================================
    return {
      action: 'GENERATE_AI_RESPONSE',
      reason: isBookingReady
        ? 'Customer siap reservasi / tanya bundling -> Rangkai balasan natural & smart form via ReplyGenerator.'
        : 'Percakapan natural/konsultasi keluhan/tanya harga -> Generate via Single-Pass LLM.',
      updatedSlate,
      shouldSendPricelistImage: false,
    };
  }
}
