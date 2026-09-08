import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { V3AgentRunner } from '../../src/v3/agent/agent-runner';
import { GoalTracker } from '../../src/v3/state/goal-tracker';

vi.mock('axios');

describe('V3 Agent Runner End-to-End Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Skenario 1: Customer bertanya lokasi & ongkir (Tool calculate_delivery terpanggil otomatis)', async () => {
    // Mock panggilan 1: Model memutuskan memanggil tool calculate_delivery
    (axios.post as any)
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call_123',
                    type: 'function',
                    function: {
                      name: 'calculate_delivery',
                      arguments: JSON.stringify({ locationText: 'Trosobo Sidoarjo' }),
                    },
                  },
                ],
              },
            },
          ],
        },
      })
      // Mock panggilan 2: Model menyusun balasan ramah Bidan Yusi menggunakan data hasil tool
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                role: 'assistant',
                content:
                  'Halo Bunda ! ✨\n\nUntuk daerah Trosobo Sidoarjo jaraknya kurang lebih 17.8 km dari klinik kami ya Bund. Dari pricelist kami ongkir normalnya Rp 25.000, tapi bulan ini ada promo spesial menjadi Rp 20.000 saja 😊\n\nRencana mau ambil treatment apa untuk si kecil, Bund?',
              },
            },
          ],
        },
      });

    const result = await V3AgentRunner.processMessage({
      customerId: 'mock-cust-1',
      conversationId: 'mock-conv-1',
      phone: '6285816071628',
      chatId: '6285816071628@c.us',
      incomingText: 'Saya di daerah trosobo sidoarjo berapa ongkirnya ya?',
    });

    expect(result.executedTools.length).toBe(1);
    expect(result.executedTools[0].name).toBe('calculate_delivery');
    expect(result.executedTools[0].result.success).toBe(true);
    // Guardrail numerik mungkin mengganti balasan LLM dengan template tool (mengandung km & ongkir promo)
    expect(result.replyText).toMatch(/km/i);
    expect(result.replyText).toMatch(/Rp\s*[\d.]+/);
    expect(result.shouldSendReply).toBe(true);
  });

  it('Skenario 2: Ayah / Suami berkonsultasi (Sapaan Bapak & Rekomendasi Pulih Ceria)', async () => {
    // Mock panggilan 1: Model memanggil get_catalog_and_price untuk bapil/rewel
    (axios.post as any)
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call_456',
                    type: 'function',
                    function: {
                      name: 'get_catalog_and_price',
                      arguments: JSON.stringify({
                        category: 'BABY',
                        symptoms: ['batuk', 'pilek', 'rewel', 'nangis terus'],
                      }),
                    },
                  },
                ],
              },
            },
          ],
        },
      })
      // Mock panggilan 2: Model menyapa Bapak Naufal dan merekomendasikan Pulih Ceria
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                role: 'assistant',
                content:
                  'Halo Bapak Naufal 😊\n\nTurut prihatin ya Pak melihat si kecil sedang rewel dan batuk pilek. Untuk keluhan tersebut, kami sangat merekomendasikan paket *Pijat Bayi Pulih Ceria* (Promo Rp 70.000). Paket ini sudah dilengkapi double aromaterapi untuk melegakan pernapasan dan membuat si kecil lebih tenang.\n\nKalau boleh tahu, rumah Bapak di daerah mana ya?',
              },
            },
          ],
        },
      });

    // Set goal session customer sebagai Bapak Naufal
    await GoalTracker.updateGoalSession('mock-conv-2', {
      customerName: 'Muhammad Naufal Ghifari',
      genderGreeting: 'Bapak',
    });

    const result = await V3AgentRunner.processMessage({
      customerId: 'mock-cust-2',
      conversationId: 'mock-conv-2',
      phone: '6285959212132',
      chatId: '6285959212132@c.us',
      incomingText: 'Saya Naufal mau tanya untuk istri saya, bayi rewel nangis terus dari siang karna batuk pilek...',
    });

    expect(result.executedTools.length).toBe(1);
    expect(result.executedTools[0].name).toBe('get_catalog_and_price');
    expect(result.replyText).toContain('Bapak Naufal');
    expect(result.replyText).not.toContain('Halo Bunda');
    expect(result.replyText).toContain('Pulih Ceria');
    expect(result.replyText).not.toContain('Kita perlu menyusun');
  });

  it('Skenario 4: Observability — RAG chunks, exemplars dinamis, prompt & token tercatat', async () => {
    const { knowledgeBaseService } = await import('../../src/services/knowledge.service');
    await knowledgeBaseService.addFaqItem({
      tenantId: 'default-tenant',
      category: 'MEDIS',
      question: 'Apakah boleh pijat saat tumbuh gigi?',
      answer: 'Boleh Bunda, pijat lembut membantu meredakan rewel saat tumbuh gigi.',
    });

    (axios.post as any)
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call_faq_1',
                    type: 'function',
                    function: {
                      name: 'search_knowledge_faq',
                      arguments: JSON.stringify({ query: 'pijat saat tumbuh gigi' }),
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 20 },
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [{ message: { role: 'assistant', content: 'Boleh Bunda 😊 Pijat lembut aman saat tumbuh gigi.' } }],
          usage: { prompt_tokens: 200, completion_tokens: 30 },
        },
      });

    const result = await V3AgentRunner.processMessage({
      customerId: 'mock-cust-4',
      conversationId: 'mock-conv-4',
      phone: '6281234567890',
      chatId: '6281234567890@c.us',
      incomingText: 'Apakah boleh pijat saat tumbuh gigi?',
      history: [
        { role: 'user', content: 'halo' },
        { role: 'assistant', content: 'Halo Bunda! Selamat datang.' },
      ],
    });

    expect(result.executedTools.some((t) => t.name === 'search_knowledge_faq')).toBe(true);
    expect(result.retrievedChunks.length).toBeGreaterThan(0);
    expect(result.retrievedChunks[0].title).toContain('tumbuh gigi');
    expect(Array.isArray(result.fewShotExemplars)).toBe(true);
    expect(result.systemPrompt).toContain('Bidan Yusi');
    expect(result.tokens.total).toBe(350);
    expect(result.tokens.prompt).toBe(300);
    expect(result.tokens.completion).toBe(50);
    expect(result.shouldSendReply).toBe(true);
  });

  it('Skenario 3: Kondisi Darurat Medis (Tool escalate_to_human terpanggil & bot berhenti membalas)', async () => {
    (axios.post as any).mockResolvedValueOnce({
      data: {
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_789',
                  type: 'function',
                  function: {
                    name: 'escalate_to_human',
                    arguments: JSON.stringify({
                      reason: 'Gejala darurat medis: bayi kejang dan tidak sadar',
                      severity: 'CRITICAL_MEDICAL',
                    }),
                  },
                },
              ],
            },
          },
        ],
      },
    });

    const result = await V3AgentRunner.processMessage({
      customerId: 'mock-cust-3',
      conversationId: 'mock-conv-3',
      phone: '6281234567890',
      chatId: '6281234567890@c.us',
      incomingText: 'Tolong anak saya kejang dan tidak sadar!',
    });

    expect(result.isEscalated).toBe(true);
    expect(result.shouldSendReply).toBe(false);
    expect(result.executedTools.length).toBe(1);
    expect(result.executedTools[0].name).toBe('escalate_to_human');
  });

  it('Skenario 5: Multi-turn panjang + tanya SOP mandi — wajib tetap panggil search_knowledge_faq (anti-inertia)', async () => {
    const { knowledgeBaseService: kbs5 } = await import('../../src/services/knowledge.service');
    await kbs5.addFaqItem({
      tenantId: 'default-tenant',
      category: 'SOP',
      question: 'Sebaiknya pijat dilakukan sebelum atau sesudah mandi?',
      answer: 'Sebaiknya pijat dilakukan sebelum mandi ya Bunda. Setelah perawatan selesai, Bunda bisa memandikan si kecil dengan jeda istirahat sekitar 5-10 menit.',
    });
    (axios.post as any)
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call_mandi_1',
                    type: 'function',
                    function: {
                      name: 'search_knowledge_faq',
                      arguments: JSON.stringify({ query: 'pijat sebelum atau sesudah mandi' }),
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 120, completion_tokens: 15 },
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [{ message: { role: 'assistant', content: 'Sebaiknya pijat dilakukan sebelum mandi ya Bunda 😊 Setelah perawatan selesai, Bunda bisa memandikan si kecil dengan jeda istirahat sekitar 5-10 menit.' } }],
          usage: { prompt_tokens: 180, completion_tokens: 25 },
        },
      });

    const longHistory = [
      { role: 'user' as const, content: 'halo kak' },
      { role: 'assistant' as const, content: 'Halo Bunda! Perkenalkan saya Bidan Yusi dari Kala Moms and Baby Spa.' },
      { role: 'user' as const, content: 'mau tanya vaksin, habis vaksin kapan boleh pijat?' },
      { role: 'assistant' as const, content: 'Minimal 3 hari setelah vaksin ya Bunda dan pastikan tidak demam.' },
      { role: 'user' as const, content: 'harganya berapa kak?' },
      { role: 'assistant' as const, content: 'Untuk Pijat Bayi Ceria promo Rp 60.000 durasi 40 menit ya Bunda.' },
      { role: 'user' as const, content: 'okee kak noted' },
    ];

    const result = await V3AgentRunner.processMessage({
      customerId: 'mock-cust-5',
      conversationId: 'mock-conv-5',
      phone: '6289990000005',
      chatId: '6289990000005@c.us',
      incomingText: 'kak sebaiknya pijat dilakukan sebelum atau sesudah mandi ya?',
      history: longHistory,
    });

    expect(result.executedTools.some((t) => t.name === 'search_knowledge_faq')).toBe(true);
    expect(result.retrievedChunks.length).toBeGreaterThan(0);
    expect(result.retrievedChunks[0].similarity).toBeGreaterThan(0);
    expect(result.replyText.toLowerCase()).toContain('sebelum mandi');
    expect(result.shouldSendReply).toBe(true);
  });

  it('Skenario 6: Lokasi perbatasan "Pelemwatu menganti gresik" — tool calculate_delivery wajib terpanggil, DILARANG tanya km', async () => {
    // Mock panggilan 1: Model memanggil tool calculate_delivery untuk lokasi perbatasan
    (axios.post as any)
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call_pelem_1',
                    type: 'function',
                    function: {
                      name: 'calculate_delivery',
                      arguments: JSON.stringify({ locationText: 'Pelemwatu Menganti Gresik' }),
                    },
                  },
                ],
              },
            },
          ],
        },
      })
      // Mock panggilan 2: Model menyusun balasan memakai data hasil tool (tanpa tanya km)
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                role: 'assistant',
                content:
                  'Baik Bunda 😊 Jika dilihat dari Waru jaraknya kurang lebih 28.3 km dengan ongkir promo Rp 30.000 yaa. Rencana mau ambil perawatan apa untuk si kecil atau Bunda? 🤗',
              },
            },
          ],
        },
      });

    const result = await V3AgentRunner.processMessage({
      customerId: 'mock-cust-6',
      conversationId: 'mock-conv-6',
      phone: '6289990000006',
      chatId: '6289990000006@c.us',
      incomingText: 'Pelemwatu menganti gresik bu',
    });

    const deliveryCall = result.executedTools.find((t) => t.name === 'calculate_delivery');
    expect(deliveryCall).toBeTruthy();
    expect(JSON.stringify(deliveryCall?.args || {})).toMatch(/pelemwatu/i);
    expect(deliveryCall?.result?.success).toBe(true);
    // Toleran Haversine vs ORS: terima in-coverage (28.x km) atau out-of-coverage (>30 km)
    const isOutOfCoverage = /luar jangkauan/i.test(result.replyText);
    if (isOutOfCoverage) {
      expect(result.replyText).toMatch(/30\s*km/);
    } else {
      expect(result.replyText).toMatch(/\d+[.,]\d+\s*km/);
      expect(result.replyText).toMatch(/Rp\s*[\d.]+/);
    }
    // ANTI-MENANYAKAN KM: balasan tidak boleh memuat pertanyaan jarak ke customer
    expect(result.replyText).not.toMatch(/berapa\s+km/i);
    expect(result.shouldSendReply).toBe(true);
  });

  it('Skenario 7: "Pijat bayi sinar moksa ini gmn ya" — penjelasan santai, tanpa harga/durasi/daftar bernomor/gantung', async () => {
    // Mock panggilan 1: Model memanggil get_catalog_and_price dengan inquirePrice FALSE
    // (pertanyaan cara kerja "gmn ya" BUKAN pertanyaan harga)
    (axios.post as any)
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call_moksa_1',
                    type: 'function',
                    function: {
                      name: 'get_catalog_and_price',
                      arguments: JSON.stringify({ specificTreatmentName: 'Sinar Moksa', inquirePrice: false }),
                    },
                  },
                ],
              },
            },
          ],
        },
      })
      // Mock panggilan 2: penjelasan hangat Sinar Moksa tanpa harga/durasi/daftar bernomor
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                role: 'assistant',
                content:
                  'Untuk Sinar Moksa itu terapi sinar hangat inframerah ya Bunda 😊 Fungsinya membantu menghangatkan area dada dan punggung si kecil agar dahak atau lendir flu lebih cepat encer dan pernapasannya lebih lega.\n\nBiasanya dikombinasikan dengan Pijat Pulih Ceria. Apakah saat ini si kecil sedang batuk atau pilek Bunda? 🤗',
              },
            },
          ],
        },
      });

    const result = await V3AgentRunner.processMessage({
      customerId: 'mock-cust-7',
      conversationId: 'mock-conv-7',
      phone: '6289990000007',
      chatId: '6289990000007@c.us',
      incomingText: 'Pijat bayi sinar moksa ini gmn ya',
    });

    expect(result.executedTools.some((t) => t.name === 'get_catalog_and_price')).toBe(true);
    // TIDAK ada nominal Rp karena tidak ditanya harga
    expect(result.replyText).not.toMatch(/Rp\s*[\d.]+/);
    // TIDAK ada format daftar bernomor brosur
    expect(result.replyText).not.toMatch(/(^|\n)\s*\d+\.\s/m);
    // TIDAK ada istilah asing full body massage
    expect(result.replyText.toLowerCase()).not.toContain('full body massage');
    // TIDAK ada teks menggantung (akhir kalimat tuntas)
    expect(result.replyText.trim()).toMatch(/[😊🤗?.!…]\s*$/u);
    // Memuat penjelasan fungsi terapi sinar hangat
    expect(result.replyText.toLowerCase()).toMatch(/sinar hangat|inframerah/);
    expect(result.shouldSendReply).toBe(true);
  });
});
