import { CustomerSlate } from './types';

export class DynamicCloserService {
  /**
   * Menentukan jenis slot data yang paling dibutuhkan klinik untuk memandu percakapan.
   */
  public static determineMissingSlot(slate?: CustomerSlate): 'LOCATION' | 'AGE' | 'TREATMENT' | 'SCHEDULE' | 'FORM_ALREADY_SENT' {
    if (!slate) return 'LOCATION';

    // Prioritas 1: Lokasi belum diketahui/dikonfirmasi
    if (!slate.isLocationConfirmed || !slate.kelurahan) {
      return 'LOCATION';
    }

    // Prioritas 2: Usia pasien belum diketahui
    if (slate.childAgeMonths === null && !slate.selectedTreatmentName) {
      return 'AGE';
    }

    // Prioritas 3: Treatment belum dipilih
    if (!slate.selectedTreatmentName) {
      return 'TREATMENT';
    }

    // Prioritas 4: Form sudah pernah dikirim sebelumnya -> jangan kirim ulang form
    if (slate.reservationFormSent) {
      return 'FORM_ALREADY_SENT';
    }

    // Prioritas 5: Jadwal kunjungan belum ditentukan
    if (!slate.preferredDate) {
      return 'SCHEDULE';
    }

    return 'SCHEDULE';
  }

  /**
   * Menghasilkan instruksi penutup dinamis untuk disuntikkan ke System Prompt LLM.
   */
  public static getCloserInstruction(slate?: CustomerSlate, preFilledForm?: string | null): string {
    const missing = this.determineMissingSlot(slate);

    switch (missing) {
      case 'LOCATION':
        return `PANDUAN PENUTUP: Tanyakan alamat/daerah di kalimat penutup dengan santun: "Kalau boleh tahu, rumah Bunda di daerah atau kelurahan mana yaa agar bisa sekalian kami bantu cekkan ketersediaan jadwal Bidan & ongkirnya? 😊" (DILARANG menggunakan kata "Ada yang ingin dikonsultasikan?").`;
      case 'AGE':
        return `PANDUAN PENUTUP: Tanyakan usia si kecil di kalimat penutup: "Kalau boleh tahu, berapa usia si kecil saat ini ya Bunda agar rekomendasinya tepat? 😊"`;
      case 'TREATMENT':
        return `PANDUAN PENUTUP: Tawarkan bantuan perawatan di kalimat penutup: "Mau kami bantu rekomendasikan perawatan terbaik untuk si kecil, Bunda? 😊"`;
      case 'SCHEDULE':
        if (preFilledForm && !slate?.reservationFormSent) {
          return `PANDUAN RESERVASI & PENUTUP:
1. Jawab pertanyaan Bunda dengan ramah dan penuh empati (misal: setujui jika bertanya kombinasi/bundling Moms & Bayi, atau respon preferensi hari kunjungan).
2. Di bagian bawah balasan, sertakan format reservasi berikut agar Bunda bisa langsung mengisi/melengkapi data:
${preFilledForm}
(Pastikan format di atas tercantum rapi di bagian bawah balasan).`;
        }
        return `PANDUAN KONSULTASI & PENUTUP:
1. Konfirmasikan bahwa lokasi Bunda terjangkau layanan Homecare Bidan kami, sebutkan tarif ongkir promonya jika ada data ongkir, serta sebutkan nama paket rekomendasi beserta tarif harganya.
2. Di akhir pesan, tanyakan dengan ramah dan santun: "Kira-kira Bunda ingin kami bantu jadwalkan kunjungan Bidan ke rumah hari apa yaa? 😊" (DILARANG mengonfirmasi bahwa slot/jam tersebut pasti tersedia dan DILARANG menyertakan formulir reservasi panjang sebelum Bunda meminta jadwal).`;
      case 'FORM_ALREADY_SENT':
        return `PANDUAN PENUTUP: Jawab pertanyaan Bunda secara santun (misal konfirmasi ketersediaan hari Jumat/jam atau teknis lainnya). DILARANG KERAS mengulang mengirim format formulir reservasi yang panjang karena formulir sudah dikirim sebelumnya di chat atas. Cukup arahkan dengan santun: "Kira-kira Bunda nyaman di jam berapa yaa? Jika sudah pas, format reservasi yang di atas tadi bisa dibantu lengkapi ya Bunda agar jadwalnya bisa langsung kami amankan 😊"`;
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
      case 'AGE':
        return 'Kalau boleh tahu, berapa usia si kecil saat ini ya Bunda agar rekomendasinya tepat? 😊';
      case 'TREATMENT':
        return 'Mau kami bantu jadwalkan kunjungan Bidan ke rumah untuk si kecil, Bunda? 😊';
      case 'SCHEDULE':
        return 'Bunda lebih nyaman kami jadwalkan kunjungan Bidan hari apa dan jam berapa yaa? 😊';
      case 'FORM_ALREADY_SENT':
        return 'Format reservasi di atas bisa dibantu lengkapi ya Bunda agar jadwal Bidan kami siapkan 😊';
    }
  }
}

