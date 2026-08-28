import { describe, it, expect } from 'vitest';
import { UnifiedResponseSanitizer, sanitizeScheduleAffirmations } from '../../src/utils/language-sanitizer';
import { ResponseValidator } from '../../src/slot-engine/response-validator';
import { PersonaComposer } from '../../src/slot-engine/persona-composer';
import { DynamicCloserService } from '../../src/slot-engine/dynamic-closer.service';
import { SlateStore } from '../../src/slot-engine/slate-store';
import { BOT_PERSONA_PROMPT } from '../../src/config/persona';

describe('Anti-Affirmation Schedule Guard (Jangan Mengafirmasi Jadwal "Bisa")', () => {
  describe('1. UnifiedResponseSanitizer & sanitizeScheduleAffirmations', () => {
    it('Customer asks "Hari sabtu bu bidan bisa?" -> strips "Tentu bisa" and normalizes "Bun" -> "Bunda"', () => {
      const llmOutput =
        'Tentu bisa, kami bantu cekkan ketersediaan jadwal Bidan yang ready untuk hari Sabtu ya, Bun 😊 Untuk jam preferensinya, apakah pagi, siang, atau sore yang lebih memudahkan?';

      const cleaned = UnifiedResponseSanitizer.sanitize(llmOutput, { historyCount: 1 });

      expect(cleaned).not.toContain('Tentu bisa');
      expect(cleaned).not.toContain('Bun ');
      expect(cleaned).toContain('Kami bantu cekkan ketersediaan jadwal Bidan yang ready untuk hari Sabtu ya, Bunda 😊');
      expect(cleaned).toContain('Untuk jam preferensinya, apakah pagi, siang, atau sore yang lebih memudahkan?');
    });

    it('should sanitize "Tentu bisa Bunda, untuk ketersediaan jadwal hari Sabtu..." -> "Untuk ketersediaan jadwal hari Sabtu..."', () => {
      const llmOutput =
        'Tentu bisa Bunda, untuk ketersediaan jadwal hari Sabtu akan kami bantu cekkan ketersediaan Bidan yang ready ya Bunda 😊';

      const cleaned = sanitizeScheduleAffirmations(llmOutput);

      expect(cleaned).not.toContain('Tentu bisa');
      expect(cleaned).toMatch(/^Untuk ketersediaan jadwal hari Sabtu/);
    });

    it('should sanitize "Pasti bisa Bunda, kami bantu cekkan..." -> "Kami bantu cekkan..."', () => {
      const llmOutput =
        'Pasti bisa Bunda, kami bantu cekkan ketersediaan slot Bidan untuk hari Minggu ya Bunda 😊';

      const cleaned = sanitizeScheduleAffirmations(llmOutput);

      expect(cleaned).not.toContain('Pasti bisa');
      expect(cleaned).toMatch(/^Kami bantu cekkan ketersediaan slot Bidan/);
    });

    it('should sanitize "Bisa kok Bunda, kami bantu cekkan..." -> "Kami bantu cekkan..."', () => {
      const llmOutput =
        'Bisa kok Bunda, kami bantu cekkan ketersediaan jadwal Bidan besok pagi ya 😊';

      const cleaned = sanitizeScheduleAffirmations(llmOutput);

      expect(cleaned).not.toContain('Bisa kok');
      expect(cleaned).toMatch(/^Kami bantu cekkan ketersediaan jadwal/);
    });

    it('should sanitize "Tentu bisa kami jadwalkan..." -> "Kami bantu jadwalkan..."', () => {
      const llmOutput =
        'Tentu bisa kami jadwalkan untuk hari Sabtu ya Bunda 😊';

      const cleaned = sanitizeScheduleAffirmations(llmOutput);

      expect(cleaned).not.toContain('Tentu bisa');
      expect(cleaned).toContain('Kami bantu jadwalkan untuk hari Sabtu ya Bunda');
    });

    it('should sanitize trailing "...bisa ya, Bun" -> "...ya, Bunda"', () => {
      const llmOutput =
        'Untuk jadwal hari Sabtu bisa ya, Bun 😊 Mau jam berapa Bunda?';

      const cleaned = UnifiedResponseSanitizer.sanitize(llmOutput, { historyCount: 1 });

      expect(cleaned).not.toContain('bisa ya, Bun');
      expect(cleaned).not.toContain('bisa ya, Bunda');
      expect(cleaned).toContain('Bunda');
    });
  });

  describe('2. PersonaComposer & System Prompt Rules', () => {
    it('PersonaComposer rules must explicitly forbid affirming schedule with "Tentu bisa" or "Bisa ya"', () => {
      const personaRules = PersonaComposer.getPersonaRules();

      expect(personaRules).toContain('ATURAN PENJADWALAN & KETERSEDIAAN SLOT (ANTI-AFIRMASI JADWAL)');
      expect(personaRules).toContain('DILARANG KERAS mengafirmasi atau menggunakan kata \'Tentu bisa\', \'Bisa Bunda\', \'Bisa ya\', \'Pasti bisa\'');
      expect(personaRules).toContain('Sampaikan secara netral dan santun bahwa ketersediaan jadwal Bidan yang bertugas akan dibantu cekkan terlebih dahulu');
      expect(personaRules).not.toContain('contoh: "Tentu bisa Bunda..."');
    });

    it('BOT_PERSONA_PROMPT must have strict anti-affirmation rule for scheduling', () => {
      expect(BOT_PERSONA_PROMPT).toContain('ATURAN ANTI-AFIRMASI JADWAL (SANGAT KETAT)');
      expect(BOT_PERSONA_PROMPT).toContain('DILARANG KERAS mengafirmasi atau menggunakan kata "Tentu bisa", "Bisa Bunda", "Bisa ya", "Pasti bisa"');
    });
  });

  describe('3. DynamicCloserService Schedule Instructions', () => {
    it('DynamicCloserService must instruct LLM not to affirm with "Tentu bisa" when customer mentions date/schedule', () => {
      const slate = SlateStore.hydrateSlate({
        customer: { id: 'c_sched_1', phone: '6281111111' } as any,
        conversation: { current_state: 'AWAITING_SCHEDULE' } as any,
      });

      const instruction = DynamicCloserService.getCloserInstruction(
        slate,
        undefined,
        [],
        'Hari sabtu bu bidan bisa?'
      );

      expect(instruction).toContain('PANDUAN PENUTUP (TANYA LOKASI RUMAH)');
      expect(instruction).toContain('DILARANG KERAS mengafirmasi dengan kata "Tentu bisa", "Bisa ya", "Bisa Bunda", atau "Pasti bisa"');
      expect(instruction).toContain('Langsung sampaikan bahwa ketersediaan jadwal akan dibantu cekkan terlebih dahulu');
    });

    it('DynamicCloserService SCHEDULE slot missing must forbid "Tentu bisa" and instruct neutral schedule check', () => {
      const slate = SlateStore.hydrateSlate({
        customer: { id: 'c_sched_2', phone: '6281111112', kelurahan: 'Tambakoso', distance_km: 5 } as any,
        conversation: { current_state: 'AWAITING_SCHEDULE' } as any,
      });
      slate.isLocationConfirmed = true;
      slate.selectedTreatmentName = 'Pijat Bayi Ceria';

      const instruction = DynamicCloserService.getCloserInstruction(
        slate,
        undefined,
        [],
        'Hari sabtu jam 10 pagi bisa bu bidan?'
      );

      expect(instruction).toContain('PANDUAN PENAWARAN JADWAL (SCHEDULE)');
      expect(instruction).toContain('DILARANG KERAS mengafirmasi dengan kata "Tentu bisa", "Bisa ya", "Bisa Bunda", atau "Pasti bisa"');
      expect(instruction).toContain('jadwal Bidan akan dicekkan terlebih dahulu');
    });
  });

  describe('4. ResponseValidator', () => {
    it('should validate and clean over-affirmations without failing clean check responses', () => {
      const slate = SlateStore.hydrateSlate({
        customer: { id: 'c_sched_3', phone: '6281111113' } as any,
        conversation: { current_state: 'AWAITING_LOCATION' } as any,
      });

      const neutralReply =
        'Untuk ketersediaan jadwal hari Sabtu, kami bantu cekkan ketersediaan jadwal Bidan yang ready terlebih dahulu ya Bunda 😊 Kalau boleh tahu, rumah Bunda di daerah atau kelurahan mana yaa agar bisa sekalian kami bantu cekkan ongkirnya? 😊';

      const result = ResponseValidator.validate(neutralReply, slate);
      expect(result.isValid).toBe(true);
      expect(result.violations.length).toBe(0);
      expect(result.sanitizedReply).toContain('kami bantu cekkan ketersediaan jadwal Bidan yang ready terlebih dahulu ya Bunda');
    });
  });

  describe('5. Kecamatan Ambiguity & Precise Disambiguation Guard', () => {
    it('Customer only writes "Jambangan" (Kecamatan) -> asks for specific Kelurahan, NOT calculating ongkir immediately', async () => {
      const { DecisionMatrix } = await import('../../src/slot-engine/decision-matrix');
      const slate = SlateStore.hydrateSlate({
        customer: { id: 'c_jambangan_1', phone: '6281111114' } as any,
        conversation: { current_state: 'INITIAL' } as any,
      });

      const extraction = {
        intents: ['provide_location' as const],
        locationText: 'Jambangan',
        streetDetail: null,
        childAgeMonths: null,
        symptoms: [],
        treatmentReferenced: null,
        preferredDateText: null,
        preferredTimeText: null,
        customerName: null,
        isMedicalEmergency: false,
        confidenceScore: 0.9,
      };

      const decision = await DecisionMatrix.evaluate(slate, extraction, {
        incomingText: 'Jambangan',
        history: [],
      });

      expect(decision.action).toBe('RESOLVE_LOCATION_AND_DELIVERY');
      expect(decision.deterministicTemplateReply).toBeDefined();
      expect(decision.deterministicTemplateReply).toContain('Untuk area Kecamatan Jambangan');
      expect(decision.deterministicTemplateReply).toContain('rumah Bunda di kelurahan mana ya?');
      expect(decision.deterministicTemplateReply).not.toContain('kurang lebih 8.4 km');
    });

    it('Customer writes "Jambangan Karah" -> resolves specific Kelurahan Karah and calculates delivery', async () => {
      const { DecisionMatrix } = await import('../../src/slot-engine/decision-matrix');
      const slate = SlateStore.hydrateSlate({
        customer: { id: 'c_jambangan_2', phone: '6281111115' } as any,
        conversation: { current_state: 'INITIAL' } as any,
      });

      const extraction = {
        intents: ['provide_location' as const],
        locationText: 'Jambangan Karah',
        streetDetail: null,
        childAgeMonths: null,
        symptoms: [],
        treatmentReferenced: null,
        preferredDateText: null,
        preferredTimeText: null,
        customerName: null,
        isMedicalEmergency: false,
        confidenceScore: 0.9,
      };

      const decision = await DecisionMatrix.evaluate(slate, extraction, {
        incomingText: 'Jambangan Karah',
        history: [],
      });

      expect(decision.action).toBe('RESOLVE_LOCATION_AND_DELIVERY');
      expect(decision.updatedSlate.isLocationConfirmed).toBe(true);
      expect(decision.updatedSlate.kelurahan).toBe('Karah');
      expect(decision.updatedSlate.kecamatan).toBe('Jambangan');
    });

    it('Customer writes "Kelurahan Jambangan" -> resolves Kelurahan Jambangan and calculates delivery', async () => {
      const { DecisionMatrix } = await import('../../src/slot-engine/decision-matrix');
      const slate = SlateStore.hydrateSlate({
        customer: { id: 'c_jambangan_3', phone: '6281111116' } as any,
        conversation: { current_state: 'INITIAL' } as any,
      });

      const extraction = {
        intents: ['provide_location' as const],
        locationText: 'Kelurahan Jambangan',
        streetDetail: null,
        childAgeMonths: null,
        symptoms: [],
        treatmentReferenced: null,
        preferredDateText: null,
        preferredTimeText: null,
        customerName: null,
        isMedicalEmergency: false,
        confidenceScore: 0.9,
      };

      const decision = await DecisionMatrix.evaluate(slate, extraction, {
        incomingText: 'Kelurahan Jambangan',
        history: [],
      });

      expect(decision.action).toBe('RESOLVE_LOCATION_AND_DELIVERY');
      expect(decision.updatedSlate.isLocationConfirmed).toBe(true);
      expect(decision.updatedSlate.kelurahan).toBe('Jambangan');
      expect(decision.updatedSlate.kecamatan).toBe('Jambangan');
    });
  });

  describe('6. Turn-0 Greeting Header Enforcement on First Customer Message', () => {
    it('should prepend official greeting header when historyCount is 0 in FastFaqGenerator / ReplyGenerator', async () => {
      const { TEMPLATES } = await import('../../src/config/persona');
      const greetingHeader = TEMPLATES.firstContactGreetingHeader({ isIslamic: false });

      expect(greetingHeader).toContain('Halo Bunda ! ✨');
      expect(greetingHeader).toContain('Perkenalkan, saya Bidan Yusi');
      expect(greetingHeader).toContain('Treatment moms & Baby');
    });

    it('Customer asks "ke surabaya bisa ?" on Turn-0 -> prepends official greeting header and provides coverage policy without affirmation slop', async () => {
      const { DecisionMatrix } = await import('../../src/slot-engine/decision-matrix');
      const slate = SlateStore.hydrateSlate({
        customer: { id: 'c_sby_1', phone: '6281111119' } as any,
        conversation: { current_state: 'INITIAL' } as any,
      });

      const extraction = {
        intents: [],
        locationText: 'surabaya',
        streetDetail: null,
        childAgeMonths: null,
        symptoms: [],
        treatmentReferenced: null,
        preferredDateText: null,
        preferredTimeText: null,
        customerName: null,
        isMedicalEmergency: false,
        confidenceScore: 0.9,
      };

      const decision = await DecisionMatrix.evaluate(slate, extraction, {
        incomingText: 'ke surabaya bisa ?',
        history: [],
      });

      expect(decision.action).toBe('RESOLVE_LOCATION_AND_DELIVERY');
      expect(decision.deterministicTemplateReply).toBeDefined();
      expect(decision.deterministicTemplateReply).toContain('Halo Bunda ! ✨');
      expect(decision.deterministicTemplateReply).toContain('Perkenalkan, saya Bidan Yusi');
      expect(decision.deterministicTemplateReply).toContain('Layanan homecare kami melayani seluruh area Sidoarjo dan Surabaya');
      expect(decision.deterministicTemplateReply).not.toContain('Bisa banget Bunda');
    });
  });
});
