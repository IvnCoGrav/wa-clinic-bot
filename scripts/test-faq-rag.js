const dotenv = require('dotenv');
dotenv.config();
const { processSlotEngine } = require('../dist/slot-engine/slot-engine');

async function testFaqQueries() {
  const testCases = [
    {
      title: 'Query Durasi Per Anak (Bayi 2 Bulan Teridentifikasi)',
      input: 'Durasi per anak brp ya?',
      slateState: { childAgeMonths: 2, childAgeCategory: 'BABY', isLocationConfirmed: true, kelurahan: 'Pradah Kalikendal', distanceKm: 16.99, ongkirPromoFee: 20000 },
    },
    {
      title: 'Query Mandi Sebelum Pijat',
      input: 'Apakah bayi perlu mandi dulu sebelum dipijat?',
      slateState: { childAgeMonths: 2, childAgeCategory: 'BABY', isLocationConfirmed: true, kelurahan: 'Pradah Kalikendal', distanceKm: 16.99, ongkirPromoFee: 20000 },
    },
    {
      title: 'Query Susu Sebelum Pijat',
      input: 'Sebelum dipijat dedeknya boleh dikasih susu ga?',
      slateState: { childAgeMonths: 2, childAgeCategory: 'BABY', isLocationConfirmed: true, kelurahan: 'Pradah Kalikendal', distanceKm: 16.99, ongkirPromoFee: 20000 },
    },
  ];

  for (const tc of testCases) {
    console.log('\n======================================================');
    console.log('🧪 TEST:', tc.title);
    console.log('Input:', tc.input);
    console.log('======================================================');

    const ctx = {
      customer: {
        id: 'cust_faq_test',
        phone: '6288235780925',
        name: 'Bunda Melati',
        tenant_id: 'default-tenant',
        kelurahan: tc.slateState.kelurahan,
        kecamatan: 'Dukuh Pakis',
        kota: 'Kota Surabaya',
        lat: -7.281,
        lng: 112.684,
        pricelist_sent: true,
        preferences: {
          childAgeMonths: tc.slateState.childAgeMonths,
          childAgeCategory: tc.slateState.childAgeCategory,
          distanceKm: tc.slateState.distanceKm,
          ongkirPromoFee: tc.slateState.ongkirPromoFee,
        },
      },
      conversation: {
        id: 'conv_faq_test',
        current_state: 'AWAITING_INTEREST',
        is_human_handling: false,
      },
      incomingMessage: {
        text: { body: tc.input }
      },
      tenantId: 'default-tenant',
    };

    const res = await processSlotEngine(ctx);
    console.log('Bot Reply:');
    console.log(`"${res.replyText}"`);
  }
}

testFaqQueries().catch(console.error);
