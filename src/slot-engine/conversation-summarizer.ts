import { CustomerSlate, ExtractedEntities } from './types';

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

    // 3. EVALUASI KELUHAN & TREATMENT
    if (slate.selectedTreatmentName) {
      sudahDibahas.push(`Treatment yang dipilih/ditanyakan: *${slate.selectedTreatmentName}*`);
      janganDiulang.push('Menanyakan ulang "rencana mau treatment apa" dari awal');
    } else if (slate.symptoms && slate.symptoms.length > 0) {
      sudahDibahas.push(`Keluhan si kecil: ${slate.symptoms.join(', ')} (disarankan *Pijat Bayi Pulih Ceria*)`);
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

    // 7. TOPIK YANG SEDANG DIBAHAS
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
    } else if (extraction.intents.includes('consult_symptom')) {
      const symptomList = extraction.symptoms.length > 0 ? extraction.symptoms.join(', ') : 'keluhan fisik si kecil';
      sedangDibahas = `Bunda berkonsultasi mengenai keluhan: ${symptomList}`;
      yangPerluDijawab =
        'Rekomendasikan paket treatment yang tepat (*Pijat Bayi Pulih Ceria* untuk bapil/flu) secara suportif dan empatik, jelaskan manfaat terapinya, lalu tawarkan jadwal kunjungan';
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
