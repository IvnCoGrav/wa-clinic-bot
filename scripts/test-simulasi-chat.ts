import { geocodingService } from '../src/integrations/google-maps/geocoding';
import { deliveryService } from '../src/services/delivery.service';
import { TEMPLATES } from '../src/config/persona';

async function runSimulation() {
  const scenarios = [
    'Food junction tandes sby',
    'Kalau ke karangpilang sby kenak brp bubid',
    'Kelurahan Tandes',
    'Kelurahan Karang Pilang',
    'rungkut',
    'Wedoro Waru',
  ];

  console.log('\n============================================================');
  console.log('🌸 SIMULASI BALASAN BOT — SKENARIO LOKASI & ONGKIR KLINIK KALA 🌸');
  console.log('============================================================\n');

  for (let i = 0; i < scenarios.length; i++) {
    const text = scenarios[i];
    const g = await geocodingService.geocodeText(text);
    let reply = '';

    if (g.ambiguityResults && g.ambiguityResults.length > 0) {
      reply = TEMPLATES.askKelurahanAmbiguous({
        kecamatanName: g.matchedSpan || g.ambiguityResults[0].Kecamatan,
        options: g.ambiguityResults,
      });
    } else if (g.isPrecise && g.lat && g.lng) {
      const del = await deliveryService.calculateDelivery({ lat: g.lat, lng: g.lng });
      reply = TEMPLATES.ongkirInfo({
        distanceKm: del.distanceKm,
        normalPrice: del.normalPrice,
        promoPrice: del.promoPrice,
        freeTierKm: del.freeTierKm,
      });
    } else {
      reply = TEMPLATES.askKelurahanRetry({ textLocation: text, currentAttempts: 1 });
    }

    console.log(`💬 SKENARIO ${i + 1}:`);
    console.log(`   Customer : "${text}"`);
    console.log(`   Status   : ${g.isPrecise ? 'PRESISE (Kelurahan Terdeteksi)' : 'AMBIGU / KECAMATAN (Minta Detail Kelurahan)'}`);
    console.log(`------------------------------------------------------------`);
    console.log(`   Bot Reply:`);
    console.log(reply);
    console.log('============================================================\n');
  }
}

runSimulation().catch(console.error);
