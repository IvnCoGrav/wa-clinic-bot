import { describe, it, expect } from 'vitest';
import { NluClassifierService } from '../../src/services/nlu-classifier.service';
import { llmIntentService } from '../../src/integrations/llm/intent';

describe('Phase 1: NLU Intent Hardening & Contextual Decomposer', () => {
  describe('Task 1.1: Contextual Negation Guard', () => {
    const trueNegations = [
      'ga jadi',
      'gak jadi deh bund',
      'tidak mau',
      'enggak dulu ya',
      'batal',
      'cancel ya kak',
      'kemahalan bund',
      'skip dulu',
      'tidak',
      'enggak',
    ];

    trueNegations.forEach((text) => {
      it(`should recognize true cancellation/refusal: "${text}"`, () => {
        const result = NluClassifierService.fallbackClassify(text);
        expect(result.intents).toContain('negation');
      });
    });

    const situationalNegations = [
      'anak saya ga bisa diem gimana ya bund?',
      'ga bisa anteng anaknya kalau dipijat',
      'bukan yang pulih ceria bund, mau yang baby bath aja',
      'gak ada keluhan sih pengen relaksasi aja',
      'tidak usah yang pakai lulur ya kak',
      'bayi saya gak rewel kok',
      'maksud saya bukan yang itu, tapi yang moms massage',
    ];

    situationalNegations.forEach((text) => {
      it(`should NOT misclassify situational condition/preference as negation: "${text}"`, () => {
        const result = NluClassifierService.fallbackClassify(text);
        expect(result.intents).not.toContain('negation');
      });
    });
  });

  describe('Task 1.2: Duration & Frequency FAQ vs Ask Price & Ask Schedule', () => {
    const durationFaq = [
      'berapa lama durasi pijatnya?',
      'berapa jam treatment untuk baby spa?',
      'sehari boleh berapa kali pijat?',
      'berapa menit biasanya untuk newborn?',
      'minimal usia berapa boleh dipijat?',
      'anak umur berapa yang bisa ambil kids massage?',
      'berapa kali seminggu disarankan?',
    ];

    durationFaq.forEach((text) => {
      it(`should classify duration/frequency/age question as FAQ, NOT ask_price: "${text}"`, () => {
        const result = NluClassifierService.fallbackClassify(text);
        expect(result.intents).toContain('faq_question');
        expect(result.intents).not.toContain('ask_price');
        expect(result.intents).not.toContain('ask_schedule');
      });
    });

    const genuinePrice = [
      'pijat bayi berapa ya harganya?',
      'ongkir ke waru berapa?',
      'paket pulih ceria tarifnya berapa?',
      'biayanya brp bund?',
      'harga untuk mom spa berapa?',
      'ada pricelist?',
    ];

    genuinePrice.forEach((text) => {
      it(`should correctly classify genuine price inquiry: "${text}"`, () => {
        const result = NluClassifierService.fallbackClassify(text);
        expect(result.intents).toContain('ask_price');
      });
    });
  });

  describe('Task 1.3: Medical Treatment Seeking vs Medical Advice/Emergency', () => {
    const treatmentSeeking = [
      'si kecil lagi batuk pilek ada treatment yang cocok?',
      'anak saya kembung bisa dipijat ga ya bund?',
      'bayi lagi bapil boleh ambil paket apa?',
      'ada terapi untuk anak sembelit?',
      'kalau anak kolik ada perawatan apa?',
    ];

    treatmentSeeking.forEach((text) => {
      it(`should classify mild symptom treatment inquiry as FAQ/treatment recommendation, NOT medical_query: "${text}"`, () => {
        const result = NluClassifierService.fallbackClassify(text);
        expect(result.intents).toContain('faq_question');
        expect(result.intents).not.toContain('medical_query');
      });
    });

    const medicalEmergency = [
      'anak saya demam 40 derajat dikasih obat apa ya',
      'tali pusar bayi bernanah dan bau',
      'jahitan melahirkan terbuka dan berdarah banyak',
      'bayi kejang step segera',
      'minta resep obat penurun panas dong',
    ];

    medicalEmergency.forEach((text) => {
      it(`should classify true medical emergency / drug request as medical_query: "${text}"`, () => {
        const result = NluClassifierService.fallbackClassify(text);
        expect(result.intents).toContain('medical_query');
      });
    });
  });

  describe('Task 1.4: Complaint & Express Interest Precision', () => {
    const nonComplaints = [
      'berapa lama prosesnya?',
      'cepat sembuh gak kalau dipijat?',
      'lama promo ini sampai kapan ya?',
      'gerakannya cepat atau lembut?',
    ];

    nonComplaints.forEach((text) => {
      it(`should NOT trigger false complaint on neutral words like lama/cepat: "${text}"`, () => {
        const result = NluClassifierService.fallbackClassify(text);
        expect(result.intents).not.toContain('complaint');
      });
    });

    const realComplaints = [
      'pelayanan buruk banget kapok saya',
      'adminnya lama banget balasnya kecewa',
      'tindikan telinganya miring tidak pas',
      'kok bidannya belum sampai padahal sudah jam 10',
    ];

    realComplaints.forEach((text) => {
      it(`should correctly classify genuine complaints: "${text}"`, () => {
        const result = NluClassifierService.fallbackClassify(text);
        expect(result.intents).toContain('complaint');
      });
    });

    const inquiriesNotInterest = [
      'mau tanya dulu bund',
      'mau nanya pricelist ya',
      'mau konsultasi dulu boleh?',
      'pesan wa kemarin gak masuk',
    ];

    inquiriesNotInterest.forEach((text) => {
      it(`should NOT misclassify inquiry/chitchat as express_interest: "${text}"`, () => {
        const result = NluClassifierService.fallbackClassify(text);
        expect(result.intents).not.toContain('express_interest');
      });
    });

    const realInterest = [
      'mau booking untuk besok',
      'mau daftar paket newborn ya',
      'ambil paket pulih ceria',
      'mau pesan slot homecare',
    ];

    realInterest.forEach((text) => {
      it(`should correctly classify real booking intent: "${text}"`, () => {
        const result = NluClassifierService.fallbackClassify(text);
        expect(result.intents).toContain('express_interest');
      });
    });
  });

  describe('Legacy Intent Service Fallback Parity', () => {
    it('should not mark "anak ga bisa diem" as not_interested in legacy intent fallback', async () => {
      const result = await llmIntentService.detectIntent('anak ga bisa diem gimana ya');
      expect(result.intent).not.toBe('not_interested');
    });

    it('should not mark "batuk pilek ada treatment?" as medical_query in legacy intent fallback', async () => {
      const result = await llmIntentService.detectIntent('batuk pilek ada treatment?');
      expect(result.intent).toBe('faq_question');
    });
  });
});
