import { prisma } from '../src/db/client';

async function main() {
  const tenantId = 'default-tenant';

  console.log('Seeding 3 dummy customers into database...');

  const dummyData = [
    {
      phone: '6281234567891',
      name: 'Bunda Anisa Sidoarjo',
      is_mql: true,
      mql_bubble_count: 6,
      mql_triggered_at: new Date('2026-08-02T10:00:00Z'),
      trackingCode: 'TC-BABYSPA-01',
      utmSource: 'facebook',
      utmCampaign: 'promo-agustus-baby',
      reservations: [
        { treatment_category: 'BABY', treatment_detail: 'Baby Massage Ceria (60 min)', status: 'confirmed', raw_text: 'Baby Massage Ceria' },
        { treatment_category: 'MOMS', treatment_detail: 'Spa Mom Relaxing (90 min)', status: 'completed', raw_text: 'Spa Mom Relaxing' },
      ],
      messages: [
        { direction: 'INBOUND', content: 'Halo mba bidan, mau tanya promo baby massage untuk usia 5 bulan?', sender_type: 'CUSTOMER' },
        { direction: 'OUTBOUND', content: 'Halo Bunda Anisa! 🌸 Untuk usia 5 bulan ada paket Baby Massage Ceria promo Rp 120.000 ya bund.', sender_type: 'BOT' },
        { direction: 'INBOUND', content: 'Kalau sekalian spa untuk ibunya ada paket bundlingnya ga?', sender_type: 'CUSTOMER' },
        { direction: 'OUTBOUND', content: 'Ada bund! Paket Mom & Baby Combo hanya Rp 350.000 sudah termasuk massage & mandi rempah.', sender_type: 'BOT' },
        { direction: 'INBOUND', content: 'Wah mau dsb bund! Boleh booking untuk hari Sabtu jam 10 pagi ke Sidoarjo?', sender_type: 'CUSTOMER' },
        { direction: 'OUTBOUND', content: 'Baik Bunda Anisa, jadwal Sabtu jam 10.00 WIB terkonfirmasi ya! Terima kasih.', sender_type: 'ADMIN', sender_name: 'Bidan Yusi' },
      ],
    },
    {
      phone: '6285712345678',
      name: 'Bunda Dewi Mulyosari',
      is_mql: true,
      mql_bubble_count: 8,
      mql_triggered_at: new Date('2026-08-03T09:30:00Z'),
      trackingCode: 'TC-PROMO-AGUSTUS',
      utmSource: 'instagram',
      utmCampaign: 'reels-mulyosari-homecare',
      reservations: [
        { treatment_category: 'BOTH', treatment_detail: 'Homecare Mom & Baby Spa Complete', status: 'confirmed', raw_text: 'Homecare Mom Baby Spa Complete' },
      ],
      messages: [
        { direction: 'INBOUND', content: 'Permisi min, lokasi Kala Spa Mulyosari di sebelah mana ya?', sender_type: 'CUSTOMER' },
        { direction: 'OUTBOUND', content: 'Halo Bunda Dewi! Kala Spa Mulyosari berlokasi di Raya Mulyosari No. 45 Surabaya.', sender_type: 'BOT' },
        { direction: 'INBOUND', content: 'Bisa dipanggil ke rumah (homecare) area Mulyosari?', sender_type: 'CUSTOMER' },
        { direction: 'OUTBOUND', content: 'Bisa banget bund! Biaya ongkir homecare area Mulyosari gratis (0 km - 3 km).', sender_type: 'BOT' },
        { direction: 'INBOUND', content: 'Minta pricelist lengkapnya dong min', sender_type: 'CUSTOMER' },
        { direction: 'INBOUND', content: 'Sama jadwal bidan yang kosong hari ini', sender_type: 'CUSTOMER' },
        { direction: 'OUTBOUND', content: 'Ini pricelist kami ya bund! Jadwal hari ini tersedia jam 14.00 dan 16.00 WIB.', sender_type: 'BOT' },
        { direction: 'INBOUND', content: 'Oke saya ambil slot jam 14.00 WIB ya min!', sender_type: 'CUSTOMER' },
      ],
    },
    {
      phone: '6289988776655',
      name: 'Bunda Rina Kenjeran',
      is_mql: false,
      mql_bubble_count: 2,
      mql_triggered_at: null,
      trackingCode: 'TC-IG-REELS-99',
      utmSource: 'tiktok',
      utmCampaign: 'tiktok-viral-spa',
      reservations: [],
      messages: [
        { direction: 'INBOUND', content: 'Halo admin, baby spa buka sampai jam berapa ya?', sender_type: 'CUSTOMER' },
        { direction: 'OUTBOUND', content: 'Halo Bunda Rina! Kala Spa buka setiap hari mulai pukul 08.00 - 17.00 WIB.', sender_type: 'BOT' },
        { direction: 'INBOUND', content: 'Oke makasih infonya min', sender_type: 'CUSTOMER' },
      ],
    },
  ];

  for (const item of dummyData) {
    try {
      // 1. Upsert Customer
      const customer = await prisma.customer.upsert({
        where: { phone: item.phone },
        update: {
          name: item.name,
          is_mql: item.is_mql,
          mql_bubble_count: item.mql_bubble_count,
          mql_triggered_at: item.mql_triggered_at,
          tenant_id: tenantId,
        },
        create: {
          tenant_id: tenantId,
          phone: item.phone,
          name: item.name,
          is_mql: item.is_mql,
          mql_bubble_count: item.mql_bubble_count,
          mql_triggered_at: item.mql_triggered_at,
          status: 'active',
        },
      });

      // 2. Upsert AdClick Tracking Code
      await prisma.adClick.upsert({
        where: { customerId: customer.id },
        update: {
          trackingCode: item.trackingCode,
          utmSource: item.utmSource,
          utmCampaign: item.utmCampaign,
        },
        create: {
          tenant_id: tenantId,
          customerId: customer.id,
          phone: customer.phone,
          trackingCode: item.trackingCode,
          utmSource: item.utmSource,
          utmCampaign: item.utmCampaign,
          fbclid: `fb.1.${Date.now()}.${Math.floor(Math.random() * 1000000)}`,
          fbp: `fb.1.${Date.now()}.${Math.floor(Math.random() * 1000000)}`,
        },
      });

      // 3. Create Reservations
      for (const res of item.reservations) {
        await prisma.reservation.create({
          data: {
            tenant_id: tenantId,
            customer_id: customer.id,
            treatment_category: res.treatment_category as any,
            treatment_detail: res.treatment_detail,
            raw_text: res.raw_text,
            status: res.status,
            booking_date: new Date(),
          },
        });
      }

      // 4. Create Conversation & Messages
      const conversation = await prisma.conversation.create({
        data: {
          tenant_id: tenantId,
          customer_id: customer.id,
          current_state: 'INITIAL',
          is_human_handling: false,
        },
      });

      for (const msg of item.messages) {
        await prisma.message.create({
          data: {
            tenant_id: tenantId,
            conversation_id: conversation.id,
            direction: msg.direction as any,
            content: msg.content,
            sender_type: msg.sender_type,
            sender_name: (msg as any).sender_name || null,
          },
        });
      }

      console.log(`✅ Dummy customer ${item.name} (${item.phone}) - Tracking Code ${item.trackingCode} inserted!`);
    } catch (err: any) {
      console.warn(`⚠️ Warning inserting ${item.name}: ${err.message}`);
    }
  }

  console.log('🎉 Seeding 3 dummy customers complete!');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
