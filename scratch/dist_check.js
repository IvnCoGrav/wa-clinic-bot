const fs = require("fs");
const data = JSON.parse(fs.readFileSync("src/config/surabaya_sidoarjo_subdistricts.json", "utf-8"));

// Klinik
const CLINIC = { lat: -7.34886, lng: 112.751677 };

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Rata-rata koordinat per kecamatan (dari data yang ADA di DB)
const kecAvg = {};
for (const d of data) {
  const [lat, lng] = d.Koordinat.split(",").map(x => parseFloat(x.trim()));
  if (isNaN(lat) || isNaN(lng)) continue;
  if (!kecAvg[d.Kecamatan]) kecAvg[d.Kecamatan] = { latSum: 0, lngSum: 0, n: 0 };
  kecAvg[d.Kecamatan].latSum += lat;
  kecAvg[d.Kecamatan].lngSum += lng;
  kecAvg[d.Kecamatan].n++;
}

// Jarak rata-rata tiap kecamatan dari klinik
console.log("=== JARAK PER KECAMATAN (dari klinik, estimasi titik tengah) ===");
const kecDist = [];
for (const [kec, avg] of Object.entries(kecAvg)) {
  const lat = avg.latSum / avg.n, lng = avg.lngSum / avg.n;
  kecDist.push({ kec, dist: haversine(CLINIC.lat, CLINIC.lng, lat, lng) });
}
kecDist.sort((a, b) => a.dist - b.dist);
for (const k of kecDist) {
  console.log(`${k.kec.padEnd(22)} ${k.dist.toFixed(1)} km`);
}
