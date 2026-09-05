import { CustomerSlate, ExtractedEntities } from './types';
import { treatmentCatalogService } from '../services/treatment-catalog.service';

export interface ConversationSummaryOptions {
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  customerInput?: string;
}

/**
 * ConversationStateSummarizer
 * Menghasilkan ringkasan state percakapan deterministik (0 Token, < 1ms)
 * untuk disuntikkan ke System Prompt Reply Generator (Call 2).
 *
 * Memberikan LLM "kesadaran konteks" tentang apa yang sudah disepakati,
 * apa yang sedang dibahas sekarang, dan apa yang DILARANG diulang.
 */
export class ConversationStateSummarizer {
  public static summarize(
    slate: CustomerSlate,
    extraction: ExtractedEntities,
    options?: ConversationSummaryOptions
  ): string {
    const sudahDibahas: string[] = [];
    const janganDiulang: string[] = [];
    const history = options?.history || [];
    const customerInput = options?.customerInput || '';
    const botRepliesCount = history.filter((h) => h.role === 'assistant').length;

    // 1. EVALUASI LOKASI & ONGKIR
    if (slate.isLocationConfirmed && slate.ongkirPromoFee !== null) {
      const locLabel = slate.kelurahan || slate.kecamatan || 'lokasi Bunda';
      const distLabel = slate.distanceKm !== null ? `, ~${slate.distanceKm} km` : '';
      sudahDibahas.push(`Ongkir Rp ${slate.ongkirPromoFee.toLocaleString('id-ID')} promo (${locLabel}${distLabel})`);
      janganDiulang.push('Info ongkir atau perhitungan jarak (sudah disampaikan di chat atas)');
    }

    // 2. EVALUASI USIA ANAK
    if (slate.childAgeMonths !== null && slate.childAgeMonths > 0) {
      sudahDibahas.push(`Usia si kecil: ${slate.childAgeMonths} bulan (${slate.childAgeCategory || 'BABY'})`);
      janganDiulang.push('Menanyakan usia atau umur anak (sudah diketahui)');
    }

    // 3. EVALUASI KELUHAN & TREATMENT (dinamis dari katalog)
    if (slate.selectedTreatmentName) {
      sudahDibahas.push(`Treatment yang dipilih/ditanyakan: *${slate.selectedTreatmentName}*`);
      janganDiulang.push('Menanyakan ulang "rencana mau treatment apa" dari awal');
    } else if (slate.symptoms && slate.symptoms.length > 0) {
      const candidates = slate.childAgeMonths !== null
        ? treatmentCatalogService.filterServicesByAudience(treatmentCatalogService.getAllServices(), { ageMonths: slate.childAgeMonths })
        : treatmentCatalogService.getAllServices();
      const suggested = candidates.find((s) => s.name.toLowerCase().includes('pulih'))?.name || candidates[0]?.name || 'treatment sesuai katalog';
      sudahDibahas.push(`Keluhan si kecil: ${slate.symptoms.join(', ')} (disarankan *${suggested}* dari katalog aktif)`);
      janganDiulang.push('Menanyakan ulang keluhan si kecil');
    }

    // 4. EVALUASI FORMULIR RESERVASI
    if (slate.reservationFormSent) {
      sudahDibahas.push('Format formulir reservasi sudah pernah dikirimkan');
      janganDiulang.push('Mengirim ulang teks formulir reservasi panjang (cukup ingatkan melengkapi data)');
    }

    // 5. EVALUASI SAPAAN PEMBUKA
    if (botRepliesCount > 0) {
      janganDiulang.push('Sapaan pembuka "Halo Bunda!" atau perkenalan diri "Perkenalkan saya Bidan Yusi..." (ini percakapan lanjutan, langsung jawab inti)');
    }

    // 6. EVALUASI HARI/JADWAL DARI INPUT CUSTOMER
    const rawInputLower = customerInput.toLowerCase();
    const hasDayMention =
      Boolean(extraction.preferredDateText) ||
      /\b(hari\s+(?:senin|selasa|rabu|kamis|jumat|sabtu|minggu)|besok|lusa|weekend|akhir\s+pekan|sabtu|minggu|senin|selasa|rabu|kamis|jumat)\b/i.test(rawInputLower);

    if (hasDayMention) {
      const dayName = extraction.preferredDateText || 'hari yang disebutkan Bunda';
      janganDiulang.push(`Menanyakan "mau treatment di hari apa" karena Bunda sudah menyebutkan ${dayName}`);
    }

    // 7. EVALUASI COOL-OFF PERTANYAAN (ANTI-REPETISI CTA)
    const recentAssistantMsgs = history.filter((h) => h.role === 'assistant').slice(-2);
    const askedLocationRecently = recentAssistantMsgs.some((m) => {
      const c = (m.content || '').toLowerCase();
      return (
        c.includes('daerah atau kelurahan') ||
        c.includes('kelurahan mana') ||
        c.includes('rumahnya dimana') ||
        c.includes('lokasi rumah') ||
        c.includes('alamat rumah')
      );
    });
    if (askedLocationRecently && !extraction.locationText && !slate.kelurahan) {
      janganDiulang.push('Menanyakan alamat/kelurahan rumah Bunda lagi (karena baru saja ditanyakan dan Bunda sedang fokus berkonsultasi). Berikan jawaban empatik tanpa menodong alamat!');
    }

    const askedScheduleRecently = recentAssistantMsgs.some((m) => {
      const c = (m.content || '').toLowerCase();
      return (
        c.includes('di hari apa') ||
        c.includes('jadwal kunjungan') ||
        c.includes('jadwal bidan') ||
        c.includes('ketersediaan jadwal') ||
        c.includes('rencana mau treatment di hari apa')
      );
    });
    if (askedScheduleRecently && !hasDayMention) {
      janganDiulang.push('Menanyakan "mau treatment di hari apa" atau menodong jadwal kunjungan lagi (karena baru saja ditanyakan). Jawab dengan ramah tanpa menodong!');
    }

    // 8. TOPIK YANG SEDANG DIBAHAS
    let sedangDibahas = 'Bunda mengajukan pertanyaan seputar layanan';
    let yangPerluDijawab = 'Jawab pertanyaan Bunda dengan ramah dan solutif sebagai Bidan Yusi, lalu arahkan ke langkah berikutnya';

    if (hasDayMention || extraction.intents.includes('ask_schedule')) {
      const dayRef = extraction.preferredDateText || 'jadwal kunjungan';
      sedangDibahas = `Bunda menanyakan ketersediaan jadwal (${dayRef})`;
      yangPerluDijawab =
        'Sampaikan bahwa ketersediaan jadwal Bidan yang bertugas akan dibantu cekkan terlebih dahulu (DILARANG bilang "Tentu bisa" sepihak). Arahkan untuk menentukan preferensi jam (pagi/siang/sore) atau melengkapi data reservasi';
    } else if (extraction.intents.includes('ask_price')) {
      sedangDibahas = 'Bunda menanyakan tarif / harga layanan';
      yangPerluDijawab =
        'Sebutkan tarif promo paket yang relevan secara jelas dan transparan sesuai data katalog grounding, lalu tanyakan jadwal atau kebutuhan perawatan si kecil';
    } else if (extraction.intents.includes('consult_symptom') || /\b(grok|grr|lendir|pilek|batuk|meler|mbeler|basah|bunyi|nafas|napas|sesak)\b/i.test(rawInputLower)) {
      const symptomList = extraction.symptoms.length > 0 ? extraction.symptoms.join(', ') : 'kondisi pernapasan / keluhan fisik si kecil';
      sedangDibahas = `Bunda berkonsultasi mengenai keluhan: ${symptomList}`;
      const candidates2 = slate.childAgeMonths !== null
        ? treatmentCatalogService.filterServicesByAudience(treatmentCatalogService.getAllServices(), { ageMonths: slate.childAgeMonths })
        : treatmentCatalogService.getAllServices();
      const suggested2 = extraction.symptoms?.length ? (candidates2.find((s) => s.name.toLowerCase().includes('pulih'))?.name || candidates2[0]?.name) : (candidates2[0]?.name || 'treatment sesuai katalog');
      yangPerluDijawab =
        `Jelaskan kondisi si kecil secara medis dan menenangkan (*${suggested2}* dapat membantu meredakan keluhan tersebut). Berikan empati tulus dan doa kesembuhan — DILARANG menodong jadwal/lokasi jika Bunda masih mendalami gejalanya`;
    } else if (extraction.intents.includes('provide_location') || extraction.locationText) {
      sedangDibahas = `Bunda menginformasikan lokasi rumah (${extraction.locationText || slate.kelurahan || 'alamat'})`;
      yangPerluDijawab =
        'Konfirmasi jangkauan layanan dan tarif ongkir promo ke lokasi tersebut, lalu tanyakan rencana perawatan atau jadwal kunjungan';
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
