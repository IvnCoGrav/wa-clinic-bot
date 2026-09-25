import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConversationState } from '@prisma/client';
import { validateFactualClaims } from '../../src/v3/guardrails/factual-claim-validator';
import { ConversationStateMachine } from '../../src/state-machine/machine';
import { customerService } from '../../src/services/customer.service';
import { conversationService } from '../../src/services/conversation.service';
import { V3AgentRunner } from '../../src/v3/agent/agent-runner';
import { GenerationStage } from '../../src/v3/agent/pipeline/generation-stage';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

/**
 * Fase D — Validator klaim faktual non-angka (D1..D5, D7).
 * Gagal setelah re-prompt 1x → SUNYI TOTAL + eskalasi unresolved_faq.
 */
describe('Factual claim validator', () => {
  const catalogTools = (names: string[], durations: number[]) => [{
    name: 'get_catalog_and_price',
    args: {},
    result: {
      success: true,
      treatments: names.map((n, i) => ({ name: n, durationMinutes: durations[i] ?? 60 })),
    },
  }];
  const knowledgeTools = (chunks: any[]) => [{
    name: 'search_knowledge_faq', args: {}, result: { success: true, chunks },
  }];
  const policyTools = () => [{ name: 'get_clinic_policy_faq', args: {}, result: { success: true } }];

  it('D1: nama layanan karangan di-bold → invalid; yang ada di katalog → valid', () => {
    const tools = catalogTools(['Pijat Laktasi', 'Pijat Bayi Ceria'], [60, 45]);
    const bad = validateFactualClaims('Bisa ambil *Pijat Laktasi Premium* ya Bunda 😊', tools);
    expect(bad.isValid).toBe(false);
    expect(bad.violations.join(' ')).toMatch(/Pijat Laktasi Premium/);
    const good = validateFactualClaims('Bisa ambil *Pijat Laktasi* ya Bunda 😊', tools);
    expect(good.isValid).toBe(true);
  });

  it('D1: bold generik ("promo", "jadwal") tidak ditandai', () => {
    const tools = catalogTools(['Pijat Laktasi'], [60]);
    expect(validateFactualClaims('Lihat *promo* dan *jadwal* kami ya', tools).isValid).toBe(true);
  });

  it('D2: bahas vaksin tanpa tool kebijakan → invalid; dengan tool → valid', () => {
    expect(validateFactualClaims('Habis vaksin boleh langsung pijat ya Bunda', []).isValid).toBe(false);
    expect(validateFactualClaims('Habis vaksin boleh langsung pijat ya Bunda', policyTools()).isValid).toBe(true);
  });

  it('D3: anjuran SOP tanpa artikel → invalid; dengan chunks → valid', () => {
    const text = 'Sebaiknya bayi dimandikan dengan air hangat setiap hari agar tidak rewel dan tidurnya nyenyak ya Bunda';
    expect(validateFactualClaims(text, []).isValid).toBe(false);
    expect(validateFactualClaims(text, knowledgeTools([{ id: '1', content: 'mandi air hangat' }])).isValid).toBe(true);
  });

  it('D4: durasi tekstual beda katalog → invalid; cocok → valid', () => {
    const tools = catalogTools(['Pijat Bayi Ceria'], [30]);
    expect(validateFactualClaims('Durasinya 45 menit ya Bunda', tools).isValid).toBe(false);
    expect(validateFactualClaims('Durasinya 30 menit ya Bunda', tools).isValid).toBe(true);
  });

  it('D5: klaim absolut → invalid; balasan normal → valid', () => {
    expect(validateFactualClaims('Pijat ini dijamin menyembuhkan batuk si kecil', []).isValid).toBe(false);
    expect(validateFactualClaims('Pijat ini membantu meredakan batuk si kecil ya Bunda', []).isValid).toBe(true);
  });

  it('D6: "Area Kecamatan Waru" tanpa lokasi sesi → invalid (kasus simulator 725870)', () => {
    const text = 'Area Kecamatan Waru ini masih cukup luas. Kalau boleh tahu, rumah Bunda di kelurahan mana ya?';
    const bad = validateFactualClaims(text, [], [], { locationKnown: false });
    expect(bad.isValid).toBe(false);
    expect(bad.violations.join(' ')).toMatch(/Domicile/i);
  });

  // Plan regresi Fase 1 (Sesi 580976): kecamatan yang ditanyakan customer
  // adalah grounding sah — DILARANG dituduh halusinasi walau sesi kosong.
  it('D6: Kecamatan Kenjeran valid jika ditanyakan customer di incoming input', () => {
    const draft = 'Untuk area Kecamatan Kenjeran, wilayahnya masih cukup luas ya Bunda 🙏 Kalau boleh tahu rumahnya di kelurahan atau perumahan mana ya? Biar sekalian kami bantu cekkan jarak pasti dan ongkir promonya 🤗';
    const ok = validateFactualClaims(draft, [], [], { locationKnown: false, customerInput: 'ke kenjeran berapa ya' });
    expect(ok.isValid).toBe(true);
    // Kontrol negatif: tanpa disebut customer → tetap halusinasi.
    const bad = validateFactualClaims(draft, [], [], { locationKnown: false, customerInput: 'pijat bayi berapa' });
    expect(bad.isValid).toBe(false);
    expect(bad.violations.join(' ')).toMatch(/Domicile/i);
  });

  it('D6: Kecamatan Kenjeran valid jika dikembalikan oleh calculate_delivery', () => {
    const draft = 'Untuk area Kecamatan Kenjeran, wilayahnya masih cukup luas ya Bunda 🙏 Kalau boleh tahu rumahnya di kelurahan atau perumahan mana ya?';
    const tools = [{ name: 'calculate_delivery', args: { locationText: 'Kenjeran' }, result: { success: true, kecamatan: 'Kenjeran' } }];
    const ok = validateFactualClaims(draft, tools, [], { locationKnown: false, customerInput: 'ke kenjeran berapa ya' });
    expect(ok.isValid).toBe(true);
    // Grounding via args.locationText saja (tanpa result.kecamatan) ikut sah.
    const toolsArgsOnly = [{ name: 'calculate_delivery', args: { locationText: 'Kenjeran, Surabaya' }, result: { success: false } }];
    expect(validateFactualClaims(draft, toolsArgsOnly, [], { locationKnown: false }).isValid).toBe(true);
  });

  it('D6 adversarial: "warung" TIDAK membebaskan klaim "Waru" (kata-utuh, bukan substring)', () => {
    const draft = 'Area Kecamatan Waru ini masih cukup luas. Kalau boleh tahu, rumah Bunda di kelurahan mana ya?';
    const bad = validateFactualClaims(draft, [], [], { locationKnown: false, customerInput: 'di warung depan gang' });
    expect(bad.isValid).toBe(false);
    expect(bad.violations.join(' ')).toMatch(/Domicile/i);
  });

  it('D6: fakta homebase dikecualikan; lokasi dikenal dilewati; kecamatan fiktif di luar cakupan', () => {
    const homebase = 'Homebase kami ada di Waru, Sidoarjo ya Bunda. Kalau boleh tahu rumah Bunda di daerah mana ya?';
    expect(validateFactualClaims(homebase, [], [], { locationKnown: false }).isValid).toBe(true);
    const known = 'Area Kecamatan Waru ini masih cukup luas ya Bunda';
    expect(validateFactualClaims(known, [], [], { locationKnown: true }).isValid).toBe(true);
    const fiktif = 'Area Kecamatan Ngalor Kidul ini masih cukup luas ya Bunda';
    expect(validateFactualClaims(fiktif, [], [], { locationKnown: false }).isValid).toBe(true);
  });

  it('D7: draf memuat kata keagamaan tanpa pemicu -> invalid; bila dipicu customer -> valid', () => {
    const unprompted = validateFactualClaims(
      'Alhamdulillah, area Bungurasih masuk dalam jangkauan layanan homecare kami ya Bunda.',
      [],
      [],
      { customerInput: 'bungurasih kal' }
    );
    expect(unprompted.isValid).toBe(false);
    expect(unprompted.violations.join(' ')).toContain('D7_UNPROMPTED_RELIGIOUS_PHRASE');

    const prompted = validateFactualClaims(
      'Waalaikumsalam Bunda, area Bungurasih masuk dalam jangkauan Bidan kami.',
      [],
      [],
      { customerInput: 'assalamualaikum mbak bungurasih bisa?' }
    );
    expect(prompted.isValid).toBe(true);

    const feedback = validateFactualClaims(
      'Alhamdulillah, kami ikut senang mendengarnya Bunda 🤗',
      [],
      [],
      { customerInput: 'alhamdulillah pijatnya enak banget' }
    );
    expect(feedback.isValid).toBe(true);
  });

  it('D5 integrasi: klaim absolut lolos re-prompt → ESKALASI DENGAN BALASAN SOPAN (anti-silent-drop)', async () => {
    const sentToCustomer: string[] = [];
    const sm = new ConversationStateMachine({
      simulateHumanReply: async (params: any) => {
        sentToCustomer.push(params.replyText);
        return { success: true };
      },
    } as any);
    process.env.HUMANIZER_ENABLED = 'false';
    process.env.LLM_API_KEY = 'mock_key';
    vi.restoreAllMocks();

    // LLM selalu mengarang klaim absolut — Call-1 maupun re-prompt.
    vi.spyOn(GenerationStage, 'executeChatCompletion').mockResolvedValue({
      choices: [{ message: { content: 'Tenang Bunda, treatment kami dijamin menyembuhkan batuk pilek si kecil tanpa efek samping sama sekali.' } }],
    } as any);

    const phone = `62890${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const customer = await customerService.getOrCreateCustomer(phone, 'Bunda Faktual', DEFAULT_TENANT_ID);
    const result = await sm.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer,
      conversation: await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID),
      incomingMessage: {
        id: `msg_fd_${Date.now()}`,
        from: phone,
        timestamp: '1700000000',
        type: 'text',
        text: { body: 'anak saya batuk pilek' },
      },
    });

    // Hard Invariant: Tidak boleh silent drop — balasan ramah pengalihan tetap terkirim
    expect(result.shouldSendReply).toBe(true);
    expect(result.replyText).toMatch(/Mohon maaf Bunda.*kami teruskan langsung ke tim Bidan kami/i);
    expect(result.nextState).toBe(ConversationState.HUMAN_HANDLING);
    expect(sentToCustomer.length).toBe(1);
    expect(sentToCustomer[0]).toMatch(/Bidan kami/i);

    const updated = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    expect(updated.is_human_handling).toBe(true);
    expect(updated.escalation_reason).toBe('unresolved_faq');
  });

  // D8 (fondasional, gerbang kode deterministik): narasi asal basecamp/homebase
  // yang disisipkan ke balasan info ongkir — preseden D7 (kognitif re-prompt,
  // bukan mutilasi regex). Gate berbasis kontrak tool turn ini, bukan hafalan
  // kalimat: calculate_delivery sukses + get_clinic_policy_faq TIDAK terpanggil.
  describe('D8: narasi asal basecamp pada info ongkir (tanpa tanya lokasi klinik)', () => {
    const deliveryTools = () => [{
      name: 'calculate_delivery',
      args: { locationText: 'bungurasih' },
      result: { success: true, kelurahan: 'Bungurasih', kecamatan: 'Waru' },
    }];
    const policyTools = () => [{ name: 'get_clinic_policy_faq', args: {}, result: { success: true } }];

    it.each([
      'Jika dilihat dari jaraknya kurang lebih 5.5 km dari basecamp kami di Waru ya Bunda',
      'Dari homebase kami di Waru ke Bungurasih kurang lebih 5.5 km ya Bunda',
      'Basecamp kami berada di daerah Waru, jaraknya kurang lebih 5.5 km ya Bunda',
      'Jarak dari klinik kami di Waru kurang lebih 5.5 km ya Bunda',
    ])('varian parafrase "%s" → invalid bila delivery sukses tanpa tool kebijakan', (text) => {
      const bad = validateFactualClaims(text, deliveryTools(), [], { locationKnown: true });
      expect(bad.isValid).toBe(false);
      expect(bad.violations.join(' ')).toMatch(/D8_ORIGIN_NARRATION/);
    });

    it('dibebaskan bila get_clinic_policy_faq terpanggil (jawaban asal klinik sah)', () => {
      const text = 'Basecamp kami berada di daerah Waru, perbatasan Surabaya Sidoarjo ya Bunda';
      const ok = validateFactualClaims(text, [...deliveryTools(), ...policyTools()], [], { locationKnown: true });
      expect(ok.isValid).toBe(true);
    });

    it('dibebaskan bila tanpa calculate_delivery (jawaban murni tanya lokasi)', () => {
      const text = 'Basecamp kami berada di daerah Waru, perbatasan Surabaya Sidoarjo ya Bunda';
      expect(validateFactualClaims(text, [], [], { locationKnown: false }).isValid).toBe(true);
    });

    it('template ongkir SOP murni tanpa narasi asal → valid (tanpa false positive)', () => {
      const text = 'Jika dilihat dari jaraknya kurang lebih 5.5 km. Dari pricelist kami di jarak ini ada tambahan ongkir *Rp 15.000* tetapi karna bulan ini ada promo, kami bisa kasih bunda ongkir menjadi *Rp 5.000* saja bunda. Jadi bisa ya bunda';
      const ok = validateFactualClaims(text, deliveryTools(), [], { locationKnown: true });
      expect(ok.isValid).toBe(true);
    });
  });

  // D10 — Anti-Amnesia Keluhan (sesi 796217): pola generik, bukan hafalan kalimat.
  describe('D10: tanya-keluhan saat symptomsKnown=true → invalid; false → valid', () => {
    it.each([
      'boleh dibagikan keluhan atau kondisi si kecil saat ini ya',
      'Apakah saat ini si kecil ada keluhan tertentu Bunda',
      'ada keluhan apa si kecil Bunda',
      'Apakah ada keluhan tertentu pada si kecil',
    ])('varian parafrase "%s" → invalid bila symptomsKnown', (text) => {
      const bad = validateFactualClaims(`Untuk Lahap ya Bunda. ${text} 🤗`, [], [], { symptomsKnown: true });
      expect(bad.isValid).toBe(false);
      expect(bad.violations.join(' ')).toMatch(/D10_SYMPTOM_AMNESIA/);
    });

    it('symptomsKnown=false → tanya keluhan sah (valid)', () => {
      const ok = validateFactualClaims('Apakah saat ini si kecil ada keluhan tertentu Bunda, atau untuk pijat sehat relaksasi saja?', [], [], { symptomsKnown: false });
      expect(ok.isValid).toBe(true);
    });

    it('tanpa opts → tanya keluhan sah (gate mati, valid)', () => {
      const ok = validateFactualClaims('boleh dibagikan keluhan atau kondisi si kecil saat ini ya', []);
      expect(ok.isValid).toBe(true);
    });

    it('"untuk relaksasi saja" BUKAN pola tanya-keluhan → tidak dituduh D10', () => {
      const ok = validateFactualClaims('Untuk pijat sehat relaksasi saja ya Bunda', [], [], { symptomsKnown: true });
      expect(ok.isValid).toBe(true);
    });

    it('rekomendasi + empati tanpa tanya ulang → valid', () => {
      const ok = validateFactualClaims('Untuk GTM-nya kami sarankan Pijat Lahap ya Bunda. Semoga si kecil lekas sehat kembali ya 🤗', [], [], { symptomsKnown: true });
      expect(ok.isValid).toBe(true);
    });
  });

  // D3 boundary: anjuran pemilihan paket katalog (dengan nama resmi) BUKAN SOP medis.
  describe('D3: treatment-selection advisory lolos; SOP rumahan tetap ditolak', () => {
    const catalog = (names: string[]) => [{
      name: 'get_catalog_and_price',
      args: {},
      result: { success: true, treatments: names.map((n) => ({ name: n, durationMinutes: 40 })) },
    }];
    it('sebaiknya diambil dua-duanya + nama katalog → valid (Turn 7 sesi afc5d511)', () => {
      const tools = catalog(['Kala Baby – Pijat Pulih Ceria', 'Kala Baby – Pijat Lahap']);
      const ok = validateFactualClaims(
        'Kalau dari keluhan yang Bunda sampaikan, grok-grok dan susah makan, sebaiknya diambil dua-duanya ya Bunda: *Kala Baby – Pijat Pulih Ceria* dan *Kala Baby – Pijat Lahap*. Keduanya menangani hal yang berbeda dan saling melengkapi.',
        tools, [], {}
      );
      expect(ok.isValid).toBe(true);
    });
    it('disarankan pilih + nama katalog → valid', () => {
      const tools = catalog(['Kala Baby – Pijat Lahap']);
      const ok = validateFactualClaims('Untuk nafsu makannya, disarankan pilih *Kala Baby – Pijat Lahap* ya Bunda karena fokus stimulasi pencernaan.', tools, [], {});
      expect(ok.isValid).toBe(true);
    });
    it('Sebaiknya dimandikan air hangat tiap hari (tanpa nama katalog) → tetap invalid', () => {
      const bad = validateFactualClaims('Sebaiknya bayi dimandikan dengan air hangat setiap hari agar tidak rewel dan tidurnya nyenyak ya Bunda', [], [], {});
      expect(bad.isValid).toBe(false);
    });
    it('Sebaiknya dijemur 30 menit (tanpa nama katalog) → tetap invalid', () => {
      const bad = validateFactualClaims('Sebaiknya si kecil dijemur setiap pagi selama 30 menit agar tulangnya kuat ya Bunda', [], [], {});
      expect(bad.isValid).toBe(false);
    });
  });
});
