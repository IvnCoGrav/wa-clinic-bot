import { CustomerSlate } from './types';

export interface ValidationResult {
  isValid: boolean;
  violations: string[];
  sanitizedReply?: string;
  fallbackReply?: string;
}

/**
 * ResponseValidator
 * Lapisan Post-Generation Content Guard yang memeriksa apakah balasan dari LLM
 * mengandung pola halusinasi berbahaya (rumus ongkir, tier fiktif, formulir ngarangan,
 * atau janji jadwal sepihak) sebelum pesan dikirimkan ke WhatsApp customer.
 */
export class ResponseValidator {
  public static validate(
    reply: string,
    slate: CustomerSlate,
    options?: { isOngkirAlreadySent?: boolean; mandatoryDirective?: string | null; hasDeliveryFacts?: boolean }
  ): ValidationResult {
    if (!reply || reply.trim().length === 0) {
      return { isValid: true, violations: [] };
    }

    const violations: string[] = [];
    let cleaned = reply;

    // 1. Deteksi Halusinasi Rumus / Rentang Tier Ongkir Fiktif
    // Contoh: "berkisar antara Rp 5.000 hingga Rp 25.000", "Rp 5.000 - Rp 25.000", "di bawah 5 km gratis ... berkisar"
    if (
      /\bberkisar\s+(?:antara\s+)?Rp\s*[\d.]+\s*(?:hingga|sampai|-|–)\s*Rp\s*[\d.]+/i.test(cleaned) ||
      /\bRp\s*[\d.]+\s*(?:hingga|sampai|-|–)\s*Rp\s*[\d.]+\s+setelah\s+promo/i.test(cleaned) ||
      /\bdi\s+bawah\s+\d+\s*km[,\s]+ongkirnya\s+gratis/i.test(cleaned)
    ) {
      violations.push('HALLUCINATED_ONGKIR_RANGE');
    }

    // 2. Deteksi Halusinasi Ongkir Gratis Tanpa Konfirmasi Lokasi Resmi
    if (
      /\b(?:ongkirnya\s+gratis|gratis\s+ongkir(?:nya)?)\b/i.test(cleaned) &&
      (!slate.isLocationConfirmed || (slate.distanceKm !== null && slate.distanceKm > 5))
    ) {
      violations.push('HALLUCINATED_FREE_ONGKIR');
    }

    const isBookingReady = Boolean(slate.selectedTreatmentName && slate.isLocationConfirmed);

    // 3. Deteksi Formulir Reservasi Dummy / Ngarangan (list nomor 1-4)
    // Contoh: "1. Nama Lengkap \n 2. Nomor Telepon \n 3. Alamat \n 4. Jenis Treatment"
    if (
      /^\s*[1-4][\.\)]\s*(?:Nama\s+lengkap|Nama\s+bunda|Nama\s+si\s+kecil|Alamat|Nomor\s+telepon|Jenis\s+treatment|No\.?\s*(?:HP|WA|Telp))/mi.test(cleaned) &&
      !isBookingReady &&
      !slate.reservationFormSent
    ) {
      violations.push('HALLUCINATED_DUMMY_FORM');
    }

    // 4. Deteksi Konfirmasi Jadwal Sepihak (Over-confirming schedule)
    // Contoh: "Tentu bisa Bunda, besok masih ada slot kosong", "Bisa besok jam 10 Bunda", "Slot masih tersedia"
    if (
      /\b(?:tentu\s+bisa\s+bunda[,\s]+(?:besok|nanti|hari\s+\w+|jam\s+\d+)|besok\s+bisa\s+bunda|pasti\s+bisa\s+bunda[,\s]+(?:besok|hari)|slot(?:nya)?\s+masih\s+(?:banyak\s+)?tersedia|slot(?:nya)?\s+masih\s+kosong)\b/i.test(cleaned) &&
      !isBookingReady
    ) {
      violations.push('OVERCONFIRMED_SCHEDULE');
    }

    // 5. Deteksi Penyebutan Jarak KM Tanpa Titik Lokasi Resmi
    if (
      /\b(?:jaraknya|radius)\s+(?:kurang\s+lebih\s+)?\d+[\.,]?\d*\s*km\b/i.test(cleaned) &&
      !slate.isLocationConfirmed
    ) {
      violations.push('HALLUCINATED_DISTANCE');
    }

    // 5b. Deteksi Balasan Vague-Ongkir tanpa fakta deterministik (Wonorejo guard)
    // Contoh halu: "biaya ongkir akan dihitung...", "Kami akan menghitung biaya ongkir berdasarkan jarak", "ongkir akan dihitung/dihitung berdasarkan jarak"
    if (
      /\b(?:biaya\s+ongkir|ongkir(?:nya)?)\s+akan\s+dihitung\b/i.test(cleaned) ||
      /\bakan\s+dihitung\s+berdasarkan\s+jarak\b/i.test(cleaned) ||
      /\bakan\s+menghitung\s+(?:biaya\s+)?ongkir\b/i.test(cleaned) ||
      /\bmenghitung\s+(?:biaya\s+)?ongkir\s+berdasarkan\s+jarak\b/i.test(cleaned)
    ) {
      const hasFacts = Boolean(options?.hasDeliveryFacts) || slate.isLocationConfirmed;
      const hasNumericOngkir = /Rp\s*[\d.]+/.test(cleaned) && /jaraknya\s+kurang\s+lebih/i.test(cleaned);
      if (!hasFacts || !hasNumericOngkir) {
        violations.push('HALLUCINATED_VAGUE_ONGKIR');
      }
    }

    // 5c. Deteksi Mandatory Directive Hilang (ask_clinic_origin wajib sebut Waru/Homecare)
    if (options?.mandatoryDirective && options.mandatoryDirective.includes('Homebase kami ada di')) {
      const mustContain = /Homebase kami ada di|Waru.*Sidoarjo|Homecare/i.test(cleaned);
      if (!mustContain) {
        violations.push('MISSING_MANDATORY_DIRECTIVE');
      }
    }

    // 6. Sanitasi Frasa Kaku / Robotik ("mau dicobakan")
    if (/\bmau\s+dicobakan\s+yang\b/i.test(cleaned)) {
      cleaned = cleaned.replace(/\b(?:Kalau\s+)?si\s+kecil\s+mau\s+dicobakan\s+yang\s+([^?]+)\s+dulu\s+Bunda\s*\?/gi, 'Bunda tertarik mau ambil paket $1 atau mau konsultasikan keluhan lainnya dulu Bunda? 😊');
      cleaned = cleaned.replace(/\bmau\s+dicobakan\s+yang\b/gi, 'mau coba paket');
    }

    // 7. Sanitasi Pengulangan Paragraf Ongkir (jika ongkir sudah pernah disampaikan)
    if (options?.isOngkirAlreadySent) {
      cleaned = cleaned.replace(/Jika\s+dilihat\s+dari\s+jaraknya\s+kurang\s+lebih\s+[\d.,]+\s*km[^\n]*\n*.*?Jadi\s+bisa\s+ya\s+bunda\s*[☺️😊✨]*\n*/gi, '');
      cleaned = cleaned.replace(/Jika\s+dilihat\s+dari\s+jaraknya\s+kurang\s+lebih\s+[\d.,]+\s*km[^\.]*\.\s*Dari\s+pricelist\s+kami[^\.]*\.\s*Tetapi\s+karena[^\.]*\.\s*Jadi\s+bisa\s+ya\s+Bunda\s*[☺️😊✨]*/gi, '');
      cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
    }

    // Jika terdeteksi pelanggaran halusinasi fatal yang merusak integritas fakta
    if (violations.length > 0) {
      let fallbackReply: string;

      if (violations.includes('MISSING_MANDATORY_DIRECTIVE') && options?.mandatoryDirective) {
        fallbackReply = `${options.mandatoryDirective}\n\nKalau boleh tahu, nama kelurahan atau desanya apa ya Bunda agar bisa sekalian kami bantu cekkan ketersediaan jadwal Bidan & ongkirnya? 😊`;
      } else if (violations.includes('HALLUCINATED_VAGUE_ONGKIR')) {
        if (slate.isLocationConfirmed && slate.distanceKm !== null && slate.ongkirPromoFee !== null) {
          fallbackReply = `Jika dilihat dari jaraknya kurang lebih ${slate.distanceKm.toFixed(1)} km. Dari pricelist kami di jarak ini ada tambahan ongkir Rp ${(slate.ongkirFee ?? 0).toLocaleString('id-ID')} tetapi karna bulan ini ada promo, kami bisa kasih bunda ongkir menjadi Rp ${(slate.ongkirPromoFee ?? 0).toLocaleString('id-ID')} saja bunda. Jadi bisa ya bunda ☺️\n\nKalau boleh tahu, rencana mau ambil treatment apa Bunda? 🤗`;
        } else {
          fallbackReply = `Kalau boleh tahu, nama kelurahan atau desanya apa ya Bunda agar bisa sekalian kami bantu cekkan ketersediaan jadwal Bidan & ongkirnya? 😊`;
        }
      } else if (violations.includes('HALLUCINATED_ONGKIR_RANGE') || violations.includes('HALLUCINATED_DISTANCE') || violations.includes('HALLUCINATED_FREE_ONGKIR')) {
        fallbackReply = slate.kelurahan
          ? `Baik Bunda, untuk area di sekitar ${slate.kelurahan} masih masuk jangkauan layanan kami yaa 😊\n\nKalau boleh tahu, rencana mau ambil treatment apa untuk si kecil Bunda? 🤗`
          : `Kalau boleh tahu, nama kelurahan atau desanya apa ya Bunda agar bisa sekalian kami bantu cekkan ketersediaan jadwal Bidan & ongkirnya? 😊`;
      } else if (violations.includes('HALLUCINATED_DUMMY_FORM') || violations.includes('OVERCONFIRMED_SCHEDULE')) {
        fallbackReply = slate.kelurahan
          ? `Baik Bunda, untuk pengecekan ketersediaan slot Bidan di area ${slate.kelurahan}, rencana mau ambil treatment apa untuk si kecil Bunda? 😊`
          : `Kalau boleh tahu, nama kelurahan atau desanya apa ya Bunda agar bisa sekalian kami bantu cekkan ketersediaan jadwal Bidan & ongkirnya? 😊`;
      } else {
        fallbackReply = `Ada yang bisa kami bantu jelaskan lebih lanjut mengenai layanan homecare untuk si kecil Bunda? 😊`;
      }

      return {
        isValid: false,
        violations,
        sanitizedReply: cleaned,
        fallbackReply,
      };
    }

    return {
      isValid: true,
      violations: [],
      sanitizedReply: cleaned,
    };
  }
}
