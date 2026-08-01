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
// Ambil 20 sample merata: 10 dekat (<10km), 5 sedang (10-20), 5 jauh (20-30)
const dists = data.map(d => {
  const [lat, lng] = d.Koordinat.split(",").map(x => parseFloat(x.trim()));
  return { ...d, lat, lng, dist: haversine(CLINIC.lat, CLINIC.lng, lat, lng) };
}).filter(d => !isNaN(d.dist));
dists.sort((a,b) => a.dist - b.dist);
const near = dists.filter(d => d.dist < 10).slice(0, 10);
const mid = dists.filter(d => d.dist >= 10 && d.dist < 20).slice(0, 5);
const far = dists.filter(d => d.dist >= 20 && d.dist <= 30).slice(0, 5);
const samples = [...near, ...mid, ...far];

console.log("KECAMATAN\tKELURAHAN\tHAVERSINE\tHAV×1.25\tTIER_HAV\tORS\tTIER_ORS\tSELISIH%\tBEDA_TIER");
// ORS call via axios
const axios = require("axios");
const ORS_KEY = "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImZiYjQwNTI3M2ZmYjRkNTE4OTRhZjA4NDg5ZDNkYzViIiwiaCI6Im11cm11cjY0In0=";

(async () => {
  for (const s of samples) {
    let orsKm = null;
    try {
      const resp = await axios.post("https://api.openrouteservice.org/v2/directions/cycling-electric", {
        coordinates: [[CLINIC.lng, CLINIC.lat], [s.lng, s.lat]]
      }, { headers: { Authorization: ORS_KEY }, timeout: 10000 });
      const sum = resp.data?.routes?.[0]?.summary || resp.data?.features?.[0]?.properties?.summary;
      if (sum && typeof sum.distance === "number") orsKm = sum.distance / 1000;
    } catch (e) { orsKm = null; }

    const hav = s.dist;
    const hav125 = hav * 1.25;
    const tHav = tier(hav125);
    const tOrs = orsKm !== null ? tier(orsKm) : { name: "N/A" };
    const diff = orsKm !== null ? ((orsKm - hav125) / hav125 * 100).toFixed(0) : "N/A";
    const bedaTier = orsKm !== null && tOrs.name !== tHav.name ? "!!!" : "";
    console.log(`${s.Kecamatan}\t${s.Kelurahan_Desa}\t${hav.toFixed(1)}\t${hav125.toFixed(1)}\t${tHav.name}\t${orsKm !== null ? orsKm.toFixed(1) : "GAGAL"}\t${tOrs.name}\t${diff}%\t${bedaTier}`);
    await new Promise(r => setTimeout(r, 300)); // rate limit
  }
})();
