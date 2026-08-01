const fs = require("fs");
const data = JSON.parse(fs.readFileSync("src/config/surabaya_sidoarjo_subdistricts.json", "utf-8"));
const CLINIC = { lat: -7.34886, lng: 112.751677 };
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180, dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
const kecAvg = {};
for (const d of data) {
  const [lat, lng] = d.Koordinat.split(",").map(x => parseFloat(x.trim()));
  if (isNaN(lat) || isNaN(lng)) continue;
  if (!kecAvg[d.Kecamatan]) kecAvg[d.Kecamatan] = { latSum: 0, lngSum: 0, n: 0 };
  kecAvg[d.Kecamatan].latSum += lat; kecAvg[d.Kecamatan].lngSum += lng; kecAvg[d.Kecamatan].n++;
}

// 79 yang hilang (kecamatan -> daftar)
const missing = {
  "Balongbendo": ["Bakungpringgodani","Gadungkepuhsari","Wonokarang"],
  "Buduran": ["Banjarkemantren","Banjarsari","Sidokepung"],
  "Candi": ["Balongdowo","Jambangan"],
  "Gedangan": ["Gemurung","Seruni"],
  "Jabon": ["Jemirahan","Keboguyang","Kedungrejo","Tambakkalisogo"],
  "Krembung": ["Balonggarut","Kedungrawan","Kedungsumur","Waung"],
  "Krian": ["Tempel","Tropodo","Watugolong","Tambak Kemerakan"],
  "Prambon": ["Cangkringturi","Gampang","Gedangrowo","Jatialunalun","Jatikalang","Kedungsugo","Pejangkungan","Simpang"],
  "Porong": ["Kebakalan","Kedungboto"],
  "Sedati": ["Banjarkemuning","Gisikcemandi"],
  "Sidoarjo": ["Suko","Pekauman","Sidoklumpuk"],
  "Sukodono": ["Cangkringsari","Jogosatru","Sambungrejo","Wilayut"],
  "Taman": ["Gilang","Jemundo","Kedungturi","Tanjungsari","Kletek","Kramatjegu","Krembangan","Pertapan Maduretno","Bebekan","Ketegan"],
  "Tanggulangin": ["Ketapang"],
  "Tarik": ["Balongmacekan","Gempolklutuk","Kedinding","Kendalsewu","Klantingsari","Mliriprowo","Sebani","Segodobancang"],
  "Tulangan": ["Gelang","Grabagan","Grogol","Janti","Kedondong","Kenongo","Kepatihan","Kepuhkemiri","Kepunten","Medalem"],
  "Waru": ["Janti","Tambaksawah"],
  "Wonoayu": ["Mojorangagung","Pilang","Plaosan","Simoangin-angin","Simoketawang","Sumberejo","Wonokasian"]
};

console.log("=== KELURAHAN HILANG vs JARAK DARI KLINIK (estimasi kecamatan) ===\n");
console.log("KECAMATAN\tKELURAHAN\tEST_JARAK_KM\tSTATUS_25KM");
let in25 = 0, out25 = 0;
for (const [kec, list] of Object.entries(missing)) {
  const avg = kecAvg[kec];
  const dist = avg ? haversine(CLINIC.lat, CLINIC.lng, avg.latSum/avg.n, avg.lngSum/avg.n) : null;
  const status = dist !== null && dist > 25 ? ">25km (di luar)" : "<=25km";
  if (dist !== null && dist > 25) out25++; else in25++;
  for (const k of list) {
    console.log(`${kec}\t${k}\t${dist ? dist.toFixed(1) : "?"} km\t${status}`);
  }
}
console.log(`\nTotal: ${in25} di dalam 25km, ${out25} di luar 25km`);
