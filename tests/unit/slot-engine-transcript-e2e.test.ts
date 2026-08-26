import { describe, it, expect, vi } from 'vitest';
import { processSlotEngine } from '../../src/slot-engine/slot-engine';
import { ConversationState } from '@prisma/client';

describe('Slot Engine Turn-by-Turn User Transcript E2E Simulation', () => {
  it('Simulasi Lengkap Multi-Turn Turn-by-Turn: Greeting Lead -> Alana Tambakoso Waru -> Bayi 1 Bulan -> Treatment -> Jadwal -> Submit Form', async () => {
    let customer: any = {
      id: 'cust_transcript_123',
      phone: '6282167281657',
      name: 'Bunda',
      tenant_id: 'default-tenant',
      kelurahan: null,
      kecamatan: null,
      kota: null,
      lat: null,
      lng: null,
      share_location_sent: false,
      pricelist_sent: false,
      status: 'active',
      preferences: {},
    };

    let conversation: any = {
      id: 'conv_transcript_123',
      customer_id: customer.id,
      tenant_id: 'default-tenant',
      current_state: ConversationState.INITIAL,
      is_human_handling: false,
      last_discussed_treatment: null,
      last_message_at: new Date(),
    };

    let history: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    // --- TURN 1: Customer mengirimkan greeting iklan pertama kali ---
    const turn1Ctx = {
      customer,
      conversation,
      incomingMessage: {
        id: 'msg_t1',
        chatId: `${customer.phone}@c.us`,
        from: customer.phone,
        text: { body: 'Halo Bu Bidan, saya tertarik dengan layanan home-treatment' },
        type: 'text',
      },
      tenantId: 'default-tenant',
      history,
    };

    const turn1Result = await processSlotEngine(turn1Ctx as any);

    // Turn 1 HARUS:
    // Mengirim template greeting resmi Kala Spa (Bidan Yusi)
    // BUKAN template kualifikasi terapis / STR
    expect(turn1Result.replyText).toContain('Terima kasih sudah menghubungi kami');
    expect(turn1Result.replyText).toContain('Bidan Yusi');
    expect(turn1Result.replyText).not.toContain('Seluruh terapis Kala Moms');
    expect(turn1Result.shouldSendReply).toBe(true);

    history.push(
      { role: 'user', content: 'Halo Bu Bidan, saya tertarik dengan layanan home-treatment' },
      { role: 'assistant', content: turn1Result.replyText }
    );

    // --- TURN 2: Customer memberikan lokasi dan menanyakan pijat bayi 1 bulan ---
    const turn2Ctx = {
      customer,
      conversation,
      incomingMessage: {
        id: 'msg_t2',
        chatId: `${customer.phone}@c.us`,
        from: customer.phone,
        text: { body: 'Saya lokasinya di alana tambak oso waru bisa pijat bayi 1 bulan gak ya' },
        type: 'text',
      },
      tenantId: 'default-tenant',
      history,
    };

    const turn2Result = await processSlotEngine(turn2Ctx as any);

    // Turn 2 HARUS:
    // 1. Menghitung ongkir dan jarak (Tambakoso, Waru -> ~9.2 km, ongkir normal/promo)
    // 2. Menjawab tentang pijat bayi 1 bulan
    // 3. TIDAK salah deteksi sebagai form reservasi ("Mohon maaf Bunda, mohon diisi bagian...")
    expect(turn2Result.replyText).not.toContain('pada list reservasi');
    expect(turn2Result.shouldSendReply).toBe(true);
    expect(turn2Result.replyText.toLowerCase()).toMatch(/jarak|km|ongkir|promo|tambakoso|waru|alana/);

    // Slate tersimpan ke state customer
    customer.kelurahan = 'Tambakoso';
    customer.kecamatan = 'Waru';
    customer.kota = 'Kabupaten Sidoarjo';
    customer.lat = -7.362;
    customer.lng = 112.784;
    customer.preferences = {
      distanceKm: 9.2,
      ongkirFee: 15000,
      ongkirPromoFee: 10000,
    };

    history.push(
      { role: 'user', content: 'Saya lokasinya di alana tambak oso waru bisa pijat bayi 1 bulan gak ya' },
      { role: 'assistant', content: turn2Result.replyText }
    );

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
    // Dynamic closer tidak boleh bertanya kelurahan lagi karena lokasi sudah diketahui
    expect(turn3Result.replyText).not.toContain('rumah Bunda di daerah atau kelurahan mana');

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
    expect(turn4Result.replyText.toLowerCase()).toMatch(/bisa|tersedia|laktasi|oksitosin/);
    // Dynamic closer bertanya preferensi jadwal (SCHEDULE), bukan menanyakan lokasi lagi
    expect(turn4Result.replyText).not.toContain('rumah Bunda di daerah atau kelurahan mana');

    history.push(
      { role: 'user', content: 'Pijat bayi ceria aja sm kalo untuk saya yg paket bundling pijat laktasi+oksitosin bisa kan ya' },
      { role: 'assistant', content: turn4Result.replyText }
    );

    // --- TURN 5: Customer menanyakan ketersediaan hari Jumat ---
    const turn5Ctx = {
      customer,
      conversation,
      incomingMessage: {
        id: 'msg_t5',
        chatId: `${customer.phone}@c.us`,
        from: customer.phone,
        text: { body: 'Jumat apakah bisa' },
        type: 'text',
      },
      tenantId: 'default-tenant',
      history,
    };

    const turn5Result = await processSlotEngine(turn5Ctx as any);
    expect(turn5Result.shouldSendReply).toBe(true);
    // Dynamic closer tidak boleh bertanya kelurahan lagi
    expect(turn5Result.replyText).not.toContain('rumah Bunda di daerah atau kelurahan mana');

    // --- TURN 6: Customer mengirimkan formulir reservasi yang sudah diisi ---
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

    const turn6Ctx = {
      customer,
      conversation,
      incomingMessage: {
        id: 'msg_t6',
        chatId: `${customer.phone}@c.us`,
        from: customer.phone,
        text: { body: filledFormText },
        type: 'text',
      },
      tenantId: 'default-tenant',
      history,
    };

    const turn6Result = await processSlotEngine(turn6Ctx as any);

    // Bot HARUS:
    // 1. Pindah ke HUMAN_HANDLING
    // 2. Set isHumanHandling: true
    // 3. Mengirimkan konfirmasi penerimaan data reservasi
    expect(turn6Result.nextState).toBe(ConversationState.HUMAN_HANDLING);
    expect(turn6Result.isHumanHandling).toBe(true);
    expect(turn6Result.shouldSendReply).toBe(true);
    expect(turn6Result.replyText).toContain('data reservasi sudah kami terima');
    expect(turn6Result.replyText).not.toContain('Berikut list untuk reservasi :');
  });
});
