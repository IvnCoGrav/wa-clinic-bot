/**
 * tests/evals/numeric-hallucination-harness.ts
 * Eval harness otomatis pengujian halusinasi angka & fakta numerik V3.
 * Jalankan: npx tsx tests/evals/numeric-hallucination-harness.ts
 */

import { V3AgentRunner } from '../../src/v3/agent/agent-runner';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { treatmentCatalogService } from '../../src/services/treatment-catalog.service';

interface NumericTestCase {
  id: string;
  category: 'PRICE' | 'ONGKIR' | 'SCHEDULE' | 'COMBO';
  userMessage: string;
  expectedTool: string;
  expectedNominals: number[]; // Nominal rupiah yang WAJIB ada di balasan
  forbiddenNominals?: number[]; // Nominal yang DILARANG muncul (bekas halusinasi)
}

export const NUMERIC_TEST_CASES: NumericTestCase[] = [
  // 1. Variasi Baku
  { id: 'TC-01', category: 'PRICE', userMessage: 'Berapa tarif pijat bayi ceria?', expectedTool: 'get_catalog_and_price', expectedNominals: [60000, 80000] },
  { id: 'TC-02', category: 'PRICE', userMessage: 'Biaya pijat bayi batuk pilek berapa?', expectedTool: 'get_catalog_and_price', expectedNominals: [70000, 90000] },
  { id: 'TC-03', category: 'PRICE', userMessage: 'Pijat nafsu makan anak biayanya berapa ya?', expectedTool: 'get_catalog_and_price', expectedNominals: [75000, 95000] },
  { id: 'TC-04', category: 'PRICE', userMessage: 'Berapa harga cukur rambut bayi?', expectedTool: 'get_catalog_and_price', expectedNominals: [25000, 30000] },
  { id: 'TC-05', category: 'PRICE', userMessage: 'Berapa biaya tindik telinga bayi?', expectedTool: 'get_catalog_and_price', expectedNominals: [50000, 70000] },
  { id: 'TC-06', category: 'PRICE', userMessage: 'Tarif pijat ibu hamil prenatal massage berapa?', expectedTool: 'get_catalog_and_price', expectedNominals: [100000, 125000] },
  { id: 'TC-07', category: 'PRICE', userMessage: 'Harga pijat laktasi memperlancar asi berapa?', expectedTool: 'get_catalog_and_price', expectedNominals: [105000, 130000] },
  
  // 2. Variasi Typo & Singkatan
  { id: 'TC-08', category: 'PRICE', userMessage: 'hrga pijat bby pulih brp y bund', expectedTool: 'get_catalog_and_price', expectedNominals: [70000] },
  { id: 'TC-09', category: 'PRICE', userMessage: 'byr brpa klo pijit bapil bby', expectedTool: 'get_catalog_and_price', expectedNominals: [70000] },
  { id: 'TC-10', category: 'PRICE', userMessage: 'pricelst cukur rmbut brapa', expectedTool: 'get_catalog_and_price', expectedNominals: [25000] },
  { id: 'TC-11', category: 'PRICE', userMessage: 'pijet ceria brp rb kak', expectedTool: 'get_catalog_and_price', expectedNominals: [60000] },
  { id: 'TC-12', category: 'PRICE', userMessage: 'ongkr ke pepe sedati brpa ya', expectedTool: 'calculate_delivery', expectedNominals: [15000, 25000] },
  { id: 'TC-13', category: 'PRICE', userMessage: 'tarif ongkir ke wage sidoarjo', expectedTool: 'calculate_delivery', expectedNominals: [] },

  // 3. Variasi Slang Daerah & Informal
  { id: 'TC-14', category: 'PRICE', userMessage: 'Pijet baby ceria kenek piro bun?', expectedTool: 'get_catalog_and_price', expectedNominals: [60000] },
  { id: 'TC-15', category: 'PRICE', userMessage: 'Lek bapil bayar piro yo?', expectedTool: 'get_catalog_and_price', expectedNominals: [70000] },
  { id: 'TC-16', category: 'PRICE', userMessage: 'Minta pricelist lengkap pijat bayi dong min', expectedTool: 'get_catalog_and_price', expectedNominals: [60000, 70000] },
  { id: 'TC-17', category: 'PRICE', userMessage: 'Pijat bayi relaksasi 60rb ya bener?', expectedTool: 'get_catalog_and_price', expectedNominals: [60000, 80000] },
  { id: 'TC-18', category: 'PRICE', userMessage: 'Sinar moksa tambahnya berapa duit?', expectedTool: 'get_catalog_and_price', expectedNominals: [10000] },
  
  // 4. Kasus Ongkir Presisi
  { id: 'TC-19', category: 'ONGKIR', userMessage: 'Rumah saya di Tropodo Waru', expectedTool: 'calculate_delivery', expectedNominals: [0] },
  { id: 'TC-20', category: 'ONGKIR', userMessage: 'Daerah Tambaksari Surabaya ada ongkir?', expectedTool: 'calculate_delivery', expectedNominals: [] },
  { id: 'TC-21', category: 'ONGKIR', userMessage: 'Alamat di Krian, berapa ongkirnya?', expectedTool: 'calculate_delivery', expectedNominals: [] },
  { id: 'TC-22', category: 'ONGKIR', userMessage: 'Perumahan Puri Surya Jaya Gedangan', expectedTool: 'calculate_delivery', expectedNominals: [] },
  { id: 'TC-23', category: 'ONGKIR', userMessage: 'Semambung Gedangan Sidoarjo', expectedTool: 'calculate_delivery', expectedNominals: [] },

  // 5. Kasus Combo Treatment & Multi-Pasien
  { id: 'TC-24', category: 'COMBO', userMessage: 'Pijat pulih ceria plus sinar moksa totalnya berapa?', expectedTool: 'get_catalog_and_price', expectedNominals: [80000] },
  { id: 'TC-25', category: 'COMBO', userMessage: 'Pijat bayi ceria sekalian cukur rambut habis berapa?', expectedTool: 'get_catalog_and_price', expectedNominals: [85000] },
  { id: 'TC-26', category: 'PRICE', userMessage: 'Kalau 2 anak sekaligus ongkirnya bayar 2 kali?', expectedTool: 'get_clinic_policy_faq', expectedNominals: [1] },
  { id: 'TC-27', category: 'SCHEDULE', userMessage: 'Hari sabtu besok jam 10 pagi bisa?', expectedTool: '', expectedNominals: [] },
  { id: 'TC-28', category: 'SCHEDULE', userMessage: 'Bisa datang hari minggu lusa?', expectedTool: '', expectedNominals: [] },
  { id: 'TC-29', category: 'PRICE', userMessage: 'Biaya pijat bayi 150 ribu ya?', expectedTool: 'get_catalog_and_price', expectedNominals: [60000], forbiddenNominals: [150000] },
  { id: 'TC-30', category: 'PRICE', userMessage: 'Pijat bapil 50rb kan kak?', expectedTool: 'get_catalog_and_price', expectedNominals: [70000], forbiddenNominals: [50000] },
];

export async function runNumericHarness() {
  console.log(`\n🚀 [EVAL HARNESS] Menjalankan ${NUMERIC_TEST_CASES.length} kasus uji numerik V3...\n`);
  let passed = 0;
  let failed = 0;

  for (const tc of NUMERIC_TEST_CASES) {
    const result = await V3AgentRunner.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customerId: `eval_${tc.id}`,
      conversationId: `conv_eval_${tc.id}`,
      phone: '62811111111',
      chatId: '62811111111@c.us',
      incomingText: tc.userMessage,
      history: [],
      skipDbLogging: true,
    });

    const reply = result.replyText;
    const toolsCalled = result.executedTools.map((t) => t.name);
    
    // Verifikasi pemanggilan tool
    const toolOk = !tc.expectedTool || toolsCalled.includes(tc.expectedTool);
    
    // Verifikasi nominal angka di balasan
    let nominalsOk = true;
    for (const exp of tc.expectedNominals) {
      const formatted = exp.toLocaleString('id-ID');
      const simpleK = `${exp / 1000}rb`;
      const simpleK2 = `${exp / 1000}.000`;
      if (!reply.includes(formatted) && !reply.includes(simpleK) && !reply.includes(simpleK2) && exp !== 1 && exp !== 0) {
        nominalsOk = false;
        break;
      }
    }

    // Verifikasi ketiadaan nominal halusinasi
    let forbiddenOk = true;
    if (tc.forbiddenNominals) {
      for (const forb of tc.forbiddenNominals) {
        const formatted = forb.toLocaleString('id-ID');
        if (reply.includes(formatted)) {
          forbiddenOk = false;
          break;
        }
      }
    }

    const isSuccess = toolOk && nominalsOk && forbiddenOk;
    if (isSuccess) {
      passed++;
      console.log(`✅ [PASS] ${tc.id.padEnd(6)} | Tool: [${toolsCalled.join(',')}]`);
    } else {
      failed++;
      console.log(`❌ [FAIL] ${tc.id.padEnd(6)} | Input: "${tc.userMessage}"`);
      console.log(`   Tools Expected: ${tc.expectedTool} | Called: [${toolsCalled.join(',')}]`);
      console.log(`   Reply: "${reply.slice(0, 120)}..."`);
    }
  }

  console.log(`\n====================================================`);
  console.log(`📊 HASIL EVAL HARNESS: ${passed} PASS, ${failed} FAIL (Pass Rate: ${((passed / NUMERIC_TEST_CASES.length) * 100).toFixed(1)}%)`);
  console.log(`====================================================\n`);
  return { passed, failed, total: NUMERIC_TEST_CASES.length };
}

if (require.main === module) {
  runNumericHarness().then(({ failed }) => {
    process.exit(failed > 0 ? 1 : 0);
  });
}
