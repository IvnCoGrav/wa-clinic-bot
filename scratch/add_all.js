const fs = require("fs");
const file = "src/config/surabaya_sidoarjo_subdistricts.json";
const data = JSON.parse(fs.readFileSync(file, "utf-8"));
const CLINIC = { lat: -7.34886, lng: 112.751677 };
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2-lat1)*Math.PI/180, dLng = (lng2-lng1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}

const rows = `Kabupaten Sidoarjo	Balongbendo	Bakungpringgodani	61263	-7.420961, 112.505887
Kabupaten Sidoarjo	Balongbendo	Gadungkepuhsari	61263	-7.4279264, 112.5349392
Kabupaten Sidoarjo	Balongbendo	Wonokarang	61263	-7.4115099, 112.5110993
Kabupaten Sidoarjo	Buduran	Banjarkemantren	61252	-7.4155384, 112.7196817
Kabupaten Sidoarjo	Buduran	Banjarsari	61252	-7.414869, 112.741312
Kabupaten Sidoarjo	Buduran	Sidokepung	61252	-7.421382899999999, 112.7047843
Kabupaten Sidoarjo	Candi	Balongdowo	61271	-7.496820, 112.730585
Kabupaten Sidoarjo	Candi	Jambangan	61271	-7.465416899999998, 112.6839275
Kabupaten Sidoarjo	Gedangan	Gemurung	61254	-7.396392, 112.750549
Kabupaten Sidoarjo	Gedangan	Seruni	61254	-7.397721799999999, 112.7226611
Kabupaten Sidoarjo	Jabon	Jemirahan	61276	-7.549220, 112.733736
Kabupaten Sidoarjo	Jabon	Keboguyang	61276	-7.536875, 112.732831
Kabupaten Sidoarjo	Jabon	Kedungrejo	61276	-7.5664777, 112.7539449
Kabupaten Sidoarjo	Jabon	Tambakkalisogo	61276	-7.551719099999999, 112.7926759
Kabupaten Sidoarjo	Krembung	Balonggarut	61275	-7.5006697, 112.6392331
Kabupaten Sidoarjo	Krembung	Kedungrawan	61275	-7.530914, 112.643092
Kabupaten Sidoarjo	Krembung	Kedungsumur	61275	-7.535383, 112.656340
Kabupaten Sidoarjo	Krembung	Waung	61275	-7.511942, 112.662849
Kabupaten Sidoarjo	Krian	Tempel	61262	-7.379726, 112.591013
Kabupaten Sidoarjo	Krian	Tropodo	61262	-7.429571, 112.576052
Kabupaten Sidoarjo	Krian	Watugolong	61262	-7.3870444, 112.5915571
Kabupaten Sidoarjo	Krian	Tambak Kemerakan	61262	-7.402777, 112.583425
Kabupaten Sidoarjo	Prambon	Cangkringturi	61264	-7.449111, 112.600118
Kabupaten Sidoarjo	Prambon	Gampang	61264	-7.480603, 112.600818
Kabupaten Sidoarjo	Prambon	Gedangrowo	61264	-7.4740268, 112.5706982
Kabupaten Sidoarjo	Prambon	Jatialunalun	61264	-7.466398, 112.613579
Kabupaten Sidoarjo	Prambon	Jatikalang	61264	-7.477636, 112.603962
Kabupaten Sidoarjo	Prambon	Kedungsugo	61264	-7.462638, 112.582816
Kabupaten Sidoarjo	Prambon	Pejangkungan	61264	-7.475584, 112.593101
Kabupaten Sidoarjo	Prambon	Simpang	61264	-7.486740, 112.592002
Kabupaten Sidoarjo	Porong	Kebakalan	61274	-7.529229000000001, 112.6720092
Kabupaten Sidoarjo	Porong	Kedungboto	61274	-7.514633, 112.672256
Kabupaten Sidoarjo	Sedati	Banjarkemuning	61253	-7.378833099999999, 112.8165095
Kabupaten Sidoarjo	Sedati	Gisikcemandi	61253	-7.390004, 112.799417
Kabupaten Sidoarjo	Sidoarjo	Suko	61224	-7.446150, 112.678558
Kabupaten Sidoarjo	Sidoarjo	Pekauman	61213	-7.456416, 112.717494
Kabupaten Sidoarjo	Sidoarjo	Sidoklumpuk	61218	-7.448079, 112.724103
Kabupaten Sidoarjo	Sukodono	Cangkringsari	61258	-7.400294, 112.644396
Kabupaten Sidoarjo	Sukodono	Jogosatru	61258	-7.397201, 112.629502
Kabupaten Sidoarjo	Sukodono	Sambungrejo	61258	-7.388924299999999, 112.6511518
Kabupaten Sidoarjo	Sukodono	Wilayut	61258	-7.418121, 112.663407
Kabupaten Sidoarjo	Taman	Gilang	61257	-7.3627522, 112.6690296
Kabupaten Sidoarjo	Taman	Jemundo	61257	-7.369000, 112.679605
Kabupaten Sidoarjo	Taman	Kedungturi	61257	-7.357677, 112.703835
Kabupaten Sidoarjo	Taman	Tanjungsari	61257	-7.363690, 112.647090
Kabupaten Sidoarjo	Taman	Kletek	61257	-7.3594399, 112.6839275
Kabupaten Sidoarjo	Taman	Kramatjegu	61257	-7.379532, 112.631829
Kabupaten Sidoarjo	Taman	Krembangan	61257	-7.352886, 112.662854
Kabupaten Sidoarjo	Taman	Pertapan Maduretno	61257	-7.368226, 112.620727
Kabupaten Sidoarjo	Taman	Bebekan	61257	-7.344132, 112.700584
Kabupaten Sidoarjo	Taman	Ketegan	61257	-7.347468, 112.706098
Kabupaten Sidoarjo	Tanggulangin	Ketapang	61272	-7.5148131, 112.7047843
Kabupaten Sidoarjo	Tarik	Balongmacekan	61265	-7.449409999999999, 112.5110993
Kabupaten Sidoarjo	Tarik	Gempolklutuk	61265	-7.447717, 112.547239
Kabupaten Sidoarjo	Tarik	Kedinding	61265	-7.438031, 112.551502
Kabupaten Sidoarjo	Tarik	Kendalsewu	61265	-7.461119, 112.542475
Kabupaten Sidoarjo	Tarik	Klantingsari	61265	-7.462267, 112.546726
Kabupaten Sidoarjo	Tarik	Mliriprowo	61265	-7.440523, 112.467663
Kabupaten Sidoarjo	Tarik	Sebani	61265	-7.439560, 112.481629
Kabupaten Sidoarjo	Tarik	Segodobancang	61265	-7.434680, 112.534199
Kabupaten Sidoarjo	Tulangan	Gelang	61273	-7.497354, 112.652913
Kabupaten Sidoarjo	Tulangan	Grabagan	61273	-7.447778, 112.625956
Kabupaten Sidoarjo	Tulangan	Grogol	61273	-7.4618085, 112.6571111
Kabupaten Sidoarjo	Tulangan	Janti	61273	-7.479795, 112.622044
Kabupaten Sidoarjo	Tulangan	Kedondong	61273	-7.479370800000001, 112.6749042
Kabupaten Sidoarjo	Tulangan	Kenongo	61273	-7.486368799999999, 112.6466823
Kabupaten Sidoarjo	Tulangan	Kepatihan	61273	-7.487069900000001, 112.6571111
Kabupaten Sidoarjo	Tulangan	Kepuhkemiri	61273	-7.4529857, 112.6332737
Kabupaten Sidoarjo	Tulangan	Kepunten	61273	-7.4586767, 112.6213548
Kabupaten Sidoarjo	Tulangan	Medalem	61273	-7.4742776, 112.6600907
Kabupaten Sidoarjo	Waru	Janti	61256	-7.348870400000001, 112.7405377
Kabupaten Sidoarjo	Waru	Tambaksawah	61256	-7.364286799999999, 112.7822485
Kabupaten Sidoarjo	Wonoayu	Mojorangagung	61261	-7.431292, 112.662155
Kabupaten Sidoarjo	Wonoayu	Pilang	61261	-7.447665, 112.656753
Kabupaten Sidoarjo	Wonoayu	Plaosan	61261	-7.41543, 112.6273143
Kabupaten Sidoarjo	Wonoayu	Simoangin-angin	61261	-7.434898, 112.602342
Kabupaten Sidoarjo	Wonoayu	Simoketawang	61261	-7.446916, 112.598565
Kabupaten Sidoarjo	Wonoayu	Sumberejo	61261	-7.439081799999999, 112.6571111
Kabupaten Sidoarjo	Wonoayu	Wonokasian	61261	-7.4304851, 112.6526416`.trim().split("\n");

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
let added = 0, dup = 0, over25 = [];
for (const line of rows) {
  const p = line.split("\t").map(x => x.trim());
  const [kab, kec, kel, pos, koord] = p;
  const [latStr, lngStr] = koord.split(",").map(x => parseFloat(x.trim()));
  const dist = haversine(CLINIC.lat, CLINIC.lng, latStr, lngStr);
  const exists = data.some(d => norm(d.Kecamatan) === norm(kec) && norm(d.Kelurahan_Desa) === norm(kel));
  if (exists) {
    console.log(`DUPLIKAT (dilewati): ${kec} / ${kel}`);
    dup++;
    continue;
  }
  data.push({ Kabupaten_Kota: kab, Kecamatan: kec, Kelurahan_Desa: kel, Kode_Pos: pos, Koordinat: koord });
  added++;
  if (dist > 25) over25.push(`${kec}/${kel} (${dist.toFixed(1)}km)`);
}

fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf-8");
console.log(`\nDITAMBAH: ${added}, DUPLIKAT: ${dup}, TOTAL: ${data.length}`);
if (over25.length) console.log(`\n⚠️ DI LUAR 25km: ${over25.length}\n${over25.join("\n")}`);
