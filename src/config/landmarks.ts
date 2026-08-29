/**
 * landmarks.ts
 * Kamus pemetaan Landmark, Apartemen, Mall, dan Perumahan Populer
 * di Surabaya dan Sidoarjo ke Kelurahan & Kecamatan resmi beserta koordinat presisi.
 */

export interface LandmarkEntry {
  name: string;
  patterns: RegExp[];
  kelurahan: string;
  kecamatan: string;
  kota: string;
  lat?: number;
  lng?: number;
}

export const POPULAR_LANDMARKS: LandmarkEntry[] = [
  // --- PERUMAHAN & LANDMARK SURABAYA BARAT ---
  {
    name: 'Perumahan Darmo Permai & Puri Darmo',
    patterns: [
      /\bdarmo\s*permai\s*(selatan|barat|timur|utara)?\b/i,
      /\bperumahan\s*puri\s*darmo\b/i,
      /\bpuri\s*darmo\s*permai\b/i,
      /\bdarmo\s*satelit\b/i,
    ],
    kelurahan: 'Pradah Kalikendal',
    kecamatan: 'Dukuh Pakis',
    kota: 'Kota Surabaya',
    lat: -7.281389,
    lng: 112.684754,
  },
  {
    name: 'Perumahan Darmo Indah & Darmo Harapan',
    patterns: [
      /\bdarmo\s*(indah|harapan)\b/i,
    ],
    kelurahan: 'Tandes',
    kecamatan: 'Tandes',
    kota: 'Kota Surabaya',
    lat: -7.266200,
    lng: 112.684100,
  },

  // --- APARTEMEN SURABAYA (REVISI KOORDINAT PRESISI) ---
  {
    name: 'City of Tomorrow (CITO / Paparazzi)',
    patterns: [
      /\b(cto|cito|city\s*of\s*tomorrow|paparazzi)\b/i,
    ],
    kelurahan: 'Dukuh Menanggal',
    kecamatan: 'Gayungan',
    kota: 'Kota Surabaya',
    lat: -7.345257,
    lng: 112.727300,
  },
  {
    name: 'Metropolis Apartemen Surabaya',
    patterns: [
      /\b(metropolis\s*apart[a-z]*|apartemen\s*metropolis)\b/i,
    ],
    kelurahan: 'Tenggilis Mejoyo',
    kecamatan: 'Tenggilis Mejoyo',
    kota: 'Kota Surabaya',
    lat: -7.320366,
    lng: 112.757987,
  },
  {
    name: 'Puncak Marina',
    patterns: [
      /\bpuncak\s*marina\b/i,
    ],
    kelurahan: 'Margorejo',
    kecamatan: 'Wonocolo',
    kota: 'Kota Surabaya',
    lat: -7.315546,
    lng: 112.749014,
  },
  {
    name: 'Gunawangsa MERR',
    patterns: [
      /\bgunawangsa\s*(mer|merr)\b/i,
    ],
    kelurahan: 'Kedung Baruk',
    kecamatan: 'Rungkut',
    kota: 'Kota Surabaya',
    lat: -7.310870,
    lng: 112.781352,
  },
  {
    name: 'Kyo Society',
    patterns: [
      /\b(kyo\s*society|kyo\s*city|kyo)\b/i,
    ],
    kelurahan: 'Panjang Jiwo',
    kecamatan: 'Tenggilis Mejoyo',
    kota: 'Kota Surabaya',
    lat: -7.311488,
    lng: 112.767124,
  },
  {
    name: 'Klaska Residence',
    patterns: [
      /\b(klaska|klaska\s*residence)\b/i,
    ],
    kelurahan: 'Jagir',
    kecamatan: 'Wonokromo',
    kota: 'Kota Surabaya',
    lat: -7.303372,
    lng: 112.743517,
  },
  {
    name: 'Gunawangsa Manyar',
    patterns: [
      /\bgunawangsa\s*manyar\b/i,
    ],
    kelurahan: 'Menur Pumpungan',
    kecamatan: 'Sukolilo',
    kota: 'Kota Surabaya',
    lat: -7.290027,
    lng: 112.768651,
  },
  {
    name: 'Bale Hinggil MERR',
    patterns: [
      /\bbale\s*hinggil\b/i,
    ],
    kelurahan: 'Medokan Semampir',
    kecamatan: 'Sukolilo',
    kota: 'Kota Surabaya',
    lat: -7.309964,
    lng: 112.781499,
  },
  {
    name: 'Grand Sungkono Lagoon (GSL)',
    patterns: [
      /\b(grand\s*sungkono|sungkono\s*lagoon|gsl)\b/i,
    ],
    kelurahan: 'Dukuh Pakis',
    kecamatan: 'Dukuh Pakis',
    kota: 'Kota Surabaya',
    lat: -7.290146,
    lng: 112.706889,
  },
  {
    name: 'Apartment Pavilion Permata',
    patterns: [
      /\b(pavilion\s*permata|permata\s*wahab\s*siamin)\b/i,
    ],
    kelurahan: 'Dukuh Pakis',
    kecamatan: 'Dukuh Pakis',
    kota: 'Kota Surabaya',
    lat: -7.292791,
    lng: 112.705321,
  },
  {
    name: 'Puncak Kertajaya',
    patterns: [
      /\bpuncak\s*kertajaya\b/i,
    ],
    kelurahan: 'Kertajaya',
    kecamatan: 'Gubeng',
    kota: 'Kota Surabaya',
    lat: -7.287879,
    lng: 112.785952,
  },
  {
    name: 'Anderson Tower (Pakuwon Mall)',
    patterns: [
      /\b(anderson|anderson\s*tower)\b/i,
      /\bpakuwon\s*mall\b/i,
      /\bpakuwon\s*trade\s*center\b/i,
      /\bptc\s*(sby|surabaya)?\b/i,
    ],
    kelurahan: 'Babatan',
    kecamatan: 'Wiyung',
    kota: 'Kota Surabaya',
    lat: -7.290546,
    lng: 112.675341,
  },
  {
    name: 'CitraLand Vittorio Wiyung',
    patterns: [
      /\b(citraland\s*vittorio|vittorio)\b/i,
    ],
    kelurahan: 'Babatan',
    kecamatan: 'Wiyung',
    kota: 'Kota Surabaya',
    lat: -7.311232,
    lng: 112.684820,
  },
  {
    name: 'Waterplace & Ascott Waterplace',
    patterns: [
      /\b(waterplace|ascott\s*waterplace)\b/i,
    ],
    kelurahan: 'Babatan',
    kecamatan: 'Wiyung',
    kota: 'Kota Surabaya',
    lat: -7.291725,
    lng: 112.674228,
  },
  {
    name: 'Benson, Orchard, Tanglin, La Riz',
    patterns: [
      /\b(benson|orchard|tanglin|la\s*riz|la\s*mansion)\b/i,
    ],
    kelurahan: 'Babatan',
    kecamatan: 'Wiyung',
    kota: 'Kota Surabaya',
    lat: -7.291725,
    lng: 112.674228,
  },
  {
    name: 'The Rosebay (Graha Famili)',
    patterns: [
      /\b(rosebay|the\s*rosebay|graha\s*famili)\b/i,
    ],
    kelurahan: 'Pradah Kalikendal',
    kecamatan: 'Dukuh Pakis',
    kota: 'Kota Surabaya',
    lat: -7.296637,
    lng: 112.680326,
  },
  {
    name: 'Apartment Taman Beverly',
    patterns: [
      /\b(taman\s*beverly|beverly)\b/i,
    ],
    kelurahan: 'Pradah Kalikendal',
    kecamatan: 'Dukuh Pakis',
    kota: 'Kota Surabaya',
    lat: -7.285575,
    lng: 112.696169,
  },
  {
    name: 'Puncak Bukit Golf',
    patterns: [
      /\bpuncak\s*bukit\s*golf\b/i,
    ],
    kelurahan: 'Pradah Kalikendal',
    kecamatan: 'Dukuh Pakis',
    kota: 'Kota Surabaya',
    lat: -7.282914,
    lng: 112.683218,
  },
  {
    name: 'Grand Shamaya & Trillium',
    patterns: [
      /\b(grand\s*shamaya|shamaya|trillium|trillium\s*residence)\b/i,
    ],
    kelurahan: 'Embong Kaliasin',
    kecamatan: 'Genteng',
    kota: 'Kota Surabaya',
    lat: -7.267420,
    lng: 112.741400,
  },
  {
    name: 'Apartemen Taman Melati (UNAIR)',
    patterns: [
      /\btaman\s*melati(\s*mulyorejo|\s*unair)?\b/i,
    ],
    kelurahan: 'Mulyorejo',
    kecamatan: 'Mulyorejo',
    kota: 'Kota Surabaya',
    lat: -7.261871,
    lng: 112.785798,
  },
  {
    name: 'The Galaxy Residences (GM)',
    patterns: [
      /\b(galaxy\s*residences?|galaxy\s*mall|gm\s*(1|2|3)?)\b/i,
    ],
    kelurahan: 'Mulyorejo',
    kecamatan: 'Mulyorejo',
    kota: 'Kota Surabaya',
    lat: -7.276514,
    lng: 112.779155,
  },
  {
    name: 'Pakuwon City Mall (PCM / East Coast / Educity / Laguna)',
    patterns: [
      /\b(pakuwon\s*city(\s*mall)?|pcm|east\s*coast(\s*center|\s*mall|\s*residence)?|educity(\s*apartment)?|san\s*antonio\s*pakuwon|laguna\s*pakuwon|grand\s*island\s*pakuwon|villa\s*royal\s*pakuwon|taman\s*florence|florence\s*pakuwon)\b/i,
    ],
    kelurahan: 'Kalisari',
    kecamatan: 'Mulyorejo',
    kota: 'Kota Surabaya',
    lat: -7.276389,
    lng: 112.805556,
  },
  {
    name: 'Grand Dharmahusada Lagoon',
    patterns: [
      /\b(grand\s*dharmahusada|dharmahusada\s*lagoon|gdl)\b/i,
    ],
    kelurahan: 'Mulyorejo',
    kecamatan: 'Mulyorejo',
    kota: 'Kota Surabaya',
    lat: -7.272532,
    lng: 112.796826,
  },
  {
    name: 'One Icon Residence & The Peak (TP)',
    patterns: [
      /\b(one\s*icon|the\s*peak|tunjungan\s*plaza|tp\s*(1|2|3|4|5|6)?)\b/i,
    ],
    kelurahan: 'Kedungdoro',
    kecamatan: 'Tegalsari',
    kota: 'Kota Surabaya',
    lat: -7.261119,
    lng: 112.738931,
  },
  {
    name: 'Puri Darmo Service Apartment',
    patterns: [
      /\bpuri\s*darmo\b/i,
    ],
    kelurahan: 'Sonokwijenan',
    kecamatan: 'Sukomanunggal',
    kota: 'Kota Surabaya',
    lat: -7.277931,
    lng: 112.704128,
  },
  {
    name: 'Gunawangsa Tidar',
    patterns: [
      /\b(gunawangsa\s*tidar)\b/i,
    ],
    kelurahan: 'Tembok Dukuh',
    kecamatan: 'Bubutan',
    kota: 'Kota Surabaya',
    lat: -7.254616,
    lng: 112.715254,
  },
  {
    name: 'Puncak Dharmahusada',
    patterns: [
      /\bpuncak\s*dharmahusada\b/i,
    ],
    kelurahan: 'Kalijudan',
    kecamatan: 'Mulyorejo',
    kota: 'Kota Surabaya',
    lat: -7.256838,
    lng: 112.779098,
  },
  {
    name: 'Puncak Permai Apartment',
    patterns: [
      /\bpuncak\s*permai\b/i,
    ],
    kelurahan: 'Tanjungsari',
    kecamatan: 'Sukomanunggal',
    kota: 'Kota Surabaya',
    lat: -7.279382,
    lng: 112.690302,
  },
  {
    name: 'Tamansari Prospero Sidoarjo',
    patterns: [
      /\b(tamansari\s*prospero|prospero\s*sidoarjo)\b/i,
    ],
    kelurahan: 'Sumput',
    kecamatan: 'Sidoarjo',
    kota: 'Kabupaten Sidoarjo',
    lat: -7.433399,
    lng: 112.693570,
  },
  {
    name: 'Ciputra World Surabaya (CW)',
    patterns: [
      /\b(ciputra\s*world|ciworld|cw\s*sby|voila|skyloft)\b/i,
    ],
    kelurahan: 'Gunung Sari',
    kecamatan: 'Dukuh Pakis',
    kota: 'Kota Surabaya',
    lat: -7.308253,
    lng: 112.721183,
  },
  {
    name: 'Grand City Mall Surabaya',
    patterns: [
      /\b(grand\s*city(\s*mall)?|gc\s*mall)\b/i,
    ],
    kelurahan: 'Ketabang',
    kecamatan: 'Genteng',
    kota: 'Kota Surabaya',
    lat: -7.260844,
    lng: 112.752317,
  },
  {
    name: 'The Trans Icon Mall Surabaya',
    patterns: [
      /\b(trans\s*icon(\s*mall|\s*apartment)?|the\s*trans\s*icon)\b/i,
    ],
    kelurahan: 'Gayungan',
    kecamatan: 'Gayungan',
    kota: 'Kota Surabaya',
    lat: -7.339257,
    lng: 112.729114,
  },
  {
    name: 'Plaza Marina Surabaya',
    patterns: [
      /\b(plaza\s*marina|marina\s*plaz?a)\b/i,
    ],
    kelurahan: 'Sidosermo',
    kecamatan: 'Wonocolo',
    kota: 'Kota Surabaya',
    lat: -7.316086,
    lng: 112.748057,
  },
  {
    name: 'Lippo Plaza Sidoarjo',
    patterns: [
      /\b(lippo\s*plaza(\s*sidoarjo)?|lippo\s*sda)\b/i,
    ],
    kelurahan: 'Jati',
    kecamatan: 'Sidoarjo',
    kota: 'Kabupaten Sidoarjo',
    lat: -7.453303,
    lng: 112.704253,
  },
  {
    name: 'Royal Plaza Surabaya',
    patterns: [
      /\b(royal\s*plaza)\b/i,
    ],
    kelurahan: 'Wonokromo',
    kecamatan: 'Wonokromo',
    kota: 'Kota Surabaya',
    lat: -7.300721,
    lng: 112.739763,
  },

  // --- PERUMAHAN SIDOARJO ---
  {
    name: 'Banjarmukti Residence',
    patterns: [
      /\bbanjar\s*mukti(\s*residence)?\b/i,
    ],
    kelurahan: 'Banjarkemantren',
    kecamatan: 'Buduran',
    kota: 'Kabupaten Sidoarjo',
    lat: -7.415538,
    lng: 112.719682,
  },
  {
    name: 'Safira Garden',
    patterns: [
      /\bsafira\s*garden\b/i,
    ],
    kelurahan: 'Sepande',
    kecamatan: 'Candi',
    kota: 'Kabupaten Sidoarjo',
    lat: -7.462250,
    lng: 112.695846,
  },
  {
    name: 'CitraGarden Sidoarjo',
    patterns: [
      /\bcitragarden(\s*sidoarjo)?\b/i,
    ],
    kelurahan: 'Entalsewu',
    kecamatan: 'Buduran',
    kota: 'Kabupaten Sidoarjo',
    lat: -7.431637,
    lng: 112.701805,
  },
  {
    name: 'Perumahan Pondok Jati',
    patterns: [
      /\bpondok\s*jati\b/i,
      /\bperum(ahan)?\s*pondok\s*jati\b/i,
    ],
    kelurahan: 'Jati',
    kecamatan: 'Sidoarjo (Kota)',
    kota: 'Kabupaten Sidoarjo',
    lat: -7.439574,
    lng: 112.701114,
  },
  {
    name: 'Taman Pinang Indah',
    patterns: [
      /\btaman\s*pinang(\s*indah)?\b/i,
      /\btpi\s*sidoarjo\b/i,
    ],
    kelurahan: 'Banjarbendo',
    kecamatan: 'Sidoarjo',
    kota: 'Kabupaten Sidoarjo',
    lat: -7.447545,
    lng: 112.697425,
  },
  {
    name: 'Tiara Regency / Graha Anggrek Mas',
    patterns: [
      /\btiara\s*regency\b/i,
      /\bgraha\s*anggrek\s*mas\b/i,
    ],
    kelurahan: 'Pagarwojo',
    kecamatan: 'Buduran',
    kota: 'Kabupaten Sidoarjo',
    lat: -7.436780,
    lng: 112.705640,
  },
  {
    name: 'Deltasari Indah & Deltasari Baru',
    patterns: [
      /\bdeltasari(\s*indah|\s*baru)?\b/i,
      /\bdelta\s*sari\b/i,
    ],
    kelurahan: 'Kureksari',
    kecamatan: 'Waru',
    kota: 'Kabupaten Sidoarjo',
    lat: -7.359218,
    lng: 112.738914,
  },
  {
    name: 'Puri Surya Jaya',
    patterns: [
      /\bpuri\s*surya\s*jaya\b/i,
    ],
    kelurahan: 'Ketajen',
    kecamatan: 'Gedangan',
    kota: 'Kabupaten Sidoarjo',
    lat: -7.385657,
    lng: 112.736069,
  },
  {
    name: 'Kahuripan Nirwana',
    patterns: [
      /\bkahuripan\s*nirwana\b/i,
    ],
    kelurahan: 'Sumput',
    kecamatan: 'Sidoarjo',
    kota: 'Kabupaten Sidoarjo',
    lat: -7.433618,
    lng: 112.688397,
  },
  {
    name: 'Graha Candi Golf',
    patterns: [
      /\bgraha\s*candi\s*golf\b/i,
    ],
    kelurahan: 'Sumokali',
    kecamatan: 'Candi',
    kota: 'Kabupaten Sidoarjo',
    lat: -7.469825,
    lng: 112.695846,
  },
];

/**
 * Mencari apakah teks query customer mengandung salah satu nama landmark / apartemen populer.
 */
export function findPopularLandmark(text: string): LandmarkEntry | null {
  if (!text || typeof text !== 'string') return null;
  const clean = text.toLowerCase();

  for (const entry of POPULAR_LANDMARKS) {
    for (const pattern of entry.patterns) {
      if (pattern.test(clean)) {
        return entry;
      }
    }
  }

  return null;
}
