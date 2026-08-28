import { CustomerSlate } from './types';

export class DynamicCloserService {
  /**
   * Menentukan jenis slot data yang paling dibutuhkan klinik untuk memandu percakapan.
   * Catatan SOP: Usia (AGE) TIDAK PERLU ditanyakan secara proaktif, karena dapat dilengkapi saat reservasi.
   */
  public static determineMissingSlot(slate?: CustomerSlate): 'LOCATION' | 'TREATMENT' | 'SCHEDULE' | 'FORM_ALREADY_SENT' {
    if (!slate) return 'LOCATION';

    // Prioritas 1: Lokasi belum diketahui/dikonfirmasi
    if (!slate.isLocationConfirmed || !slate.kelurahan) {
      return 'LOCATION';
    }

    // Prioritas 2: Cek apakah treatment atau keluhan/gejala sudah ada
    const hasTreatmentOrSymptom = Boolean(
      slate.selectedTreatmentName ||
      (slate.symptoms && slate.symptoms.length > 0)
    );

    // Jika belum ada keluhan / treatment yang dipilih -> pandu pemilihan treatment
    if (!hasTreatmentOrSymptom) {
      return 'TREATMENT';
    }

    // Prioritas 3: Form sudah pernah dikirim sebelumnya -> ingatkan pengisian form
    if (slate.reservationFormSent) {
      return 'FORM_ALREADY_SENT';
    }

    // Prioritas 4: Jadwal kunjungan (SCHEDULE)
    return 'SCHEDULE';
  }

  /**
   * Menghasilkan instruksi penutup dinamis untuk disuntikkan ke System Prompt LLM.
   */
  public static getCloserInstruction(
    slate?: CustomerSlate,
    preFilledForm?: string | null,
    history?: any[],
    rawText?: string
  ): string {
    const missing = this.determineMissingSlot(slate);

    const hasOngkirInHistory = Boolean(
      history?.some((m) => m.role === 'assistant' && (m.content.includes('ongkir') || m.content.includes('jarak')))
    );
    const ongkirGuard = hasOngkirInHistory
      ? '⚠️ DILARANG MENYEBUTKAN/MENGULANG ONGKIR KARENA SUDAH DIJELASKAN DI PERCAKAPAN SEBELUMNYA!'
      : '⚠️ DILARANG MENGULANG PARAGRAF ONGKIR ATAU MENYEBUTKAN NOMINAL ONGKIR jika ongkir sudah pernah disampaikan di percakapan sebelumnya!';

    const lowerRaw = (rawText || '').toLowerCase();
    const hasFluSymptom = Boolean(
      slate?.symptoms?.some((s) => s.includes('flu') || s.includes('batuk') || s.includes('pilek') || s.includes('grok')) ||
      history?.some((m) => m.content.toLowerCase().includes('flu') || m.content.toLowerCase().includes('batuk') || m.content.toLowerCase().includes('pilek') || m.content.toLowerCase().includes('pulih'))
    );

    const isAskingPayment = /\b(payment|bayar|transfer|tf|qris|cash|metode\s+pembayaran)\b/i.test(lowerRaw);
    const isAskingSinar = /\b(sinar|moksa|nebu|uap|terapi\s+alat)\b/i.test(lowerRaw);
    const isAskingSafety = /\b(aman\s*(kah|ga|gak|nggak|ta)|bahaya|apakah\s+aman|boleh\s*(kah|ga|gak)|bisa\s*(kah|ga|gak)\s+kalau\s+masih|masih\s+belum\s+\d+\s*bulan|masih\s+newborn)\b/i.test(lowerRaw);
    const isAskingMomsOrOksitosin = /\b(oksitosin|laktasi|pijat\s+ibu|treatment\s+ibu|postpartum|nifas)\b/i.test(lowerRaw);
    const isSwitchingToBaby = /\b(untuk\s+baby|buat\s+baby|baby\s+aja|anak\s+aja|buat\s+anak|bayi\s+aja)\b/i.test(lowerRaw);

    const targetTreatment = slate?.selectedTreatmentName
      ? `*${slate.selectedTreatmentName}*`
      : (slate?.symptoms && slate.symptoms.length > 0 ? '*Pijat Bayi Pulih Ceria*' : 'perawatannya');

    // Jika customer mengajukan pertanyaan spesifik FAQ/teknis (dan form reservasi belum dikirim), prioritaskan panduan kontekstual
    if (!preFilledForm && !slate?.reservationFormSent) {
      if (isSwitchingToBaby && hasFluSymptom) {
        return `PANDUAN PENUTUP (KONFIRMASI PERAWATAN BAYI):
1. Konfirmasi bahwa perawatan difokuskan untuk si kecil dengan paket *Pijat Bayi Pulih Ceria* (terapi flu).
2. Di kalimat penutup, langsung tanyakan jadwal kunjungan: "Baik Bunda, jadi kita ambil paket *Pijat Bayi Pulih Ceria* untuk si kecil yaa 😊 Mau kami bantu cekkan ketersediaan jadwal Bidan di hari apa, Bunda?"
3. DILARANG mengulang menanyakan pilihan treatment dari awal!
${ongkirGuard}`;
      }

      if (isAskingPayment) {
        return `PANDUAN PENUTUP (METODE PEMBAYARAN):
1. Jelaskan metode pembayaran fleksibel (Transfer BCA, Mandiri, BRI, QRIS Universal, atau Cash setelah treatment selesai).
2. Di kalimat penutup, tawarkan bantuan jadwal: "Pembayaran sangat fleksibel setelah treatment selesai ya Bunda. Mau kami bantu cekkan ketersediaan jadwal Bidan? 😊"
⚠️ DILARANG mengulang pertanyaan "Rencana mau treatment apa bunda ?"!
${ongkirGuard}`;
      }

      if (isAskingSinar) {
        return `PANDUAN PENUTUP (TERAPI & SINAR MOKSA):
1. Jelaskan bahwa paket terapi sudah termasuk pijat dan dapat ditambahkan opsi Sinar Moksa untuk melegakan pernapasan si kecil.
2. Di kalimat penutup, tanyakan: "Bunda mau sekalian kami tambahkan opsi Sinar Moksa untuk membantu melegakan napas si kecil? 😊"
⚠️ DILARANG mengulang pertanyaan "Rencana mau treatment apa bunda ?"!
${ongkirGuard}`;
      }

      if (isAskingSafety) {
        return `PANDUAN PENUTUP (EDUKASI KEAMANAN USIA):
1. Jelaskan dengan ramah & menenangkan bahwa si kecil sangat aman dan dianjurkan dipijat oleh Bidan profesional bersertifikat STR.
2. Di kalimat penutup, tanyakan: "Mau kami bantu jadwalkan kunjungan Bidan ke rumah untuk ${targetTreatment}, Bunda? 😊"
⚠️ DILARANG mengulang pertanyaan "Rencana mau treatment apa bunda ?"!
${ongkirGuard}`;
      }

      if (isAskingMomsOrOksitosin) {
        return `PANDUAN PENUTUP (LAYANAN IBU / PIJAT OKSITOSIN):
1. Jelaskan bahwa Pijat Oksitosin diperuntukkan khusus bagi Ibu Menyusui / Nifas untuk merangsang hormon oksitosin, memperlancar ASI, dan relaksasi punggung/leher Bunda.
2. Di kalimat penutup, tanyakan: "Perawatan ini untuk Bunda sendiri atau mau dibarengkan dengan si kecil, Bunda? 😊"
${ongkirGuard}`;
      }
    }

    // Helper deteksi penyebutan hari/jadwal dinamis
    const extractDateMention = (text?: string | null): string | null => {
      if (!text) return null;
      const match = text.match(/\b(hari\s+(?:senin|selasa|rabu|kamis|jumat|sabtu|minggu)(?:\s*(?:atau|\/|dan)\s*(?:senin|selasa|rabu|kamis|jumat|sabtu|minggu))?|(?:senin|selasa|rabu|kamis|jumat|sabtu|minggu)(?:\s*(?:atau|\/|dan)\s*(?:senin|selasa|rabu|kamis|jumat|sabtu|minggu))?|besok(?:\s+pagi|\s+siang|\s+sore|\s+malam)?|lusa|weekend|akhir\s+pekan)\b/i);
      return match ? match[0].trim() : null;
    };

    const extractedDateMention = extractDateMention(rawText) || extractDateMention(slate?.preferredDate) || (rawText?.includes('besok') ? 'besok' : null);
    const dateDisplay = extractedDateMention || slate?.preferredDate || 'jadwal yang diminta';

    switch (missing) {
      case 'LOCATION': {
        if (extractedDateMention) {
          const scheduleCheckText = `Untuk jadwal hari ${extractedDateMention}, akan kami bantu cekkan ketersediaan jadwal Bidan yang ready ya Bunda 😊. Kalau boleh tahu, rumah Bunda di daerah atau kelurahan mana yaa agar bisa sekalian kami bantu cekkan ketersediaan slot Bidan & ongkirnya? 😊`;
          return `PANDUAN PENUTUP (TANYA LOKASI RUMAH):
1. Sampaikan bahwa ketersediaan jadwal di hari ${extractedDateMention} akan dicekkan terlebih dahulu oleh tim Bidan.
2. Tanyakan alamat/daerah di kalimat penutup dengan santun: "${scheduleCheckText}"
⚠️ DILARANG KERAS mengafirmasi dengan kata "Tentu bisa", "Bisa ya", "Bisa Bunda", atau "Pasti bisa"! Langsung sampaikan bahwa ketersediaan jadwal akan dibantu cekkan terlebih dahulu.
⚠️ DILARANG MENANYAKAN "Rencana mau treatment di hari apa" karena Bunda sudah menyebutkan hari ${extractedDateMention}!
⚠️ DILARANG menggunakan kata "Ada yang ingin dikonsultasikan?".
⚠️ DILARANG menanyakan ulang apakah Bunda jadi mengambil paket/treatment jika di pesan sebelumnya Bunda sudah menanyakan paket tersebut!`;
        }

        const askLocationText = `Kalau boleh tahu, rumah Bunda di daerah atau kelurahan mana yaa agar bisa sekalian kami bantu cekkan ketersediaan jadwal Bidan & ongkirnya? 😊`;
        return `PANDUAN PENUTUP (TANYA LOKASI RUMAH):
1. Jawab pertanyaan seputar layanan/usia/keluhan Bunda terlebih dahulu dengan ramah.
2. Tanyakan alamat/daerah di kalimat penutup dengan santun: "${askLocationText}"
⚠️ DILARANG menyebutkan kata pengantar jadwal jika Bunda belum menyebutkan hari/waktu kunjungan!
⚠️ DILARANG menggunakan kata "Ada yang ingin dikonsultasikan?".
⚠️ DILARANG menanyakan ulang apakah Bunda jadi mengambil paket/treatment jika di pesan sebelumnya Bunda sudah menanyakan paket tersebut!`;
      }

      case 'TREATMENT': {
        if (extractedDateMention) {
          return `PANDUAN PENUTUP (PENAWARAN JADWAL):
1. Untuk ketersediaan jadwal di hari ${extractedDateMention}, sampaikan dengan santun bahwa jadwal Bidan yang ready akan dicekkan terlebih dahulu.
2. Tanyakan perkiraan jam yang diinginkan (pagi/siang/sore) atau tanyakan konfirmasi perawatan dengan santun.
⚠️ DILARANG KERAS mengafirmasi dengan kata "Tentu bisa", "Bisa ya", "Bisa Bunda", atau "Pasti bisa"! Langsung sampaikan bahwa ketersediaan jadwal akan dibantu cekkan terlebih dahulu.
⚠️ DILARANG MENANYAKAN "di hari apa" LAGI karena Bunda sudah menyebutkan hari ${extractedDateMention}!
⚠️ DILARANG menanyakan dengan nada kaku apakah Bunda sudah memutuskan mengambil paket jika Bunda sudah mendiskusikan paket tersebut!
${ongkirGuard}`;
        }

        return `PANDUAN KONSULTASI & PENUTUP (TANYA PILIHAN TREATMENT):
1. Jawab pertanyaan seputar layanan/keluhan Bunda terlebih dahulu dengan ramah.
2. Jika Bunda baru menyebutkan lokasi, sampaikan estimasi ongkir promo dengan jelas (jika belum disampaikan).
3. Di kalimat penutup, tanyakan secara hangat mau ambil paket apa atau treatment apa yang ingin diambil (contoh: "Rencana mau treatment apa bunda ?🤗" atau "Bunda tertarik mau ambil paket apa untuk si kecil? 😊").
4. DILARANG langsung menanyakan hari/jadwal sebelum Bunda memilih treatment atau keluhan dibahas!
⚠️ ATURAN ANTI-REPETISI: DILARANG mengulang kalimat penutup yang sama persis jika sudah pernah ditanyakan di riwayat chat! Variasikan pertanyaan penutup secara natural.
${ongkirGuard}`;
      }

      case 'SCHEDULE': {
        const targetTreatment = slate?.selectedTreatmentName
          ? `*${slate.selectedTreatmentName}*`
          : (slate?.symptoms && slate.symptoms.length > 0 ? '*Pijat Bayi Pulih Ceria*' : 'perawatannya');

        if (preFilledForm && !slate?.reservationFormSent) {
          return `PANDUAN RESERVASI & PENUTUP:
1. Jawab terlebih dahulu pertanyaan Bunda tentang treatment/keluhan dengan ramah dan solutif.
2. Untuk ketersediaan jadwal di hari ${dateDisplay}, sampaikan dengan santun bahwa jadwal Bidan akan dicekkan terlebih dahulu (contoh: "Untuk ketersediaan jadwal di hari ${dateDisplay}, akan kami bantu cekkan ketersediaan jadwal Bidan yang ready ya Bunda 😊").
3. Di bagian bawah balasan, sertakan format reservasi berikut agar Bunda bisa langsung mengisi/melengkapi data untuk dicekkan jadwalnya:
${preFilledForm}
(Pastikan format di atas tercantum rapi di bagian bawah balasan).
⚠️ DILARANG KERAS mengafirmasi dengan kata "Tentu bisa", "Bisa ya", "Bisa Bunda", atau "Pasti bisa"! Langsung sampaikan bahwa ketersediaan jadwal akan dibantu cekkan terlebih dahulu.
⚠️ DILARANG KERAS proaktif menanyakan usia atau umur si kecil jika tidak ditanyakan customer! Usia akan dilengkapi saat pengisian form reservasi.
⚠️ DILARANG MENANYAKAN LAGI "hari apa" jika Bunda sudah menyebutkan hari/waktu (${dateDisplay})!
⚠️ DILARANG mengonfirmasi bahwa slot/jam tersebut pasti tersedia secara sepihak!
⚠️ DILARANG menanyakan ulang apakah Bunda jadi mengambil treatment jika Bunda sudah memilih treatment tersebut!
${ongkirGuard}`;
        }

        if (extractedDateMention || slate?.preferredDate) {
          return `PANDUAN PENAWARAN JADWAL (SCHEDULE):
1. Jawab terlebih dahulu pertanyaan layanan/keluhan Bunda dengan ramah.
2. Untuk ketersediaan jadwal di hari ${dateDisplay}, sampaikan bahwa jadwal Bidan akan dicekkan terlebih dahulu: "Untuk ketersediaan jadwal di hari ${dateDisplay}, akan kami bantu cekkan ketersediaan jadwal Bidan yang ready terlebih dahulu ya Bunda 😊".
3. Tanyakan preferensi jam yang diinginkan (pagi/siang/sore, contoh: "Kira-kira untuk hari ${dateDisplay} Bunda lebih nyaman di jam berapa yaa (pagi/siang/sore) agar bisa langsung kami bantu amankan slot ${targetTreatment}-nya? 😊").
⚠️ DILARANG KERAS mengafirmasi dengan kata "Tentu bisa", "Bisa ya", "Bisa Bunda", atau "Pasti bisa"! Langsung jawab bahwa jadwal akan dibantu cekkan terlebih dahulu.
⚠️ DILARANG KERAS MENANYAKAN "DI HARI APA" LAGI KARENA BUNDA SUDAH MENYEBUTKAN HARI (${dateDisplay})!
⚠️ DILARANG KERAS proaktif menanyakan usia atau umur si kecil jika tidak ditanyakan customer!
⚠️ DILARANG menanyakan ulang apakah Bunda jadi mengambil paket/treatment jika Bunda sudah menanyakan paket tersebut!
${ongkirGuard}`;
        }

        return `PANDUAN PENAWARAN JADWAL (SCHEDULE):
1. Jawab pertanyaan layanan/keluhan Bunda terlebih dahulu dengan ramah.
2. Tawarkan jadwal reservasi di kalimat penutup secara santun dan natural (contoh: "Rencana mau treatment di hari apa Bunda ? 😊" atau "Mau kami bantu jadwalkan ${targetTreatment}-nya di hari apa Bunda? Nanti kami bantu cekkan ketersediaan jadwal Bidannya 😊").
⚠️ DILARANG KERAS mengafirmasi dengan kata "Tentu bisa", "Bisa ya", "Bisa Bunda", atau "Pasti bisa"!
⚠️ DILARANG KERAS proaktif menanyakan usia atau umur si kecil jika tidak ditanyakan customer! Usia akan dilengkapi saat pengisian form reservasi.
⚠️ DILARANG mengonfirmasi bahwa slot/jam tersebut pasti tersedia secara sepihak!
⚠️ DILARANG menanyakan ulang apakah Bunda jadi mengambil paket/treatment jika Bunda sudah menanyakan paket tersebut!
${ongkirGuard}`;
      }

      case 'FORM_ALREADY_SENT':
        return `PANDUAN PENUTUP: Jawab pertanyaan Bunda secara santun (misal konfirmasi ketersediaan hari Jumat/jam atau teknis lainnya). DILARANG KERAS mengulang mengirim format formulir reservasi yang panjang karena formulir sudah dikirim sebelumnya di chat atas. Cukup arahkan dengan santun: "Kira-kira Bunda nyaman di jam berapa yaa? Jika sudah pas, format reservasi yang di atas tadi bisa dibantu lengkapi ya Bunda agar jadwalnya bisa langsung kami amankan 😊"`;

      default:
        return `PANDUAN PENUTUP: Tanyakan dengan santun: "Mau kami bantu jadwalkan kunjungan Bidan ke rumah untuk si kecil, Bunda? 😊"`;
    }
  }

  /**
   * Menghasilkan kalimat penutup fallback siap pakai (deterministik).
   */
  public static getCloserText(slate?: CustomerSlate): string {
    const missing = this.determineMissingSlot(slate);

    switch (missing) {
      case 'LOCATION':
        return 'Kalau boleh tahu, rumah Bunda di daerah atau kelurahan mana yaa agar bisa sekalian kami bantu cekkan ketersediaan jadwal Bidan? 😊';
      case 'TREATMENT':
        return 'Rencana mau treatment apa bunda ?🤗';
      case 'SCHEDULE':
        return 'Rencana mau treatment di hari apa Bunda ? 😊';
      case 'FORM_ALREADY_SENT':
        return 'Format reservasi yang di atas tadi bisa dibantu lengkapi ya Bunda agar jadwalnya bisa langsung kami amankan 😊';
      default:
        return 'Mau kami bantu jadwalkan kunjungan Bidan ke rumah untuk si kecil, Bunda? 😊';
    }
  }
}

