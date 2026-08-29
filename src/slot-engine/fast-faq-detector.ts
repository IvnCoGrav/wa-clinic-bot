import { CustomerSlate } from './types';
import { knowledgeBaseService } from '../services/knowledge.service';
import { DEFAULT_TENANT_ID } from '../config/tenant';

/**
 * Pola regex pertanyaan informasi umum/FAQ klinik yang cocok untuk Single-Pass Fast Track.
 */
const FAQ_PATTERNS = [
  // 1. Jenis layanan & homecare
  /\b(homecare|home-care|home care|ke rumah|datang ke rumah|di rumah)\b/i,
  // 2. Hari & jam operasional
  /\b(buka|tutup|jadwal|jam berapa|hari apa|weekday|weekend|minggu|sabtu|tanggal merah|libur|malam)\b/i,
  // 3. Durasi & waktu treatment
  /\b(berapa lama|durasi|waktunya berapa|beres berapa lama|lama pijat)\b/i,
  // 4. Pembayaran & administrasi
  /\b(transfer|qris|cash|tunai|bayar|pembayaran|rekening|bca|mandiri|bri)\b/i,
  // 5. Asal klinik / domisili terapis
  /\b(dari mana|lokasi klinik|klinik mana|kliniknya di mana|posisi klinik|cabang)\b/i,
  // 6. Kualifikasi & sertifikasi terapis
  /\b(bidan|terapis|sertifikasi|bersertifikat|pengalaman|aman|alat steril)\b/i,
  // 7. Syarat & persiapan homecare
  /\b(syarat|persiapan|disiapkan|perlu siapin|mandi dulu|sebelum pijat|setelah imunisasi|habis imunisasi)\b/i,
  // 8. Tanya umum harga / pricelist / paket tanpa spesifik booking
  /\b(pricelist|daftar harga|paket apa saja|ada paket apa|info harga|promo apa|biaya)\b/i,
];

/**
 * Pola regex yang mengindikasikan pesan mengandung entitas transaksi dinamis / geocoding baru / form / keluhan medis,
 * yang WAJIB diarahkan ke jalur 2-Call Deep Engine demi menjaga akurasi perhitungan Maps & katalog rekomendasi.
 */
const DYNAMIC_CONSTRAINTS_PATTERNS = [
  // Pesan Greeting / Lead Iklan Meta (Wajib melalui Onboarding Alamat, bukan dibajak FAQ)
  /\b(tertarik dengan layanan|tertarik layanan|tertarik treatment|promo\[|iklan|mau tanya promo)\b/i,
  // Form reservasi terstruktur
  /\b(format reservasi|list untuk reservasi|nama bunda|nama bayi|usia bayi|alamat & shareloc)\b/i,
  // Alamat jalan / gang / nomor rumah / RT-RW
  /\b(jl\.|jalan|gang|no\.|rt\b|rw\b|perumahan|perum\b|blok\b|desa|dusun)\b/i,
  // Kata pemesanan / booking / pemilihan hari spesifik
  /\b(booking|reservasi|pesan slot|jadwalkan|mau ambil|ambil paket|pilih paket|ambil treatment|pilih treatment|untuk hari|buat hari|di hari|jam \d{1,2}|pukul \d{1,2}|besok|lusa|tgl \d{1,2})\b/i,
  // Angka usia anak eksplisit (butuh filtering katalog usia)
  /\b(?:usia|umur)\s+\d+\s*(?:bln|bulan|thn|tahun|hari|minggu)\b/i,
  /\b\d+\s*(?:bln|bulan|thn|tahun)\b/i,
  // Keluhan fisik anak spesifik (butuh rekomendasi kombinasi treatment klinis)
  /\b(grok[- ]?grok|batuk|pilek|bapil|gumoh|kolik|kembung|sembelit|diare|demam|susah makan|gtm|pegal|capek|rewel)\b/i,
  // Pertanyaan tarif ongkir alamat tertentu secara spesifik
  /\b(ongkir ke|ongkos ke|transport ke|kalau di perumahan|kena ongkos brp|kena ongkir brp)\b/i,
  // Sinyal darurat medis fatal
  /\b(kejang|membiru|biru|tidak sadar|pingsan|darah banyak|perdarahan hebat|sesak parah)\b/i,
  // Layanan di luar katalog resmi yang membutuhkan eskalasi diam / penanganan manual CS
  /\b(mandikan\s*bayi|mandiin\s*bayi|jasa\s*mandi|paket\s*mandi|baby\s*sitting|penitipan\s*(anak|bayi)|tindik(\s*telinga)?|imunisasi|vaksin|sunat|rawat\s*tali\s*pusat|rawat\s*luka|fisioterapi|paket\s*newborn|perawatan\s*newborn)\b/i,
];

export class FastFaqDetector {
  /**
   * Mengevaluasi apakah pesan customer merupakan kandidat Fast-Track 1-Call FAQ.
   */
  static isPotentialFastFaq(text: string, slate?: CustomerSlate): boolean {
    if (!text || text.trim().length === 0) return false;
    const cleanText = text.trim();

    // 0. Jika customer belum konfirmasi lokasi dan mengirimkan pesan sapaan/lead/pembuka -> prioritaskan onboarding Slot Engine
    if (slate && !slate.isLocationConfirmed) {
      if (/\b(tertarik|halo|hola|hi|hei|p|assalamu'?alaikum|assalamualaikum|siang|pagi|sore|malam|permisi|promo|booking|reservasi|info)\b/i.test(cleanText)) {
        return false;
      }
    }

    // 1. Jika terdeteksi sinyal transaksi/geocoding/form dinamis/lead ads -> TOLAK Fast Track
    if (this.hasDynamicGeocodingOrBookingConstraints(cleanText)) {
      return false;
    }

    // 2. Jika pesan sangat panjang (> 300 karakter) -> kemungkinan form / cerita riwayat medis lengkap -> 2-Call
    if (cleanText.length > 300) {
      return false;
    }

    // 3. Cocokkan dengan pola FAQ umum
    const matchesFaqPattern = FAQ_PATTERNS.some((pattern) => pattern.test(cleanText));
    if (matchesFaqPattern) {
      return true;
    }

    // 4. Jika pesan berupa kalimat tanya umum (mengandung ?, apakah, bagaimana, apa, kenapa)
    const isQuestion = /\?|apakah|bagaimana|gimana|apa |kenapa/i.test(cleanText);
    return isQuestion;
  }

  /**
   * Memeriksa apakah pesan mengandung data dinamis yang membutuhkan geocoding / katalog multi-stage.
   */
  static hasDynamicGeocodingOrBookingConstraints(text: string): boolean {
    return DYNAMIC_CONSTRAINTS_PATTERNS.some((pattern) => pattern.test(text));
  }

  /**
   * Mengambil chunk artikel SOP / FAQ dari knowledge base untuk grounding 1-Call.
   */
  static async retrieveFaqGrounding(
    text: string,
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<Array<{ title: string; content: string }>> {
    try {
      const chunks = await knowledgeBaseService.searchRelevantChunks(text, 2, tenantId);
      return chunks || [];
    } catch {
      return [];
    }
  }
}
