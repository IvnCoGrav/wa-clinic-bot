const fs = require("fs");
const data = JSON.parse(fs.readFileSync("src/config/surabaya_sidoarjo_subdistricts.json", "utf-8"));
const CLINIC = { lat: -7.34886, lng: 112.751677 };
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2-lat1)*Math.PI/180, dLng = (lng2-lng1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}
function tier(km) {
  if (km <= 5) return { fee: 0, name: "GRATIS" };
  if (km <= 7) return { fee: 5000, name: "Rp5rb" };
  if (km <= 10) return { fee: 10000, name: "Rp10rb" };
  if (km <= 15) return { fee: 10000, name: "Rp10rb" };
  if (km <= 20) return { fee: 15000, name: "Rp15rb" };
  if (km <= 25) return { fee: 20000, name: "Rp20rb" };
  if (km <= 30) return { fee: 25000, name: "Rp25rb" };
  return { fee: -1, name: "LUAR" };
}
// Area padat/berkelok: pusat kota Surabaya
const targetKec = ["Genteng","Tegalsari","Bubutan","Simokerto","Sawahan","Tambaksari","Wonokromo","Gubeng","Krembangan","Semampir","Pabean Cantian","Kenjeran","Sukolilo","Mulyorejo","Sukomanunggal","Wiyung","Gayungan","Karang Pilang","Dukuh Pakis","Tenggilis Mejoyo"];
const samples = [];
for (const kec of targetKec) {
  const entries = data.filter(d => d.Kecamatan === kec);
  for (const d of entries) {
    const [lat, lng] = d.Koordinat.split(",").map(x => parseFloat(x.trim()));
    if (isNaN(lat)) continue;
    const dist = haversine(CLINIC.lat, CLINIC.lng, lat, lng);
    if (dist < 15) samples.push({ ...d, lat, lng, dist });
  }
}
// Ambil 20
samples.sort((a,b) => a.dist - b.dist);
const picked = samples.slice(0, 20);

const axios = require("axios");
const ORS_KEY = "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImZiYjQwNTI3M2ZmYjRkNTE4OTRhZjA4NDg5ZDNkYzViIiwiaCI6Im11cm11cjY0In0=";

(async () => {
  console.log("KECAMATAN\tKELURAHAN\tHAVERSINE\tHAVx1.25\tTIER_HAV\tORS\tTIER_ORS\tSELISIH%\tBEDA");
  let bedaCount = 0;
  for (const s of picked) {
    let orsKm = null;
    try {
      const resp = await axios.post("https://api.openrouteservice.org/v2/directions/cycling-electric", {
        coordinates: [[CLINIC.lng, CLINIC.lat], [s.lng, s.lat]]
      }, { headers: { Authorization: ORS_KEY }, timeout: 10000 });
      const sum = resp.data?.routes?.[0]?.summary || resp.data?.features?.[0]?.properties?.summary;
      if (sum && typeof sum.distance === "number") orsKm = sum.distance / 1000;
    } catch (e) { orsKm = null; }

    const hav125 = s.dist * 1.25;
    const tHav = tier(hav125);
    const tOrs = orsKm !== null ? tier(orsKm) : { name: "N/A" };
    const diff = orsKm !== null ? ((orsKm - hav125) / hav125 * 100).toFixed(0) : "N/A";
    const beda = orsKm !== null && tOrs.name !== tHav.name ? "!!!" : "";
    if (beda) bedaCount++;
    console.log(`${s.Kecamatan}\t${s.Kelurahan_Desa}\t${s.dist.toFixed(1)}\t${hav125.toFixed(1)}\t${tHav.name}\t${orsKm !== null ? orsKm.toFixed(1) : "GAGAL"}\t${tOrs.name}\t${diff}%\t${beda}`);
    await new Promise(r => setTimeout(r, 300));
  }
  console.log(`\nBEDA TIER: ${bedaCount}/20`);
})();
