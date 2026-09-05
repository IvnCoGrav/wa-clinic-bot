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
    expect(result.replyText).toContain('Trosobo Sidoarjo');
    expect(result.replyText).toContain('Rp 20.000');
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
});
