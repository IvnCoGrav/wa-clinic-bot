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
  if (km <= 5) return 0;
  if (km <= 7) return 5000;
  if (km <= 10) return 10000;
  if (km <= 15) return 10000;
  if (km <= 20) return 15000;
  if (km <= 25) return 20000;
  if (km <= 30) return 25000;
  return -1;
}
// 50 sample: 25 padat Surabaya + 25 tersebar
const padat = ["Genteng","Tegalsari","Bubutan","Simokerto","Sawahan","Tambaksari","Wonokromo","Gubeng","Krembangan","Semampir","Pabean Cantian","Kenjeran","Sukolilo","Mulyorejo","Sukomanunggal","Wiyung","Gayungan","Karang Pilang","Dukuh Pakis","Tenggilis Mejoyo","Wonocolo","Gunung Anyar","Rungkut","Jambangan","Asemrowo"];
const samples = [];
for (const kec of padat) {
  const e = data.filter(d => d.Kecamatan === kec);
  if (e.length) samples.push(e[Math.floor(Math.random()*e.length)]);
}
// 25 acak dari sisa
const rest = data.filter(d => !padat.includes(d.Kecamatan));
for (let i = 0; i < 25; i++) {
  const r = rest[Math.floor(Math.random()*rest.length)];
  if (r) samples.push(r);
}

const axios = require("axios");
const ORS_KEY = "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImZiYjQwNTI3M2ZmYjRkNTE4OTRhZjA4NDg5ZDNkYzViIiwiaCI6Im11cm11cjY0In0=";

(async () => {
  const results = [];
  for (const s of samples) {
    const [lat, lng] = s.Koordinat.split(",").map(x => parseFloat(x.trim()));
    if (isNaN(lat)) continue;
    let orsKm = null;
    try {
      const resp = await axios.post("https://api.openrouteservice.org/v2/directions/cycling-electric", {
        coordinates: [[CLINIC.lng, CLINIC.lat], [lng, lat]]
      }, { headers: { Authorization: ORS_KEY }, timeout: 10000 });
      const sum = resp.data?.routes?.[0]?.summary || resp.data?.features?.[0]?.properties?.summary;
      if (sum && typeof sum.distance === "number") orsKm = sum.distance / 1000;
    } catch (e) { orsKm = null; }
    if (orsKm === null) continue;
    const hav = haversine(CLINIC.lat, CLINIC.lng, lat, lng);
    const ratio = orsKm / hav; // rasio sebenarnya
    results.push({ kec: s.Kecamatan, kel: s.Kelurahan_Desa, hav, ors: orsKm, ratio, tOrs: tier(orsKm) });
    await new Promise(r => setTimeout(r, 250));
  }

  // Hitung akurasi per faktor
  const factors = [1.25, 1.4, 1.5];
  console.log(`Total diuji: ${results.length}\n`);
  console.log("FAKTOR\tTIER_SAMA\t%_COCOK\tTOTAL_SELISIH_RP\tJML_UNDERCHARGE\tJML_OVERCHARGE");
  for (const f of factors) {
    let cocok = 0, totalSelisih = 0, under = 0, over = 0;
    for (const r of results) {
      const tHav = tier(r.hav * f);
      if (tHav === r.tOrs) cocok++;
      if (tHav !== -1 && r.tOrs !== -1) {
        totalSelisih += Math.abs(tHav - r.tOrs);
        if (tHav < r.tOrs) under++;
        if (tHav > r.tOrs) over++;
      }
    }
    console.log(`${f.toFixed(2)}\t${cocok}/${results.length}\t${(cocok/results.length*100).toFixed(0)}%\tRp${totalSelisih.toLocaleString()}\t${under}\t${over}`);
  }

  // Rasio aktual ORS vs Haversine — statistik
  const ratios = results.map(r => r.ratio).sort((a,b)=>a-b);
  const p50 = ratios[Math.floor(ratios.length*0.5)];
  const p80 = ratios[Math.floor(ratios.length*0.8)];
  const p90 = ratios[Math.floor(ratios.length*0.9)];
  const max = ratios[ratios.length-1];
  console.log(`\nRASIO ORS/HAVERSINE — p50:${p50.toFixed(2)} p80:${p80.toFixed(2)} p90:${p90.toFixed(2)} max:${max.toFixed(2)}`);
})();
