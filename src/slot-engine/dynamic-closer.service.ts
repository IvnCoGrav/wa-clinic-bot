import { CustomerSlate } from './types';

export class DynamicCloserService {
  /**
   * Menentukan jenis slot data yang paling dibutuhkan klinik untuk memandu percakapan.
   */
  public static determineMissingSlot(slate?: CustomerSlate): 'LOCATION' | 'AGE' | 'TREATMENT' | 'SCHEDULE' {
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

    // Prioritas 4: Jadwal kunjungan belum ditentukan
    if (!slate.preferredDate) {
      return 'SCHEDULE';
    }

    return 'SCHEDULE';
  }

  /**
   * Menghasilkan instruksi penutup dinamis untuk disuntikkan ke System Prompt LLM.
   */
  public static getCloserInstruction(slate?: CustomerSlate): string {
    const missing = this.determineMissingSlot(slate);

    switch (missing) {
      case 'LOCATION':
        return `PANDUAN PENUTUP: Tanyakan alamat/daerah di kalimat penutup dengan santun: "Kalau boleh tahu, rumah Bunda di daerah atau kelurahan mana yaa agar bisa sekalian kami bantu cekkan ketersediaan jadwal Bidan & ongkirnya? 😊" (DILARANG menggunakan kata "Ada yang ingin dikonsultasikan?").`;
      case 'AGE':
        return `PANDUAN PENUTUP: Tanyakan usia si kecil di kalimat penutup: "Kalau boleh tahu, berapa usia si kecil saat ini ya Bunda agar rekomendasinya tepat? 😊"`;
      case 'TREATMENT':
        return `PANDUAN PENUTUP: Tawarkan bantuan perawatan di kalimat penutup: "Mau kami bantu rekomendasikan perawatan terbaik untuk si kecil, Bunda? 😊"`;
      case 'SCHEDULE':
        return `PANDUAN PENUTUP: Tanyakan jadwal kunjungan di kalimat penutup: "Bunda lebih nyaman kami jadwalkan kunjungan Bidan hari apa dan jam berapa yaa? 😊"`;
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
    }
  }
}
