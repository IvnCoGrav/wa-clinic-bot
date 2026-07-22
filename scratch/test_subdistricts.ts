import { calculateHaversineDistance } from '../src/utils/haversine';
import { deliveryService } from '../src/services/delivery.service';
import { clinicConfig } from '../src/config/clinic';

interface SubdistrictTest {
  name: string;
  lat: number;
  lng: number;
}

const subdistricts: SubdistrictTest[] = [
  {
    name: 'Kelurahan Kertajaya (Kec. Gubeng) - Jarak Dekat',
    lat: -7.274328,
    lng: 112.763481
  },
  {
    name: 'Kelurahan Keputih (Kec. Sukolilo) - Jarak Sedang',
    lat: -7.288289,
    lng: 112.799757
  },
  {
    name: 'Kelurahan Lakarsantri (Kec. Lakarsantri) - Jarak Jauh',
    lat: -7.319762,
    lng: 112.637213
  },
  {
    name: 'Kelurahan Wedoro (Kec. Waru) - Jarak Sangat Dekat',
    lat: -7.362945,
    lng: 112.754891
  },
  {
    name: 'Kelurahan Waru (Kec. Waru) - Jarak Sangat Dekat',
    lat: -7.348332,
    lng: 112.736395
  },
  {
    name: 'Kelurahan Kedung Baruk / Baruk Utara (Kec. Rungkut) - Jarak Sedang',
    lat: -7.303126,
    lng: 112.784221
  }
];

async function main() {
  console.log('========================================================================');
  console.log('TEST JARAK & ONGKIR MOMS & BABY SPA (BIDAN YUSI)');
  console.log(`Titik Awal (Kala Moms and Baby Spa): Lat ${clinicConfig.lat}, Lng ${clinicConfig.lng}`);
  console.log('========================================================================\n');

  // Set diskon promo ke default 5000
  process.env.ONGKIR_PROMO_DISCOUNT = '5000';

  for (const sub of subdistricts) {
    const coords = { lat: sub.lat, lng: sub.lng };
    
    // Hitung jarak Haversine (straight-line)
    const haversineDist = calculateHaversineDistance({ lat: clinicConfig.lat, lng: clinicConfig.lng }, coords);

    // Hitung menggunakan deliveryService (yang menggunakan fallback Haversine jika ORS key kosong)
    const res = await deliveryService.calculateDelivery(coords);

    console.log(`📍 Lokasi: ${sub.name}`);
    console.log(`   - Koordinat: Lat ${sub.lat}, Lng ${sub.lng}`);
    console.log(`   - Jarak Terhitung: ${res.distanceKm} km (Haversine: ${haversineDist.toFixed(2)} km)`);
    console.log(`   - Status Jangkauan: ${res.isOutOfCoverage ? '❌ Luar Jangkauan (> 30 km)' : '✅ Masuk Coverage (<= 30 km)'}`);
    console.log(`   - Ongkir Normal: Rp ${res.normalPrice.toLocaleString('id-ID')}`);
    console.log(`   - Ongkir Promo: Rp ${res.promoPrice.toLocaleString('id-ID')}`);
    console.log(`   - Template Pesan Bot:\n     "${res.messageTemplate}"`);
    console.log('------------------------------------------------------------------------\n');
  }
}

main().catch(console.error);
