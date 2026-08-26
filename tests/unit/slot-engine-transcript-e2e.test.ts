import { describe, it, expect, vi } from 'vitest';
import { processSlotEngine } from '../../src/slot-engine/slot-engine';
import { ConversationState } from '@prisma/client';

describe('Slot Engine Turn-by-Turn User Transcript E2E Simulation', () => {
  it('Simulasi Multi-Turn: Dari penentuan lokasi, tanya rekomendasi bayi 1 bulan, pemilihan paket, hingga submit form reservasi', async () => {
    let customer: any = {
      id: 'cust_transcript_123',
      phone: '6282167281657',
      name: 'Bunda Yosefin',
      tenant_id: 'default-tenant',
      kelurahan: 'Tambakoso',
      kecamatan: 'Waru',
      kota: 'Kabupaten Sidoarjo',
      lat: -7.362,
      lng: 112.784,
      share_location_sent: false,
      pricelist_sent: true,
      status: 'active',
      preferences: {
        distanceKm: 9.2,
        ongkirFee: 15000,
        ongkirPromoFee: 10000,
      },
    };

    let conversation: any = {
      id: 'conv_transcript_123',
      customer_id: customer.id,
      tenant_id: 'default-tenant',
      current_state: ConversationState.AWAITING_INTEREST,
      is_human_handling: false,
      last_discussed_treatment: null,
      last_message_at: new Date(),
    };

    let history: Array<{ role: 'user' | 'assistant'; content: string }> = [
      {
        role: 'user',
        content: 'Saya lokasinya di alana tambak oso waru bisa pijat bayi 1 bulan gak ya',
      },
      {
        role: 'assistant',
        content: 'Kalau kami cek bund, jaraknya kurang lebih 9.2 km ya. Dari pricelist untuk jarak ini ongkirnya Rp 15.000, tapi karena ada promo jadi cukup Rp 10.000 saja Bunda 😊 Mau pilih treatment apa Bunda? 😊',
      },
    ];

    // --- TURN 3: Customer menanyakan rekomendasi untuk bayi 1 bulan ---
    const turn3Ctx = {
      customer,
      conversation,
      incomingMessage: {
        id: 'msg_t3',
        chatId: `${customer.phone}@c.us`,
        from: customer.phone,
        text: { body: 'Hm biasa untuk bayi 1 bulan apa ya' },
        type: 'text',
      },
      tenantId: 'default-tenant',
      history,
    };

    const turn3Result = await processSlotEngine(turn3Ctx as any);
    // Pastikan Turn 3 TIDAK mengulang template ongkir (bukan "Kalau kami cek bund, jaraknya kurang lebih 9.2 km")
    expect(turn3Result.replyText).not.toContain('jaraknya kurang lebih 9.2 km');
    expect(turn3Result.shouldSendReply).toBe(true);

    history.push(
      { role: 'user', content: 'Hm biasa untuk bayi 1 bulan apa ya' },
      { role: 'assistant', content: turn3Result.replyText }
    );

    // --- TURN 4: Customer memilih treatment ---
    const turn4Ctx = {
      customer,
      conversation,
      incomingMessage: {
        id: 'msg_t4',
        chatId: `${customer.phone}@c.us`,
        from: customer.phone,
        text: { body: 'Pijat bayi ceria aja sm kalo untuk saya yg paket bundling pijat laktasi+oksitosin bisa kan ya' },
        type: 'text',
      },
      tenantId: 'default-tenant',
      history,
    };

    const turn4Result = await processSlotEngine(turn4Ctx as any);
    expect(turn4Result.shouldSendReply).toBe(true);
    expect(turn4Result.replyText.toLowerCase()).toMatch(/bisa|tersedia|laktasi/);

    history.push(
      { role: 'user', content: 'Pijat bayi ceria aja sm kalo untuk saya yg paket bundling pijat laktasi+oksitosin bisa kan ya' },
      { role: 'assistant', content: turn4Result.replyText }
    );

    // --- TURN 7: Customer mengirimkan formulir reservasi yang sudah diisi ---
    const filledFormText = `Berikut list untuk reservasi :

Hari dan tanggal : jumat 28 Juli
Nama Bunda: Yosefin
Alamat & Shareloc : alana, Tambakoso
Kec : Waru
Kota : Kabupaten Sidoarjo
No. Hp : 6282167281657

Pilihan treatment (bayi & Kids)

Nama Bayi : Annabeth
Usia Bayi/Anak : 1 bulan
Treatment : pijat bayi ceria 

Pilihan treatment (Moms) :bundling pijat laktasi dan oksitosin

Usia Kehamilan (Jika hamil):
Treatment : -`;

    const turn7Ctx = {
      customer,
      conversation,
      incomingMessage: {
        id: 'msg_t7',
        chatId: `${customer.phone}@c.us`,
        from: customer.phone,
        text: { body: filledFormText },
        type: 'text',
      },
      tenantId: 'default-tenant',
      history,
    };

    const turn7Result = await processSlotEngine(turn7Ctx as any);

    // Bot HARUS:
    // 1. Pindah ke HUMAN_HANDLING
    // 2. Set isHumanHandling: true
    // 3. Mengirimkan konfirmasi penerimaan data reservasi (BUKAN form kosong lagi!)
    expect(turn7Result.nextState).toBe(ConversationState.HUMAN_HANDLING);
    expect(turn7Result.isHumanHandling).toBe(true);
    expect(turn7Result.shouldSendReply).toBe(true);
    expect(turn7Result.replyText).toContain('data reservasi sudah kami terima');
    expect(turn7Result.replyText).not.toContain('Berikut list untuk reservasi :');
  });
});
