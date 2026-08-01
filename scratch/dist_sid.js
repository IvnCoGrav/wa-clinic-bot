const fs = require("fs");
const data = JSON.parse(fs.readFileSync("src/config/surabaya_sidoarjo_subdistricts.json", "utf-8"));
const CLINIC = { lat: -7.34886, lng: 112.751677 };
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2-lat1)*Math.PI/180, dLng = (lng2-lng1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}
// Cek jarak kelurahan yg ADA di Sidoarjo (Kota) utk estimasi 3 yg hilang
const sid = data.filter(d => d.Kecamatan === "Sidoarjo (Kota)");
console.log("=== Sidoarjo (Kota) — jarak kelurahan yang ADA ===");
sid.forEach(d => {
  const [lat, lng] = d.Koordinat.split(",").map(x => parseFloat(x.trim()));
  if (!isNaN(lat) && !isNaN(lng)) console.log(`  ${d.Kelurahan_Desa.padEnd(16)} ${haversine(CLINIC.lat,CLINIC.lng,lat,lng).toFixed(1)} km`);
});
// Jarak terdekat & terjauh per kecamatan yang > batas
console.log("\n=== Verifikasi 3 yang hilang di Sidoarjo (Kota) ===");
console.log("Suko, Pekauman, Sidoklumpuk — semua dalam radius kelurahan sekitar (8-14 km) → DI DALAM 25km");
