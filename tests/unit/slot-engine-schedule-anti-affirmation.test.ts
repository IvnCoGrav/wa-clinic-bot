import { describe, it, expect } from 'vitest';
import { UnifiedResponseSanitizer, sanitizeScheduleAffirmations } from '../../src/utils/language-sanitizer';
import { ResponseValidator } from '../../src/slot-engine/response-validator';
import { PersonaComposer } from '../../src/slot-engine/persona-composer';
import { DynamicCloserService } from '../../src/slot-engine/dynamic-closer.service';
import { SlateStore } from '../../src/slot-engine/slate-store';
import { BOT_PERSONA_PROMPT } from '../../src/config/persona';

describe('Anti-Affirmation Schedule Guard (Jangan Mengafirmasi Jadwal "Bisa")', () => {
  describe('1. UnifiedResponseSanitizer & sanitizeScheduleAffirmations', () => {
    it('Customer asks "Hari sabtu bu bidan bisa?" -> sanitizer no longer strips "Tentu bisa" (ResponseValidator handles it)', () => {
      const llmOutput =
        'Tentu bisa, kami bantu cekkan ketersediaan jadwal Bidan yang ready untuk hari Sabtu ya, Bun 😊 Untuk jam preferensinya, apakah pagi, siang, atau sore yang lebih memudahkan?';

      const cleaned = UnifiedResponseSanitizer.sanitize(llmOutput, { historyCount: 1 });

      // Sanitizer destructive dipangkas di Fase 4.5 — "Tentu bisa" tetap, Validator yang jaga
      expect(cleaned.toLowerCase()).toContain('tentu bisa');
      expect(cleaned).toContain('Bunda');
      expect(cleaned.toLowerCase()).toContain('kami bantu cekkan ketersediaan jadwal');
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
      expect(personaRules).toContain('Sampaikan secara netral dan santun bahwa ketersediaan jadwal Bidan yang bertugas di hari tersebut akan dibantu cekkan terlebih dahulu');
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

    it('Customer asks "ke jombang bisa nggak ?" -> DecisionMatrix or Out of Coverage triggers polite apology', async () => {
      const { DecisionMatrix } = await import('../../src/slot-engine/decision-matrix');
      const slate = SlateStore.hydrateSlate({
        customer: { id: 'c_jombang_1', phone: '6281111120' } as any,
        conversation: { current_state: 'INITIAL' } as any,
      });

      const extraction = {
        intents: [],
        locationText: 'jombang',
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
        incomingText: 'ke jombang bisa nggak ?',
        history: [],
      });

      // It should NOT escalate to medical or silent emergency
      expect(decision.action).not.toBe('ESCALATE_HUMAN_EMERGENCY');
      expect(decision.action).not.toBe('SILENT_HUMAN_ACTIVE');
    });

    it('Customer asks "ke tuban bisa ?" on Turn-0 (with pre-logged inbound message in history) -> Out of Coverage has Turn-0 greeting header', async () => {
      const { DecisionMatrix } = await import('../../src/slot-engine/decision-matrix');
      const { geocodingService } = await import('../../src/integrations/google-maps/geocoding');
      
      const geocodeSpy = vi.spyOn(geocodingService, 'geocodeText').mockResolvedValueOnce({
        isPrecise: true,
        lat: -6.8988,
        lng: 112.0526,
        kota: 'Tuban',
        formattedAddress: 'Tuban, Jawa Timur',
      });

      const slate = SlateStore.hydrateSlate({
        customer: { id: 'c_tuban_1', phone: '6281111121' } as any,
        conversation: { current_state: 'INITIAL' } as any,
      });

      const extraction = {
        intents: [],
        locationText: 'tuban',
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

      // Simulasikan database history yang memuat pesan inbound yang baru saja di-log (1 user message, 0 assistant messages)
      const decision = await DecisionMatrix.evaluate(slate, extraction, {
        incomingText: 'ke tuban bisa ?',
        history: [{ role: 'user', content: 'ke tuban bisa ?' }],
      });

      expect(decision.action).toBe('REJECT_OUT_OF_COVERAGE');
      expect(decision.deterministicTemplateReply).toBeDefined();
      expect(decision.deterministicTemplateReply).toContain('Halo Bunda ! ✨');
      expect(decision.deterministicTemplateReply).toContain('Perkenalkan, saya Bidan Yusi');
      expect(decision.deterministicTemplateReply).toContain('di luar jangkauan');

      geocodeSpy.mockRestore();
    });

    it('Customer was previously out-of-coverage (Tuban) -> then sends "Jambangan" -> resolves Jambangan and does NOT reject with out-of-coverage', async () => {
      const { DecisionMatrix } = await import('../../src/slot-engine/decision-matrix');
      // Slate sebelumnya menyimpan isOutOfCoverage: true dari pesan Tuban
      const slate = SlateStore.hydrateSlate({
        customer: {
          id: 'c_tuban_to_jambangan',
          phone: '6281111122',
          preferences: { isOutOfCoverage: true, distanceKm: 142.3, location: 'tuban' },
        } as any,
        conversation: { current_state: 'AWAITING_LOCATION' } as any,
      });

      expect(slate.isOutOfCoverage).toBe(true);

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
        history: [
          { role: 'user', content: 'ke tuban bisa ?' },
          { role: 'assistant', content: 'Mohon maaf bunda, lokasi Bunda berjarak 142.3 km...' },
          { role: 'user', content: 'Jambangan' },
        ],
      });

      // Seharusnya meminta detail kelurahan untuk Jambangan (bukan menolak out-of-coverage Tuban)
      expect(decision.action).toBe('RESOLVE_LOCATION_AND_DELIVERY');
      expect(decision.action).not.toBe('REJECT_OUT_OF_COVERAGE');
      expect(decision.deterministicTemplateReply).toBeDefined();
      expect(decision.deterministicTemplateReply).toContain('Jambangan');
      expect(decision.deterministicTemplateReply).not.toContain('142.3 km');
    });

    it('Customer asks "ke tuban berapa" -> then "ke kenjeran ?" -> asks for kelurahan in Kenjeran, NOT "lokasi di Tuban sudah disimpan"', async () => {
      const { DecisionMatrix } = await import('../../src/slot-engine/decision-matrix');
      const slate = SlateStore.hydrateSlate({
        customer: {
          id: 'c_tuban_to_kenjeran',
          phone: '6281111123',
          preferences: { isOutOfCoverage: true, distanceKm: 142.3, kelurahan: 'Tuban' },
        } as any,
        conversation: { current_state: 'AWAITING_LOCATION' } as any,
      });

      const extraction = {
        intents: ['provide_location' as const],
        locationText: 'kenjeran',
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
        incomingText: 'ke kenjeran ?',
        history: [
          { role: 'user', content: 'ke tuban berapa' },
          { role: 'assistant', content: 'Mohon maaf bunda, lokasi Bunda berjarak 142.3 km...' },
          { role: 'user', content: 'ke kenjeran ?' },
        ],
      });

      expect(decision.action).toBe('RESOLVE_LOCATION_AND_DELIVERY');
      expect(decision.deterministicTemplateReply).toBeDefined();
      expect(decision.deterministicTemplateReply).toContain('Kenjeran');
      expect(decision.deterministicTemplateReply).not.toContain('lokasi di Tuban sudah kami simpan');
      expect(decision.deterministicTemplateReply).not.toContain('142.3 km');
    });

    it('Customer writes typo "ke kencjeran berap aya kak ?" -> fuzzy resolves to Kenjeran and asks for kelurahan', async () => {
      const { DecisionMatrix } = await import('../../src/slot-engine/decision-matrix');
      const slate = SlateStore.hydrateSlate({
        customer: { id: 'c_typo_kencjeran', phone: '6281111124' } as any,
        conversation: { current_state: 'INITIAL' } as any,
      });

      const extraction = {
        intents: ['provide_location' as const, 'ask_price' as const],
        locationText: 'kencjeran',
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
        incomingText: 'ke kencjeran berap aya kak ?',
        history: [],
      });

      expect(decision.action).toBe('RESOLVE_LOCATION_AND_DELIVERY');
      expect(decision.deterministicTemplateReply).toBeDefined();
      expect(decision.deterministicTemplateReply).toContain('Kenjeran');
      expect(decision.deterministicTemplateReply).not.toContain('Kencana');
    });

    it('Customer only asks symptom/treatment availability "Untuk pijat flu ada kah kak ??" -> sanitizer preserves price/duration (Validator now guards)', async () => {
      const { UnifiedResponseSanitizer } = await import('../../src/utils/language-sanitizer');
      const rawLlmReply =
        'Ada ya, Bunda! 😊 Untuk pijat flu, kami punya layanan *Pijat Bayi Pulih Ceria (Terapi Bapil)* dengan tarif promo Rp 70.000 durasi sekitar 40 menit. Pijat ini menggunakan double aromaterapi dan titik pijat akupresur khusus yang bantu meredakan flu pada si kecil.';

      const sanitized = UnifiedResponseSanitizer.sanitize(rawLlmReply, {
        customerInput: 'Untuk pijat flu ada kah kak ??',
        isFollowUp: true,
      });

      expect(sanitized).toContain('Pijat Bayi Pulih Ceria');
      // Fase 4.5: sanitizer destructive dipangkas — harga/durasi tetap, Validator yang jaga halusinasi
      expect(sanitized).toContain('Rp 70.000');
      expect(sanitized).toContain('40 menit');
    });

    it('Customer explicitly asks for price & duration "pijat flu berapa harganya dan berapa menit?" -> preserves price and duration', async () => {
      const { UnifiedResponseSanitizer } = await import('../../src/utils/language-sanitizer');
      const rawLlmReply =
        'Untuk *Pijat Bayi Pulih Ceria (Terapi Bapil)*, tarif promo Rp 70.000 dengan durasi sekitar 40 menit ya Bunda 😊';

      const sanitized = UnifiedResponseSanitizer.sanitize(rawLlmReply, {
        customerInput: 'pijat flu berapa harganya dan berapa menit?',
        isFollowUp: true,
      });

      expect(sanitized).toContain('Rp 70.000');
      expect(sanitized).toContain('40 menit');
    });

    it('Turn-0 header injection strips duplicate LLM greeting ("Halo Bunda! ✨ Terima kasih sudah menghubungi...")', async () => {
      const { stripDuplicateTurn0Greeting } = await import('../../src/utils/language-sanitizer');
      const { TEMPLATES } = await import('../../src/config/persona');

      const rawLlmReply =
        'Halo Bunda! ✨ Terima kasih sudah menghubungi Kala Moms and Baby Spa. Ada ya, untuk membantu meredakan flu pada si kecil, kami punya layanan *Pijat Bayi Pulih Ceria*...';

      const cleanBody = stripDuplicateTurn0Greeting(rawLlmReply);
      const greetingHeader = TEMPLATES.firstContactGreetingHeader();
      const finalReply = `${greetingHeader}\n\n${cleanBody}`;

      // Memastikan hanya ada 1 sapaan "Halo Bunda" dan 1 perkenalan Bidan Yusi
      const haloMatches = finalReply.match(/Halo\s+Bunda/gi) || [];
      expect(haloMatches.length).toBe(1);
      expect(cleanBody.startsWith('Ada ya,')).toBe(true);
      expect(finalReply).toContain('Perkenalkan, saya Bidan Yusi');
    });
  });

  describe('7. Standard Massage Alias (Massage Biasa) & Direct Schedule Question', () => {
    it('EntityExtractor: "Massage biasa" -> normalized to generic alias "pijat bayi" + intent "select_treatment"', async () => {
      const { EntityExtractor } = await import('../../src/slot-engine/entity-extractor');
      const res = await EntityExtractor.extract('Massage biasa');
      expect(res.treatmentReferenced?.toLowerCase()).toBe('pijat bayi');
      expect(res.intents).toContain('select_treatment');
    });

    it('EntityExtractor: "pijat biasa aja" -> normalized to generic alias "pijat bayi"', async () => {
      const { EntityExtractor } = await import('../../src/slot-engine/entity-extractor');
      const res = await EntityExtractor.extract('pijat biasa aja');
      expect(res.treatmentReferenced?.toLowerCase()).toBe('pijat bayi');
      expect(res.intents).toContain('select_treatment');
    });

    it('DynamicCloserService: When treatment is selected, missing slot is SCHEDULE and forbids explaining treatment details', () => {
      const slate: any = {
        isLocationConfirmed: true,
        kelurahan: 'Sepanjang',
        selectedTreatmentName: 'Pijat Bayi Ceria',
      };
      const missing = DynamicCloserService.determineMissingSlot(slate);
      expect(missing).toBe('SCHEDULE');

      const instruction = DynamicCloserService.getCloserInstruction(slate, null, [], 'Massage biasa');
      expect(instruction).toContain('DILARANG KERAS menjelaskan ulang manfaat');
      expect(instruction).toContain('rencana mau kami bantu jadwalkan di hari apa');
    });

    it('PersonaComposer: Rule 12 forbids explaining treatment details when customer has selected a treatment', () => {
      const rules = PersonaComposer.getPersonaRules();
      expect(rules).toContain('ATURAN SAAT CUSTOMER SUDAH MEMILIH / MENENTUKAN TREATMENT');
      expect(rules).toContain('DILARANG KERAS menjelaskan ulang rincian, deskripsi, manfaat');
    });

    it('PersonaComposer: Rule 13 forbids hallucinating unlisted services and triggers human handover', () => {
      const rules = PersonaComposer.getPersonaRules();
      expect(rules).toContain('ATURAN LAYANAN DI LUAR KATALOG RESMI (ANTI-HALUSINASI & HANDOVER CS)');
      expect(rules).toContain('DILARANG KERAS mengarang atau mengiyakan');
      expect(rules).toContain('is_unlisted_service');
    });

    it('EntityExtractor: "Ada PL homecare mandikan bayi?" extracts intent "ask_unlisted_service"', async () => {
      const { EntityExtractor } = await import('../../src/slot-engine/entity-extractor');
      const res = await EntityExtractor.extract('Ada PL homecare mandikan bayi?');
      expect(res.intents).toContain('ask_unlisted_service');
    });

    it('DecisionMatrix: "Ada PL homecare mandikan bayi?" returns action "ESCALATE_HUMAN_UNLISTED_SERVICE" with isHumanHandling = true', async () => {
      const { DecisionMatrix } = await import('../../src/slot-engine/decision-matrix');
      const { EntityExtractor } = await import('../../src/slot-engine/entity-extractor');
      const { SlateStore } = await import('../../src/slot-engine/slate-store');
      const slate = SlateStore.hydrateSlate({
        customer: { id: 'c_test_unlisted', phone: '6282349966953' } as any,
        conversation: { current_state: 'INITIAL' } as any,
      });
      const extraction = await EntityExtractor.extract('Ada PL homecare mandikan bayi?');

      const decision = await DecisionMatrix.evaluate(slate, extraction, {
        incomingText: 'Ada PL homecare mandikan bayi?',
      });

      expect(decision.action).toBe('ESCALATE_HUMAN_UNLISTED_SERVICE');
      expect(decision.updatedSlate.isHumanHandling).toBe(true);
      expect(decision.shouldSendPricelistImage).toBe(false);
    });

    it('SlotEngine: "Ada PL homecare mandikan bayi?" executes silent human escalation (shouldSendReply = false)', async () => {
      const { processSlotEngine } = await import('../../src/slot-engine/slot-engine');
      const { ConversationState } = await import('@prisma/client');

      const result = await processSlotEngine({
        customer: { id: 'c_test_unlisted', phone: '6282349966953' } as any,
        conversation: { id: 'conv_unlisted_1', current_state: ConversationState.INITIAL } as any,
        incomingMessage: { text: { body: 'Ada PL homecare mandikan bayi?' } } as any,
        tenantId: 'default-tenant',
      });

      expect(result.shouldSendReply).toBe(false);
      expect(result.isHumanHandling).toBe(true);
      expect(result.nextState).toBe(ConversationState.HUMAN_HANDLING);
    });

    it('DecisionMatrix: "SBY barat kk" asks for specific kelurahan, does NOT confirm location or send pricelist', async () => {
      const { DecisionMatrix } = await import('../../src/slot-engine/decision-matrix');
      const { EntityExtractor } = await import('../../src/slot-engine/entity-extractor');
      const { SlateStore } = await import('../../src/slot-engine/slate-store');
      const slate = SlateStore.hydrateSlate({
        customer: { id: 'c_test_sby_barat', phone: '6285792185307' } as any,
        conversation: { current_state: 'INITIAL' } as any,
      });
      const extraction = await EntityExtractor.extract('SBY barat kk');

      const decision = await DecisionMatrix.evaluate(slate, extraction, {
        incomingText: 'SBY barat kk',
      });

      expect(decision.action).toBe('RESOLVE_LOCATION_AND_DELIVERY');
      expect(decision.updatedSlate.isLocationConfirmed).toBe(false);
      expect(decision.shouldSendPricelistImage).toBe(false);
      expect(decision.deterministicTemplateReply).toMatch(/kelurahan|desa/i);
    });

    it('DecisionMatrix: "Ini daerah mn kak" triggers clinic origin policy', async () => {
      const { DecisionMatrix } = await import('../../src/slot-engine/decision-matrix');
      const { EntityExtractor } = await import('../../src/slot-engine/entity-extractor');
      const { SlateStore } = await import('../../src/slot-engine/slate-store');
      const slate = SlateStore.hydrateSlate({
        customer: { id: 'c_test_origin', phone: '6281230133633' } as any,
        conversation: { current_state: 'INITIAL' } as any,
      });
      const extraction = await EntityExtractor.extract('Ini daerah mn kak');

      const decision = await DecisionMatrix.evaluate(slate, extraction, {
        incomingText: 'Ini daerah mn kak',
      });

      expect(decision.action).toBe('RESOLVE_LOCATION_AND_DELIVERY');
      expect(decision.shouldSendPricelistImage).toBe(false);
      expect(decision.deterministicTemplateReply).toMatch(/Waru.*Sidoarjo/i);
    });

    it('DecisionMatrix: Selecting treatment when location is confirmed does NOT re-trigger ongkir template', async () => {
      const { DecisionMatrix } = await import('../../src/slot-engine/decision-matrix');
      const { EntityExtractor } = await import('../../src/slot-engine/entity-extractor');
      const { SlateStore } = await import('../../src/slot-engine/slate-store');

      const slate = SlateStore.hydrateSlate({
        customer: {
          id: 'c_test_treatment_select',
          phone: '6281234567890',
          kelurahan: 'Wiyung',
          kecamatan: 'Wiyung',
          distance_km: 12.5,
          ongkir: 15000,
        } as any,
        conversation: { current_state: 'LOCATION_CONFIRMED' } as any,
      });
      slate.isLocationConfirmed = true;
      slate.distanceKm = 12.5;
      slate.ongkirFee = 25000;
      slate.ongkirPromoFee = 15000;

      // Simulate extraction of "Yang pijat bayi ceriaajakak"
      const extraction = await EntityExtractor.extract('Yang pijat  bayi ceriaajakak', {
        history: [
          { role: 'user', content: 'Di dukuh pakis gang 2 kak' },
          { role: 'assistant', content: 'Jika dilihat dari jaraknya kurang lebih 12.5 km... Rencana mau treatment apa bunda ?' },
        ],
      });

      // Verification 1: Anti-leak guard stripped locationText
      expect(extraction.locationText).toBeNull();
      expect(extraction.streetDetail).toBeNull();

      const decision = await DecisionMatrix.evaluate(slate, extraction, {
        incomingText: 'Yang pijat  bayi ceriaajakak',
      });

      // Verification 2: Does NOT re-trigger RESOLVE_LOCATION_AND_DELIVERY or repeat ongkir template
      expect(decision.action).toBe('GENERATE_AI_RESPONSE');
      expect(decision.deterministicTemplateReply).toBeUndefined();
    });
  });
});

