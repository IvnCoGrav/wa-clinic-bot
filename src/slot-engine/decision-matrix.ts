import { CustomerSlate, ExtractedEntities, DecisionResult } from './types';
import { SlateStore } from './slate-store';
import { TEMPLATES } from '../config/persona';
import { ConversationState } from '@prisma/client';
import { treatmentCatalogService } from '../services/treatment-catalog.service';

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

    // Ongkir, Location & Core Service guard: jangan bajak pertanyaan ongkir/lokasi/home treatment sebagai layanan asing
    const hasOngkirLocationGuard =
      /\b(ongkir|ongkos\s*kirim|biaya\s*kirim|jarak|lokasi|home\s*(?:treatment|service|care))\b/i.test(rawText) || Boolean(extraction.locationText);

    const isUnlistedServiceQuery =
      !isPostVaccineConsultation &&
      !hasOngkirLocationGuard &&
      (extraction.intents.includes('ask_unlisted_service') ||
        /\b(mandikan\s*bayi|mandiin\s*bayi|jasa\s*mandi|paket\s*mandi|baby\s*sitting|penitipan\s*(anak|bayi)|tindik(\s*telinga)?|jasa\s*(?:imunisasi|vaksin)|layanan\s*(?:imunisasi|vaksin)|suntik\s*(?:imunisasi|vaksin)|sunat|rawat\s*tali\s*pusat|rawat\s*luka|fisioterapi|paket\s*newborn|perawatan\s*newborn)\b/i.test(rawText));

    // Catalog Guard: if the query actually matches an active catalog service, redirect to AI (not escalate)
    if (isUnlistedServiceQuery) {
      const activeServices = treatmentCatalogService.getAllServices(true);
      const matchesCatalog = activeServices.some((svc) => {
        const nameLower = svc.name.toLowerCase();
        // Exact name match or multi-word name match (all words must appear)
        if (rawText.includes(nameLower)) return true;
        const words = nameLower.split(/\s+/).filter((w) => w.length >= 4);
        return words.length >= 2 && words.every((w) => rawText.includes(w));
      });
      if (matchesCatalog) {
        // Customer is asking about a real catalog service — let AI answer with FAQ/catalog context
        return {
          action: 'GENERATE_AI_RESPONSE',
          reason: 'Customer menyebut layanan yang terdaftar di katalog aktif -> AI menjawab dengan FAQ/katalog.',
          updatedSlate,
          shouldSendPricelistImage: false,
        };
      }
    }

    if (isUnlistedServiceQuery) {
      updatedSlate.isHumanHandling = true;
      updatedSlate.humanHandlingReason = 'unlisted_service';
      return {
        action: 'ESCALATE_HUMAN_UNLISTED_SERVICE',
        reason: 'Customer menanyakan layanan di luar pricelist/katalog resmi -> Handoff ke CS dengan template sopan.',
        updatedSlate,
        shouldSendPricelistImage: false,
        deterministicTemplateReply: TEMPLATES.unlistedServiceHandoff(),
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

    // C. Kebijakan Kualifikasi Terapis (Bidan Resmi STR) — fast-exit, degradasi anggun jika ada keluhan/jadwal
    if (
      /\b(terapisnya\s+bidan|apakah\s+bidan\s*(resmi|asli)?|bidannya\s+(resmi|asli|punya\s+str)|punya\s+str|kualifikasi\s+terapis|lulusan\s+kebidanan|tersertifikasi)\b/i.test(rawText) &&
      (rawText.includes('terapis') || rawText.includes('str') || rawText.includes('resmi') || rawText.includes('asli') || rawText.includes('lulusan') || rawText.includes('sertifik')) &&
      extraction.symptoms.length === 0 && !extraction.treatmentReferenced && !extraction.preferredDateText && !extraction.intents.includes('ask_schedule') && !extraction.intents.includes('consult_symptom')
    ) {
      return {
        action: 'RESOLVE_LOCATION_AND_DELIVERY',
        reason: 'Customer bertanya kualifikasi bidan/terapis -> Kirim template kualifikasi resmi.',
        updatedSlate,
        shouldSendPricelistImage: false,
        deterministicTemplateReply: formatPolicyReply(TEMPLATES.therapistQualificationPolicy()),
      };
    }

    // C2. Rekening bank resmi — fast-exit, degradasi anggun jika ada konsultasi/jadwal
    if (
      /\b(rekening|no\.?\s*rekening|transfer\s*(ke|bank)?|bca|mandiri|bri|bank\s*bca|bank\s*mandiri)\b/i.test(rawText) &&
      extraction.symptoms.length === 0 && !extraction.treatmentReferenced && !extraction.preferredDateText && !extraction.intents.includes('ask_schedule') && !extraction.intents.includes('consult_symptom')
    ) {
      return {
        action: 'RESOLVE_LOCATION_AND_DELIVERY',
        reason: 'Rekening query pure operational -> fast-exit deterministik (0ms, 0 token).',
        updatedSlate,
        shouldSendPricelistImage: false,
        deterministicTemplateReply: formatPolicyReply(`Untuk pembayaran bisa via Transfer Bank BCA, Mandiri, BRI, QRIS Universal, atau Cash setelah treatment selesai ya Bunda 😊\nRekening resmi BCA a.n Kala Moms and Baby Spa akan diinfokan Admin saat konfirmasi jadwal ya Bunda.`),
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
      /\b(?:ini\s+)?(?:daerah|asal|lokasi|posisi|base)\s*(?:mana|mn|mna|dmana|dimana|dmn)\b/i.test(rawText) ||
      /\b((?:alamat|lokasi|posisi)\s*(?:nya)?\s+(?:sby|surabaya|sidoarjo|dimana|di\s*mana|mana|dmn)|(?:lokasi|alamat|posisi)\s+klinik(?:nya)?(?:\s+ada)?\s+(?:dimana|di\s*mana|mana|dmn)|klinik(?:nya)?\s+(?:dimana|di\s*mana|mana|dmn|ada\s+dimana|ada\s+di\s*mana)|dari\s+mana)\b/i.test(rawText) ||
      /\b(?:untuk\s+)?(?:lokasi|alamat|klinik|posisi)\s*(?:nya)?\s*(?:di\s*mana|dimana|dmn|dmana|kmn|mana)\b/i.test(rawText);

    const isGenericCityLocationOnly =
      !extraction.locationText ||
      /^(?:sby|surabaya|sidoarjo|sda|gresik)(?:\s+(?:barat|timur|selatan|utara|pusat|kota|pinggiran))?$/i.test((extraction.locationText || '').trim()) ||
      ['sby', 'surabaya', 'sidoarjo', 'sda'].includes((extraction.locationText || '').toLowerCase().trim());

    if (isClinicOriginQuery && (isGenericCityLocationOnly || !updatedSlate.isLocationConfirmed) && extraction.symptoms.length === 0 && !extraction.treatmentReferenced && !extraction.preferredDateText && !extraction.intents.includes('ask_schedule') && !extraction.intents.includes('consult_symptom')) {
      updatedSlate.kelurahan = null;
      updatedSlate.isLocationConfirmed = false;
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
      (extraction.intents.includes('select_treatment') && Boolean(extraction.treatmentReferenced)) ||
      Boolean(extraction.treatmentReferenced) ||
      extraction.childAgeMonths !== null ||
      extraction.symptoms.length > 0 ||
      /\b(berapa|brp|harga|tarif|biaya|ongkir|pricelist|usia|umur|\d+\s*(?:bln|bulan|thn|tahun)|jadwal|slot|kapan|jam\s*\d+|besok|lusa)\b/i.test(rawText);

    // Modular & Robust Lead Greeting Opener Matcher
    const HONORIFICS = '(?:kak+|ka(?:k)?|sis(?:t)?|min|mimin|admin|bun(?:da|d)?|bu(?:nda)?|ibu|bidan|bu\\s+bidan|mbak+|mba|dok(?:ter)?|gan|om|tante|say(?:ang)?)';
    const PARTICLES = '(?:dong|ya(?:a)?|deh|sih|nih|yuk|tolong|mohon|kah|gak|nggak|ta)';
    const GREETINGS = '(?:halo|hola|hai|hi|hei|hey|p+|tes|test|ping|assalamu\\x27?alaikum|assalamualaikum|ass|askum|samlikum|(?:selamat|selmat|slmt|met)\\s+(?:pagi|siang|sore|malam|subuh)|pagi|siang|sore|malam|subuh|permisi|punten|spada)';
    const INQUIRY_ACTIONS = '(?:mau\\s+tanya(?:-?tanya)?|tanya|boleh\\s+tanya|bisa\\s+konsultasi|mau\\s+konsultasi|minta\\s+info|info(?:\\s+lengkap)?|mau\\s+info|tertarik|saya\\s+tertarik|bisa|apakah\\s+bisa|bisa\\s+homecare|melayani\\s+homecare|ada\\s+homecare|bisa\\s+dipanggil|bisa\\s+panggil|homecare|home\\s*treatment|home\\s*service|mau\\s+(?:treatment|treatmen|pijat|massage|spa|reservasi|booking|pesan|order)|bisa\\s+(?:treatment|treatmen|pijat|massage|spa)|treatment|pijat)';
    const TAIL_ELEMENT = `(?:\\s+(?:${HONORIFICS}|${PARTICLES}))*`;

    const isPureLeadOpener =
      new RegExp(`^(?:${GREETINGS}|${INQUIRY_ACTIONS})${TAIL_ELEMENT}(?:\\s+(?:${GREETINGS}|${INQUIRY_ACTIONS})${TAIL_ELEMENT})*[!.\\s?~-]*$`, 'i').test(cleanText) ||
      new RegExp(`^${HONORIFICS}${TAIL_ELEMENT}\\s+(?:${GREETINGS}|${INQUIRY_ACTIONS})${TAIL_ELEMENT}[!.\\s?~-]*$`, 'i').test(cleanText) ||
      /\b(tertarik\s+dengan\s+layanan|layanan\s+homecare|home\s*treatment|home\s*service|info\s+lengkap|mau\s+tanya\s+layanan|tanya\s+layanan|mau\s+reservasi|mau\s+booking|bisa\s+reservasi|bisa\s+booking|cara\s+reservasi|cara\s+booking|bagaimana\s+caranya|gimana\s+caranya|alur\s+reservasi|alur\s+booking|mau\s+pesan|cara\s+pesan|info\s+reservasi|mau\s+treatment|mau\s+pijat|mau\s+massage)\b/i.test(rawText);

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
    // PRIORITY 2F: ACKNOWLEDGMENT / PASIVE RESPONSE GUARD
    // Mencegah bot mengulang 100% kalimat giliran sebelumnya saat customer
    // mengirim konfirmasi pasif ("iya", "baik", "oke", "siap") atau alasan konteks.
    // Jika asisten sudah membahas topik ini, lanjutkan ke langkah berikutnya.
    // =========================================================================
    const passiveAckPatterns = [
      /^(iya|ya|boleh|oke|ok|siap|baik|lah|yuk)$/i,
      /^\s*$/,
    ];
    const isPassiveAcknowledgment = passiveAckPatterns.some((re) => re.test(rawText.trim()));
    
    const lastAssistantMsg = (context?.history?.slice().reverse() || []).find((m: any) => m.role === 'assistant');
    const lastAssistantHadOngkir = lastAssistantMsg && lastAssistantMsg.content && lastAssistantMsg.content.includes('ongkir');
    const lastAssistantHadSchedule = lastAssistantMsg && lastAssistantMsg.content && lastAssistantMsg.content.includes('jadwal');

    if (isPassiveAcknowledgment && lastAssistantHadOngkir) {
      // Customer menjawab "iya"/"baik" setelah bot kirim ongkir -> lanjut ke pemilihan treatment/reservasi
      // BUKAN mengirim ulang ongkir
      if (updatedSlate.isLocationConfirmed && updatedSlate.selectedTreatmentName) {
        return {
          action: 'RESOLVE_LOCATION_AND_DELIVERY',
          reason: 'Customer merespons pasif setelah ongkir terkirim -> Tawarkan format reservasi.',
          updatedSlate,
          shouldSendPricelistImage: false,
          deterministicTemplateReply: `Baik Bunda, kami catat yaa 😊 Mau sekalian kami bantu siapkan format reservasinya? 🤗`,
        };
      }
      if (updatedSlate.isLocationConfirmed && !updatedSlate.selectedTreatmentName && updatedSlate.childAgeMonths) {
        // Sudah punya usia & lokasi, tapi belum treatment -> ajukan treatment
        return {
          action: 'RESOLVE_LOCATION_AND_DELIVERY',
          reason: 'Customer merespons pasif setelah ongkir terkirim -> Ajukan treatment ringkas.',
          updatedSlate,
          shouldSendPricelistImage: false,
          deterministicTemplateReply: `Terima kasih Bunda, kita sudah punya alamat & usia si kecil. Rencana mau treatment apa untuk si kecil? 🤗`,
        };
      }
      // Default: belum ada data lengkap -> serahkan ke AI ringkas
      return {
        action: 'GENERATE_AI_RESPONSE',
        reason: 'Customer merespons pasif -> AI balasan ringkas tanpa repetisi.',
        updatedSlate,
        shouldSendPricelistImage: false,
      };
    }

    if (isPassiveAcknowledgment && lastAssistantHadSchedule) {
      // Customer menjawab "iya"/"oke" setelah bot tanya jadwal -> lanjut ke booking
      if (updatedSlate.isLocationConfirmed && Boolean(updatedSlate.selectedTreatmentName) && Boolean(updatedSlate.preferredDate)) {
        return {
          action: 'RESOLVE_LOCATION_AND_DELIVERY',
          reason: 'Customer merespons pasif setelah jadwal tanya -> Siapkan reservasi.',
          updatedSlate,
          shouldSendPricelistImage: false,
          deterministicTemplateReply: `Baik Bunda, sudah catat jadwal Bunda. Mau sekalian buat reservasi? 🤗`,
        };
      }
      return {
        action: 'GENERATE_AI_RESPONSE',
        reason: 'Customer merespons pasif setelah jadwal -> AI balasan ringkas.',
        updatedSlate,
        shouldSendPricelistImage: false,
      };
    }

    // =========================================================================
    // PRIORITY 2G: KLARIFIKASI BIAYA TRANSPORT (TO-THE-POINT)
    // Jika pelanggan bertanya "free transport?", "kena ongkir berapa?", "include transport?"
    // dan lokasi sudah terkonfirmasi: jawab langsung, TIDAK mengirim ulang template jarak.
    // =========================================================================
    const transportClarificationPatterns = [
      /\b(free transport|transport\s*free|ongkir\s*free|include transport|masuk\s*transport)\b/i,
      /\b(kena ongkir|biaya ongkir|harga ongkir|berapa ongkir)\b/i,
      /\b(include transport|masuk\s*transport|transport\s*apa|transport\s*include)\b/i,
    ];
    const isTransportClarification = transportClarificationPatterns.some((re) => re.test(rawText));

    if (isTransportClarification && updatedSlate.isLocationConfirmed && !updatedSlate.isOutOfCoverage) {
      const ongkirInfo = `${updatedSlate.kelurahan} ± ${updatedSlate.distanceKm} km, ongkir promo Rp ${updatedSlate.ongkirPromoFee?.toLocaleString('id-ID')}`;
      return {
        action: 'GENERATE_AI_RESPONSE',
        reason: 'Customer klarifikasi biaya transport -> AI balasan singkat tanpa mengirim ulang template ongkir.',
        updatedSlate,
        shouldSendPricelistImage: false,
        deterministicTemplateReply: `Untuk biaya treatment belum termasuk transport ya Bunda. Tambahan ongkir ke lokasi ${ongkirInfo} 😊`,
      };
    }

    // =========================================================================
    // PRIORITY 4.9: KOMPARASI DUA LOKASI (Location Comparison)
    // Jika customer membandingkan 2 lokasi ("lebih dekat mana A atau B?")
    // Bot menghitung ongkir & jarak kedua lokasi secara deterministik,
    // lalu memberikan rekomendasi mana yang lebih dekat tanpa mengunci salah satu lokasi.
    // =========================================================================
    const isCompareLocations =
      extraction.intents.includes('compare_locations') ||
      (Array.isArray(extraction.comparisonLocations) && extraction.comparisonLocations.length >= 2);

    if (isCompareLocations) {
      if (!Array.isArray(extraction.comparisonLocations) || extraction.comparisonLocations.length < 2) {
        return {
          action: 'RESOLVE_LOCATION_COMPARISON',
          reason: 'Customer menanyakan perbandingan lokasi tanpa menyebutkan dua titik spesifik -> Tanya opsi lokasi.',
          updatedSlate,
          shouldSendPricelistImage: false,
          deterministicTemplateReply: `Boleh diinfokan kedua opsi lokasi atau kelurahan yang ingin dibandingkan Bunda? Nanti kami bantu hitungkan mana yang lebih dekat dari homebase kami di Waru 😊`,
        };
      }

      try {
        const { geocodingService } = await import('../integrations/google-maps/geocoding');
        const { deliveryService } = await import('../services/delivery.service');

        const [locNameA, locNameB] = extraction.comparisonLocations;

        // Geocode kedua lokasi (dengan fallback konteks kota bila diperlukan)
        let [resA, resB] = await Promise.all([
          geocodingService.geocodeText(locNameA),
          geocodingService.geocodeText(locNameB),
        ]);

        if (!resA.isPrecise && !resA.lat && !(resA as any).ambiguityResults && !/\b(surabaya|sidoarjo|gresik)\b/i.test(locNameA)) {
          const retryA = await geocodingService.geocodeText(`${locNameA}, Surabaya`);
          if (retryA.isPrecise || retryA.lat || (retryA as any).ambiguityResults) resA = retryA;
        }

        if (!resB.isPrecise && !resB.lat && !(resB as any).ambiguityResults && !/\b(surabaya|sidoarjo|gresik)\b/i.test(locNameB)) {
          const retryB = await geocodingService.geocodeText(`${locNameB}, Surabaya`);
          if (retryB.isPrecise || retryB.lat || (retryB as any).ambiguityResults) resB = retryB;
        }

        const extractCoords = (res: any, queryName: string): { lat: number; lng: number } | null => {
          if (res?.lat && res?.lng) {
            return { lat: res.lat, lng: res.lng };
          }
          if (res?.ambiguityResults && Array.isArray(res.ambiguityResults) && res.ambiguityResults.length > 0) {
            const qLower = queryName.toLowerCase().trim();
            // Cari kelurahan yang namanya sama dengan query, atau ambil centroid item pertama
            const match =
              res.ambiguityResults.find(
                (item: any) => (item.Kelurahan_Desa || '').toLowerCase().trim() === qLower
              ) || res.ambiguityResults[0];

            if (match?.Koordinat) {
              const parts = match.Koordinat.split(',').map((p: string) => parseFloat(p.trim()));
              if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                return { lat: parts[0], lng: parts[1] };
              }
            }
          }
          return null;
        };

        const coordsA = extractCoords(resA, locNameA);
        const coordsB = extractCoords(resB, locNameB);

        const formatDisplayName = (raw: string) =>
          raw
            .split(/\s+/)
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');

        if (coordsA && coordsB) {
          const [delA, delB] = await Promise.all([
            deliveryService.calculateDelivery(coordsA),
            deliveryService.calculateDelivery(coordsB),
          ]);

          const distA = delA.distanceKm;
          const distB = delB.distanceKm;

          const itemA = {
            name: formatDisplayName(locNameA),
            distanceKm: distA,
            promoPrice: delA.promoPrice,
            normalPrice: delA.normalPrice,
          };

          const itemB = {
            name: formatDisplayName(locNameB),
            distanceKm: distB,
            promoPrice: delB.promoPrice,
            normalPrice: delB.normalPrice,
          };

          const closer = distA <= distB ? itemA : itemB;
          const further = distA <= distB ? itemB : itemA;

          // JANGAN kunci salah satu lokasi karena customer belum memutuskan
          updatedSlate.isLocationConfirmed = false;

          return {
            action: 'RESOLVE_LOCATION_COMPARISON',
            reason: `Customer membandingkan 2 lokasi: "${locNameA}" (${distA.toFixed(1)} km) vs "${locNameB}" (${distB.toFixed(1)} km) -> Rekomendasi lokasi lebih dekat.`,
            updatedSlate,
            shouldSendPricelistImage: false,
            deterministicTemplateReply: TEMPLATES.locationComparison({ closer, further }),
          };
        } else {
          // Salah satu atau kedua lokasi belum dapat ditentukan koordinatnya
          return {
            action: 'RESOLVE_LOCATION_COMPARISON',
            reason: `Customer membandingkan lokasi "${locNameA}" vs "${locNameB}", namun salah satu/kedua lokasi belum terdeteksi spesifik.`,
            updatedSlate,
            shouldSendPricelistImage: false,
            deterministicTemplateReply: `Untuk membantu mengecek mana yang lebih dekat antara *${formatDisplayName(locNameA)}* atau *${formatDisplayName(locNameB)}*, boleh diinfokan detail kelurahan atau kecamatannya ya Bunda? Biar kami bantu cekkan ongkir presisinya 😊🙏`,
          };
        }
      } catch (err) {
        console.error('[DECISION_MATRIX] Error resolving location comparison:', err);
      }
    }

    // =========================================================================
    // PRIORITY 5: RESOLUSI LOKASI BARU & KALKULASI ONGKIR DETERMINISTIK
    // (existing code continues...)
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

    // =========================================================================
    // PRIORITY 2H: PERCEPTEM ALAMAT BERTINGKAT (Progressive Address Refinement)
    // Jika pelanggan menyebutkan nama perumahan, gedung, atau jalan dalam penyempatan alamat
    // dan titik tersebut masih berada dalam zona/kelurahan yang sama, bot TIDAK MENGULANG
    // paragraf ongkir dan jarak. Cukup konfirmasi penyimpanan detail alamat.
    // =========================================================================
    const addressRefinementPatterns = [
      /\b(apart|apartment|gedung|building|blok|no\s*\d+|unit\s*\d+)\b/i,
      /\b(jalan|jl|jln|gang|gg|jalan\s+\w+|st\.?|street)\b/i,
      /\b(keputih|kebun|sari|palem|permata|mas[^a-z])|d\.?complex|residence|villa|perumahan\b/i,
    ];
    const isAddressRefinement =
      addressRefinementPatterns.some((re) => re.test(rawText)) &&
      !isExplicitLocationChange &&
      Boolean(extraction.locationText) &&
      isSameLocation &&
      updatedSlate.isLocationConfirmed &&
      !updatedSlate.isOutOfCoverage;

    if (isAddressRefinement) {
      // Jika customer menyebut detail alamat baru tapi masih di zona yang sama:
      // Bot TIDAK mengirim ulang paragraf ongkir. Cukup konfirmasi penyimpanan.
      return {
        action: 'RESOLVE_LOCATION_AND_DELIVERY',
        reason: 'Customer menyempalikan detail alamat (perumahan/gedung) di zona yang sama -> Konfirmasi penyimpanan tanpa ulang ongkir.',
        updatedSlate,
        shouldSendPricelistImage: false,
        deterministicTemplateReply: `Baik Bunda, detail alamat di ${extraction.locationText || updatedSlate.kelurahan} sudah kami catat yaa 😊\n\nRencana mau treatment apa bunda ?🤗`,
      };
    }

    const shouldResolveLocation =
      !isCompareLocations &&
      hasLocationInCurrentMessage &&
      (!updatedSlate.isLocationConfirmed || updatedSlate.isOutOfCoverage || isExplicitLocationChange || isDifferentLocation) &&
      // Idempotency Guard (fixed): HANYA blokir jika lokasi SUDAH terkonfirmasi DAN lokasinya SAMA
      // dan BUKAN ganti eksplisit. Lokasi BARU yang berbeda (isDifferentLocation) tetap lolos resolve.
      !(updatedSlate.isLocationConfirmed && isSameLocation && !isExplicitLocationChange && !updatedSlate.isOutOfCoverage);

    if (shouldResolveLocation) {
      try {
        const { geocodingService } = await import('../integrations/google-maps/geocoding');
        const { deliveryService } = await import('../services/delivery.service');

        // Strategi Pencarian Bertingkat (Lapis 2: preserve city context):
        // 1. Composite query: streetDetail + locationText (+ city from rawText if missing)
        // 2. Full raw incoming text
        // 3. locationText saja
        let compositeQuery = extraction.streetDetail
          ? `${extraction.streetDetail} ${extraction.locationText || ''}`.trim()
          : (extraction.locationText || rawText);
        // Lapis 2: jika locationText tidak mengandung kota tapi rawText mengandung, pertahankan konteks kota
        const hasCityInComposite = /\b(surabaya|sidoarjo|gresik)\b/i.test(compositeQuery);
        const hasCityInRaw = /\b(surabaya|sidoarjo|gresik)\b/i.test(rawText);
        if (!hasCityInComposite && hasCityInRaw) {
          const cityMatch = rawText.match(/\b(surabaya|sidoarjo|gresik)\b/i);
          if (cityMatch) compositeQuery = `${compositeQuery} ${cityMatch[0]}`.trim();
        }

        let resolved = await geocodingService.geocodeText(compositeQuery);
        if (!resolved.isPrecise && rawText && !rawText.includes('\n') && !/\b(atau|atw|or|vs|banding)\b/i.test(rawText)) {
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

        // Jika lokasi eksplisit menyebut kota luar jangkauan (misal Tuban, Lamongan, Malang, dll), langsung vonis OOC
        const hasExplicitOutsideCityCheck = /\b(jakarta|bandung|yogyakarta|yogya|semarang|malang|bojonegoro|kediri|mojokerto|pasuruan|probolinggo|jember|banyuwangi|madura|bangkalan|sampang|pamekasan|sumenep|tulungagung|blitar|madiun|nganjuk|jombang|lamongan|tuban)\b/i.test(locLower);
        if (hasExplicitOutsideCityCheck) {
          updatedSlate.kelurahan = extraction.locationText || 'Luar Kota';
          updatedSlate.isLocationConfirmed = false;
          updatedSlate.isOutOfCoverage = true;
          updatedSlate.projectedState = SlateStore.computeProjectedState(updatedSlate);
          return {
            action: 'REJECT_OUT_OF_COVERAGE',
            reason: `Lokasi yang diinput (${extraction.locationText}) merupakan wilayah luar jangkauan (>30 km).`,
            updatedSlate,
            shouldSendPricelistImage: false,
            deterministicTemplateReply: formatPolicyReply(TEMPLATES.outOfCoverage({
              distanceKm: 50,
            })),
          };
        }

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
          let delivery = await deliveryService.calculateDelivery({ lat: resolved.lat, lng: resolved.lng });

          // Lapis 4: Second-pass verification sebelum vonis OOC
          if (delivery.isOutOfCoverage) {
            const hasExplicitOutsideCity = /\b(jakarta|bandung|yogyakarta|yogya|semarang|malang|bojonegoro|kediri|mojokerto|pasuruan|probolinggo|jember|banyuwangi|madura|bangkalan|sampang|pamekasan|sumenep|tulungagung|blitar|madiun|nganjuk|jombang|lamongan|tuban)\b/i.test(rawText.toLowerCase());
            const isShortQuery = (extraction.locationText || '').trim().split(/\s+/).length <= 2;
            if (!hasExplicitOutsideCity && isShortQuery) {
              console.log(`[DECISION MATRIX SECOND-PASS] OOC ${delivery.distanceKm}km untuk "${extraction.locationText}" (resolved: ${resolved.kelurahan}, ${resolved.kota}) — coba verifikasi Surabaya/Sidoarjo`);
              const retryQueries = [
                `${extraction.locationText}, Kota Surabaya, Jawa Timur`,
                `${extraction.locationText}, Kabupaten Sidoarjo, Jawa Timur`,
              ];
              for (const retryQuery of retryQueries) {
                try {
                  const { geocodingService: retryGeocoding } = await import('../integrations/google-maps/geocoding');
                  const retryResolved = await retryGeocoding.geocodeText(retryQuery);
                  if (retryResolved.isPrecise && retryResolved.lat && retryResolved.lng) {
                    const retryDelivery = await deliveryService.calculateDelivery({ lat: retryResolved.lat, lng: retryResolved.lng });
                    if (!retryDelivery.isOutOfCoverage) {
                      console.log(`[DECISION MATRIX SECOND-PASS HIT] "${retryQuery}" → ${retryResolved.kelurahan}, ${retryResolved.kota} (${retryDelivery.distanceKm}km) — batalkan OOC`);
                      // Override resolved & delivery dengan hasil second-pass
                      resolved = retryResolved;
                      delivery = retryDelivery;
                      break;
                    }
                  }
                } catch (_) {}
              }
            }
            // Jika masih OOC setelah second-pass, baru vonis OOC
            if (delivery.isOutOfCoverage) {
              updatedSlate.kelurahan = resolved.kelurahan || resolved.kecamatan || extraction.locationText || 'Surabaya';
              updatedSlate.kecamatan = resolved.kecamatan || null;
              updatedSlate.kota = resolved.kota || null;
              updatedSlate.lat = resolved.lat ?? null;
              updatedSlate.lng = resolved.lng ?? null;
              updatedSlate.distanceKm = Number(delivery.distanceKm.toFixed(2));
              updatedSlate.ongkirFee = delivery.normalPrice;
              updatedSlate.ongkirPromoFee = delivery.promoPrice;
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
          }

          updatedSlate.kelurahan = resolved.kelurahan || resolved.kecamatan || extraction.locationText || 'Surabaya';
          updatedSlate.kecamatan = resolved.kecamatan || null;
          updatedSlate.kota = resolved.kota || null;
          updatedSlate.lat = resolved.lat ?? null;
          updatedSlate.lng = resolved.lng ?? null;
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
            // Jika belum ada treatment spesifik (null) atau hanya alias generik "pijat bayi", biarkan null untuk CTA netral
            const rawCandidate =
              updatedSlate.selectedTreatmentName ||
              (context as any)?.lastDiscussedTreatment ||
              undefined;
            const isGenericAlias = rawCandidate ? /^(?:pijat bayi|massage bayi|pijat baby|pijat biasa|massage biasa|pijat standar|pijat reguler|pijat rutin)$/i.test(rawCandidate.trim()) : false;
            const candidateTreatmentName = isGenericAlias ? undefined : rawCandidate;
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
    // Pertanyaan klinis (gejala/pasca-vaksin/darurat) BUKAN sinyal booking — bot harus
    // menjawab dulu, kecuali customer eksplisit minta booking.
    const hasClinicalQuestionIntent =
      extraction.intents.includes('consult_symptom') ||
      extraction.intents.includes('ask_unlisted_service') ||
      extraction.intents.includes('medical_emergency');
    const hasExplicitBookingSignal = extraction.intents.includes('request_booking');
    const isBookingReady =
      updatedSlate.isLocationConfirmed &&
      Boolean(updatedSlate.selectedTreatmentName) &&
      (Boolean(updatedSlate.preferredDate) || hasExplicitBookingSignal || extraction.intents.includes('ask_schedule')) &&
      (hasExplicitBookingSignal || !hasClinicalQuestionIntent);

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

    // Alih kelola form reservasi ke Admin: bot TIDAK LAGI mengirim template form panjang.
    // Saat booking-ready (atau customer eksplisit minta format), bot membalas konfirmasi
    // cek-jadwal singkat lalu handoff ke HUMAN_HANDLING — Admin yang menawarkan jam & form.
    const isExplicitFormOnlyRequest = /\b(minta|kirim|mana|minta\s+teks)\s+(format|form|list)\s*(reservasi|booking)?\b/i.test(rawText);
    // Inquiry Guard (anti-steamrolling): jika customer sedang bertanya (harga/klinik/layanan/
    // fasilitas bertanda tanya) TANPA sinyal booking eksplisit, jawab dulu via LLM — jangan
    // potong dengan handoff. Pertanyaan jadwal ("Hari minggu apa bisa?") BUKAN inkuiri.
    const hasInquiryIntent =
      extraction.intents.includes('ask_price') ||
      extraction.intents.includes('ask_clinic_origin') ||
      extraction.intents.includes('ask_unlisted_service');
    const hasFacilityQuestionMark =
      /\?/.test(rawText) && !hasExplicitBookingSignal && !extraction.intents.includes('ask_schedule');
    const isPureInquiry = hasInquiryIntent || hasFacilityQuestionMark;
    if (isBookingReady && !updatedSlate.reservationFormSent && isPureInquiry && !isExplicitFormOnlyRequest) {
      return {
        action: 'GENERATE_AI_RESPONSE',
        reason: 'Booking-ready tetapi customer sedang bertanya (inkuiri/fasilitas) -> jawab dulu via ReplyGenerator, tunda handoff.',
        updatedSlate,
        shouldSendPricelistImage: false,
      };
    }
    if ((isBookingReady && !updatedSlate.reservationFormSent) || isExplicitFormOnlyRequest) {
      const handoffReply = TEMPLATES.scheduleCheckHandoff({
        treatment: updatedSlate.selectedTreatmentName || extraction.treatmentReferenced || undefined,
        dayOrTime: updatedSlate.preferredDate || extraction.preferredDateText || undefined,
      });

      updatedSlate.isHumanHandling = true;
      updatedSlate.humanHandlingReason = 'booking_schedule_check';
      updatedSlate.projectedState = ConversationState.HUMAN_HANDLING;
      return {
        action: 'ESCALATE_HUMAN_SCHEDULE',
        reason: isExplicitFormOnlyRequest
          ? 'Customer meminta format reservasi -> konfirmasi cek jadwal singkat + handoff Admin (form dikirim Admin via dashboard).'
          : 'Customer booking-ready (lokasi + treatment + hari) -> konfirmasi cek jadwal singkat + handoff Admin.',
        updatedSlate,
        shouldSendPricelistImage: false,
        deterministicTemplateReply: handoffReply,
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
