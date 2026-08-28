import { CustomerSlate, ExtractedEntities } from './types';

export interface FewShotExemplar {
  id: string;
  scenario: string;
  tags: string[];
  customerMessage: string;
  idealResponse: string;
}

/**
 * Bank Percakapan Ideal (Few-Shot Exemplars) Bidan Yusi.
 * Mencontohkan tata krama, nada bicara santun, empati, dan SOP klinis resmi
 * yang langsung dapat ditiru polanya oleh LLM.
 */
export const FEW_SHOT_EXEMPLARS: FewShotExemplar[] = [
  {
    id: 'symptom_flu_consultation',
    scenario: 'Pasien berkonsultasi keluhan batuk / pilek / flu / grok-grok pada bayi',
    tags: ['consult_symptom', 'flu', 'batuk', 'pilek', 'grok'],
    customerMessage: 'Anak saya usia 3 bulan lagi grok-grok dan pilek bun, ada pijatnya gak ya?',
    idealResponse:
      'Iya Bunda, untuk membantu melegakan pernapasan dan ketidaknyamanan si kecil, kami ada layanan *Pijat Bayi Pulih Ceria* yang dikombinasikan dengan teknik akupresur dan aromaterapi khusus flu/batuk pilek yaa 😊 Mau kami bantu cekkan ketersediaan jadwal Bidan untuk kunjungan ke rumah, Bunda?',
  },
  {
    id: 'schedule_inquiry_anti_affirmation',
    scenario: 'Pasien menanyakan ketersediaan jadwal di hari tertentu (Anti-Afirmasi Jadwal)',
    tags: ['ask_schedule', 'schedule', 'sabtu', 'minggu', 'besok'],
    customerMessage: 'Hari Sabtu ini bu bidan bisa datang ke rumah?',
    idealResponse:
      'Untuk ketersediaan jadwal di hari Sabtu, akan kami bantu cekkan ketersediaan jadwal Bidan yang ready terlebih dahulu ya Bunda 😊 Kira-kira Bunda lebih nyaman di jam berapa yaa (pagi/siang/sore)?',
  },
  {
    id: 'price_inquiry',
    scenario: 'Pasien menanyakan tarif/harga layanan',
    tags: ['ask_price', 'price', 'harga', 'tarif', 'biaya'],
    customerMessage: 'Untuk tarif pijat batuk pilek kena berapa ya bun?',
    idealResponse:
      'Untuk layanan *Pijat Bayi Pulih Ceria*, tarif promonya saat ini Rp 70.000 (durasi ~40 menit) ya Bunda 😊 Mau kami bantu jadwalkan kunjungan Bidan ke rumah untuk si kecil?',
  },
  {
    id: 'payment_method_inquiry',
    scenario: 'Pasien menanyakan metode pembayaran (Transfer / QRIS / Cash)',
    tags: ['payment', 'qris', 'transfer', 'cash'],
    customerMessage: 'Pembayarannya bisa transfer atau harus cash kak?',
    idealResponse:
      'Untuk pembayaran sangat fleksibel ya Bunda, bisa melalui Transfer Bank (BCA, Mandiri, BRI), QRIS Universal, ataupun Tunai (Cash) setelah treatment selesai dilakukan 😊 Mau kami bantu cekkan jadwal Bidan?',
  },
  {
    id: 'maternal_lactation_inquiry',
    scenario: 'Pasien menanyakan pijat laktasi / oksitosin untuk Ibu Menyusui',
    tags: ['laktasi', 'oksitosin', 'ibu', 'moms'],
    customerMessage: 'Pijat oksitosin itu untuk apa ya bun? Bisa buat lancarin ASI?',
    idealResponse:
      'Benar sekali Bunda 😊 *Pijat Oksitosin* khusus untuk Bunda menyusui/nifas guna merangsang hormon oksitosin alami, membantu melancarkan aliran ASI, serta merilekskan otot punggung dan leher yang tegang. Mau kami bantu jadwalkan untuk Bunda?',
  },
  {
    id: 'post_delivery_treatment_continuation',
    scenario: 'Lanjutan percakapan setelah ongkir sudah disepakati (Anti-Pengulangan Ongkir)',
    tags: ['follow_up', 'after_ongkir'],
    customerMessage: 'Oke deh, mau ambil paket pijat yang biasa aja',
    idealResponse:
      'Baik Bunda, untuk perawatan rutin si kecil kami siapkan paket *Pijat Bayi Ceria* yaa 😊 Rencana mau kami bantu jadwalkan di hari apa Bunda?',
  },
];

export class FewShotExemplarBank {
  /**
   * Memilih 1-2 contoh percakapan ideal yang paling relevan dengan pesan dan intent customer saat ini.
   */
  public static selectRelevantExemplars(
    extraction: ExtractedEntities,
    slate?: CustomerSlate,
    customerInput?: string
  ): FewShotExemplar[] {
    const inputLower = (customerInput || '').toLowerCase();
    const scored: Array<{ exemplar: FewShotExemplar; score: number }> = [];

    for (const ex of FEW_SHOT_EXEMPLARS) {
      let score = 0;

      // 1. Cocokkan dengan tags
      for (const tag of ex.tags) {
        if (inputLower.includes(tag)) score += 3;
        if (extraction.intents.some((i) => i.includes(tag))) score += 4;
        if (extraction.symptoms.some((s) => s.includes(tag))) score += 4;
      }

      // 2. Prioritaskan jadwal jika ada mention hari/jadwal
      if (
        (ex.id === 'schedule_inquiry_anti_affirmation' && extraction.intents.includes('ask_schedule')) ||
        Boolean(extraction.preferredDateText)
      ) {
        score += 5;
      }

      // 3. Prioritaskan harga jika ada intent ask_price
      if (ex.id === 'price_inquiry' && extraction.intents.includes('ask_price')) {
        score += 5;
      }

      // 4. Prioritaskan keluhan jika ada symptoms
      if (
        ex.id === 'symptom_flu_consultation' &&
        (extraction.symptoms.length > 0 || extraction.intents.includes('consult_symptom'))
      ) {
        score += 5;
      }

      // 5. Prioritaskan follow-up jika ongkir sudah pernah terkirim
      if (ex.id === 'post_delivery_treatment_continuation' && slate?.isLocationConfirmed && !slate.selectedTreatmentName) {
        score += 2;
      }

      scored.push({ exemplar: ex, score });
    }

    // Urutkan skor tertinggi dan ambil maksimal 2 contoh
    scored.sort((a, b) => b.score - a.score);
    const top = scored.filter((s) => s.score > 0).slice(0, 2);

    // Fallback: Jika tidak ada yang cocok kuat, ambil exemplar sapaan/keluhan standar
    if (top.length === 0) {
      return [FEW_SHOT_EXEMPLARS[0]];
    }

    return top.map((t) => t.exemplar);
  }

  /**
   * Format exemplar menjadi blok teks ramah prompt.
   */
  public static formatExemplarsForPrompt(exemplars: FewShotExemplar[]): string {
    if (!exemplars || exemplars.length === 0) return '';

    const formatted = exemplars
      .map(
        (e, idx) =>
          `Contoh ${idx + 1} (${e.scenario}):\n` +
          `Pasien: "${e.customerMessage}"\n` +
          `Bidan Yusi: "${e.idealResponse}"`
      )
      .join('\n\n');

    return `CONTOH PERCAKAPAN IDEAL BIDAN YUSI (TIRU POLA DAN NADA BICARANYA):\n${formatted}`;
  }
}
