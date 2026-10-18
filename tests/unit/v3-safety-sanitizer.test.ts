import { describe, it, expect } from 'vitest';
import { isMedicalSafetyQuery } from '../../src/v3/agent/pipeline/medical-signal-detector';
import { OutputSanitizer } from '../../src/v3/guardrails/sanitizer';

describe('T7.1 & T7.2: Medical Safety Sanitizer & Triage Preservation', () => {
  describe('isMedicalSafetyQuery (Deterministik, Multi-Parafrase)', () => {
    it('mendeteksi pertanyaan izin/keamanan pada kondisi demam/sakit', () => {
      expect(isMedicalSafetyQuery('anak saya lagi demam apakah boleh dipijat?')).toBe(true);
      expect(isMedicalSafetyQuery('kalo bayinya bapil aman ga ya dipijet?')).toBe(true);
      expect(isMedicalSafetyQuery('apakah boleh pijat kalau si kecil batuk pilek?')).toBe(true);
      expect(isMedicalSafetyQuery('bolehkah anak dipijat saat badannya panas?')).toBe(true);
    });

    it('mendeteksi pertanyaan izin/keamanan pada vaksin & trauma jatuh', () => {
      expect(isMedicalSafetyQuery('anak saya habis vaksin boleh dipijat gak?')).toBe(true);
      expect(isMedicalSafetyQuery('kalo baru imunisasi polio aman gak pijat?')).toBe(true);
      expect(isMedicalSafetyQuery('habis jatuh dari kasur boleh pijat gak ya sus?')).toBe(true);
      expect(isMedicalSafetyQuery('anak kejedot lemari boleh dipijet ga?')).toBe(true);
    });

    it('mendeteksi pertanyaan keamanan maternal / hamil muda', () => {
      expect(isMedicalSafetyQuery('apakah aman pijat saat hamil muda trimester 1?')).toBe(true);
      expect(isMedicalSafetyQuery('lagi flek boleh pijat hamil gak?')).toBe(true);
    });

    it('tidak menandai percakapan jadwal atau harga non-medis', () => {
      expect(isMedicalSafetyQuery('bisa reservasi untuk hari rabu?')).toBe(false);
      expect(isMedicalSafetyQuery('apakah bisa datang jam 10 pagi?')).toBe(false);
      expect(isMedicalSafetyQuery('berapa harga paket pijat bayi?')).toBe(false);
      expect(isMedicalSafetyQuery('ongkir ke rungkut berapa ya?')).toBe(false);
    });
  });

  describe('sanitizeMedicalAffirmation (Pagar Afirmasi Sembrono)', () => {
    it('menolak "Boleh banget" / "Bisa banget" saat customer menanyakan keamanan medis', () => {
      const draft = 'Boleh banget Bunda! Nanti kami bantu jadwalkan yaa.';
      const sanitized = OutputSanitizer.sanitizeMedicalAffirmation(draft, true);
      expect(sanitized).not.toContain('Boleh banget');
      expect(sanitized).toContain('Untuk kondisi tersebut, Bidan kami perlu memastikan kondisinya terlebih dahulu ya Bunda 🙏');
      expect(sanitized).toContain('Nanti kami bantu jadwalkan yaa.');
    });

    it('menolak variasi pembuka ceria sembrono lainnya', () => {
      const draft1 = 'Bisa banget ya Bunda! Si kecil bisa langsung dipijat.';
      expect(OutputSanitizer.sanitizeMedicalAffirmation(draft1, true)).toContain('Untuk kondisi tersebut, Bidan kami perlu memastikan');

      const draft2 = 'Halo Bunda! Boleh banget untuk si kecil.';
      expect(OutputSanitizer.sanitizeMedicalAffirmation(draft2, true)).toContain('Untuk kondisi tersebut, Bidan kami perlu memastikan');
    });

    it('mempertahankan balasan ramah non-medis tanpa modifikasi', () => {
      const nonMedDraft = 'Boleh banget Bunda, untuk hari Rabu masih ada slot jam 10 yaa.';
      expect(OutputSanitizer.sanitizeMedicalAffirmation(nonMedDraft, false)).toBe(nonMedDraft);
    });
  });

  describe('T7.1: Pengecualian Trimmer untuk Keselamatan & Triase', () => {
    it('isSafetyOrTriageContent mendeteksi pesan rujukan darurat & protokol skrining', () => {
      const emergency = 'Mohon maaf Bunda, demi keselamatan medis sebaiknya segera diperiksakan ke Dokter Spesialis Anak atau instalasi gawat darurat (UGD) terdekat ya Bunda.';
      expect(OutputSanitizer.isSafetyOrTriageContent(emergency)).toBe(true);

      const screening = 'Untuk bayi pasca vaksin, Bidan kami mewajibkan jeda waktu minimal 48 jam dan memastikan si kecil sudah fit tidak demam ya Bunda.';
      expect(OutputSanitizer.isSafetyOrTriageContent(screening)).toBe(true);

      const normalChat = 'Bisa dibantu dengan Pijat Bayi Ceria ya Bunda. Perawatan ini membantu si kecil rileks.';
      expect(OutputSanitizer.isSafetyOrTriageContent(normalChat)).toBe(false);
    });

    it('trimToMaxSentencesPreservingGreetingHeader TIDAK memotong pesan keselamatan / triase', () => {
      const longTriageMessage =
        'Oh ya ampun Bunda, pasti kaget ya si kecil kemarin sempat jatuh 🥺. ' +
        'Untuk memastikan keamanannya, kita pastikan dulu ya Bunda: apakah si kecil ada muntah menyembur, benjolan di kepala, atau tanda bahaya lainnya Bunda? ' +
        'Jika ada tanda bahaya tersebut atau kehilangan kesadaran, sebaiknya segera periksakan ke dokter spesialis atau UGD terdekat ya Bunda. ' +
        'Namun jika si kecil tetap aktif ceria dan hanya rewel karena pegal, Bidan kami siap membantu dengan pijat lembut. ' +
        'Bagaimana kondisi si kecil saat ini Bunda? 🤗';

      const preserved = OutputSanitizer.trimToMaxSentencesPreservingGreetingHeader(longTriageMessage, 3);
      // Seluruh 5 kalimat keselamatan tetap utuh tanpa dipotong
      expect(preserved).toBe(longTriageMessage);
      expect(preserved).toContain('UGD terdekat');
      expect(preserved).toContain('Bagaimana kondisi si kecil');
    });

    it('trimToMaxSentencesPreservingGreetingHeader tetap memotong chat prosa biasa yang melebihi batas kuota', () => {
      const longRegularMessage =
        'Bisa dibantu dengan Pijat Bayi Ceria ya Bunda 😊. ' +
        'Perawatan ini difokuskan Bidan kami untuk relaksasi si kecil. ' +
        'Pijatan lembutnya membantu peredaran darah lebih lancar. ' +
        'Selain itu tidur si kecil juga jadi lebih nyenyak Bunda. ' +
        'Apakah Bunda ingin kami bantu jadwalkan?';

      const trimmed = OutputSanitizer.trimToMaxSentencesPreservingGreetingHeader(longRegularMessage, 3);
      // Chat biasa dipotong ke 3 kalimat
      expect(trimmed).not.toContain('Apakah Bunda ingin kami bantu jadwalkan?');
    });
  });
});
