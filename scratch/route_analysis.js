const axios = require("axios");
const ORS_KEY = "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImZiYjQwNTI3M2ZmYjRkNTE4OTRhZjA4NDg5ZDNkYzViIiwiaCI6Im11cm11cjY0In0=";
const CLINIC = { lat: -7.34886, lng: 112.751677 };

// Decode Google polyline format (ORS menggunakan format ini)
function decodePolyline(str, precision = 5) {
  let index = 0, lat = 0, lng = 0, coordinates = [];
  while (index < str.length) {
    let result = 0, shift = 0, b;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += dlat;
    shift = 0; result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lng += dlng;
    coordinates.push([lat * Math.pow(10, -precision), lng * Math.pow(10, -precision)]);
  }
  return coordinates;
}

function bearing(lat1, lng1, lat2, lng2) {
  const toRad = Math.PI / 180;
  const y = Math.sin((lng2-lng1)*toRad) * Math.cos(lat2*toRad);
  const x = Math.cos(lat1*toRad)*Math.sin(lat2*toRad) - Math.sin(lat1*toRad)*Math.cos(lat2*toRad)*Math.cos((lng2-lng1)*toRad);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

const targets = [
  { name: "Tenggilis Mejoyo", lat: -7.3218, lng: 112.7875 },
  { name: "Waru Wedoro", lat: -7.348395, lng: 112.7494759 },
  { name: "Gayungan Menanggal", lat: -7.3293, lng: 112.7423 },
];

(async () => {
  for (const t of targets) {
    try {
      const resp = await axios.post("https://api.openrouteservice.org/v2/directions/cycling-electric", {
        coordinates: [[CLINIC.lng, CLINIC.lat], [t.lng, t.lat]]
      }, { headers: { Authorization: ORS_KEY }, timeout: 15000 });

      const route = resp.data.routes?.[0];
      const summary = route?.summary;
      const geomStr = route?.geometry;
      const coords = geomStr ? decodePolyline(geomStr) : null;

      if (!coords || coords.length < 3) {
        console.log(`\n${t.name}: geometri tidak tersedia`);
        continue;
      }

      const turns = [];
      for (let i = 1; i < coords.length - 1; i++) {
        const [lat1, lng1] = coords[i-1];
        const [lat2, lng2] = coords[i];
        const [lat3, lng3] = coords[i+1];
        const b1 = bearing(lat1, lng1, lat2, lng2);
        const b2 = bearing(lat2, lng2, lat3, lng3);
        let delta = Math.abs(b2 - b1);
        if (delta > 180) delta = 360 - delta;
        turns.push(delta);
      }

      const sharp = turns.filter(d => d >= 30).length;
      const medium = turns.filter(d => d >= 15 && d < 30).length;
      const routeKm = (summary?.distance / 1000) || 0;
      const havKm = 0; // placeholder

      console.log(`\n=== ${t.name} ===`);
      console.log(`  Titik polyline: ${coords.length}`);
      console.log(`  Belokan >=30°: ${sharp} (${(sharp/routeKm).toFixed(1)}/km)`);
      console.log(`  Belokan 15-30°: ${medium}`);
      console.log(`  Jarak rute: ${routeKm.toFixed(1)} km`);
      const top = turns.slice().sort((a,b) => b-a).slice(0, 5);
      console.log(`  5 belokan terbesar: ${top.map(d => d.toFixed(0)+"°").join(", ")}`);
    } catch (e) {
      console.log(`${t.name}: ERROR ${e.message.slice(0,80)}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }
})();
