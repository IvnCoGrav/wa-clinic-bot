const fs = require("fs");
const data = JSON.parse(fs.readFileSync("src/config/surabaya_sidoarjo_subdistricts.json", "utf-8"));

function dice(a, b) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  a = norm(a); b = norm(b);
  if (a === b) return 1;
  const bg = (s) => { const set = new Set(); for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2)); return set; };
  const ba = bg(a), bb = bg(b);
  let inter = 0; for (const x of ba) if (bb.has(x)) inter++;
  return ba.size === 0 && bb.size === 0 ? 1 : (2 * inter) / (ba.size + bb.size);
}

const official = {
  "Balongbendo": ["Balongbendo","Bakalan Wringinpitu","Bakungpringgodani","Bakungtemenggungan","Bogempinggir","Gadungkepuhsari","Jabaran","Jeruklegi","Kedungsukodani","Kemangsen","Penambangan","Seduri","Seketi","Singkalang","Sumokebangsri","Suwaluh","Waruberon","Watesari","Wonokarang","Wonokupang"],
  "Buduran": ["Banjarkemantren","Banjarsari","Buduran","Damarsi","Dukuhtengah","Entalsewu","Pagerwojo","Prasung","Sawohan","Sidokerto","Sidomulyo","Sidokepung","Siwalanpanji","Sukorejo","Wadungasih"],
  "Candi": ["Balongdowo","Balonggabus","Bligo","Candi","Durungbanjar","Durungbedug","Gelam","Jambangan","Kalipecabean","Karangtanjung","Kebonsari","Kedungkendo","Kedungpeluk","Kendalpecabean","Klurak","Larangan","Ngampelsari","Sepande","Sidodadi","Sugihwaras","Sumokali","Sumorame","Tenggulunan","Wedoroklurak"],
  "Gedangan": ["Bangah","Ganting","Gedangan","Gemurung","Karangbong","Keboansikep","Keboan Anom","Ketajen","Kragan","Punggul","Sawotratap","Semambung","Seruni","Tebel","Wedi"],
  "Jabon": ["Balongtani","Dukuhsari","Jemirahan","Keboguyang","Kedungcangkring","Kedungpandan","Kedungrejo","Kupang","Panggreh","Permisan","Semambung","Tambakkalisogo","Trompoasri"],
  "Krembung": ["Balonggarut","Cangkring","Gading","Jenggot","Kandangan","Kedungrawan","Kedungsumur","Keper","Keret","Krembung","Lemujut","Mojoruntut","Ploso","Rejeni","Tambakrejo","Tanjegwagir","Wangkal","Wonomlati","Waung"],
  "Krian": ["Barengkrajan","Gamping","Jatikalang","Jerukgamping","Junwangi","Katerungan","Keboharan","Kraton","Ponokawan","Sedenganmijen","Sidomojo","Sidomulyo","Sidorejo","Tempel","Terik","Terungkulon","Terungwetan","Tropodo","Watugolong","Kemasan","Krian","Tambak Kemerakan"],
  "Prambon": ["Bendotretek","Bulang","Cangkringturi","Gampang","Gedangrowo","Jatialunalun","Jatikalang","Jedongcangkring","Kajartengguli","Kedungkembar","Kedungsugo","Kedungwonokerto","Pejangkungan","Prambon","Simogirang","Simpang","Temu","Watutulis","Wirobiting","Wonoplintahan"],
  "Porong": ["Candipari","Glagaharum","Kebakalan","Kebonagung","Kedungboto","Kedungsolo","Kesambi","Lajuk","Pamotan","Pesawahan","Plumbon","Wunut","Gedang","Juwetkenongo","Porong"],
  "Sedati": ["Banjarkemuning","Betro","Buncitan","Cemandi","Gisikcemandi","Kalanganyar","Kwangsan","Pabean","Pepe","Pranti","Pulungan","Sedatiagung","Sedatigede","Segorotambak","Semampir","Tambakcemandi"],
  "Sidoarjo": ["Banjarbendo","Bluru Kidul","Cemengbakalan","Jati","Kemiri","Lebo","Rangka Kidul","Sarirogo","Suko","Sumput","Bulusidokare","Celep","Cemengkalang","Gebang","Lemahputro","Magersari","Pekauman","Pucang","Pucanganom","Sekardangan","Sidokare","Sidoklumpuk","Sidokumpul","Urangagung"],
  "Sukodono": ["Anggaswangi","Bangsri","Cangkringsari","Jumputrejo","Kebonagung","Keloposepuluh","Jogosatru","Masangankulon","Masanganwetan","Ngaresrejo","Pademonegoro","Panjunan","Pekarungan","Plumbungan","Sambungrejo","Sukodono","Suko","Suruh","Wilayut"],
  "Taman": ["Bohar","Bringinbendo","Gilang","Jemundo","Kedungturi","Tanjungsari","Kletek","Kramatjegu","Krembangan","Pertapan Maduretno","Sadang","Sambibulu","Sidodadi","Tawangsari","Trosobo","Wage","Bebekan","Geluran","Kalijaten","Ketegan","Ngelom","Sepanjang","Taman","Wonocolo"],
  "Tanggulangin": ["Banjarasri","Banjarpanji","Boro","Ganggang Panjang","Gempolsari","Kalidawir","Kalisampurno","Kalitengah","Kedensari","Kedungbanteng","Ketapang","Ketegan","Kludan","Ngaban","Penatarsewu","Putat","Randegan","Sentul"],
  "Tarik": ["Banjarwungu","Balongmacekan","Gampingrowo","Gempolklutuk","Janti","Kalimati","Kedungbocok","Kedinding","Kemuning","Kendalsewu","Klantingsari","Kramattemenggung","Mergobener","Mergosari","Mindugading","Mliriprowo","Sebani","Segodobancang","Singogalih","Tarik"],
  "Tulangan": ["Gelang","Grabagan","Grinting","Grogol","Janti","Jiken","Kajeksan","Kebaron","Kedondong","Kemantren","Kenongo","Kepatihan","Kepadangan","Kepuhkemiri","Kepunten","Medalem","Modong","Pangkemiri","Singopadu","Sudimoro","Tlasih","Tulangan"],
  "Waru": ["Berbek","Bungurasih","Janti","Kedungrejo","Kepuhkiriman","Kureksari","Medaeng","Ngingas","Pepelegi","Tambakoso","Tambarejo","Tambaksawah","Tambaksumur","Tropodo","Wadungasri","Waru","Wedoro"],
  "Wonoayu": ["Becirongengor","Candinegoro","Jimbarankulon","Jimbaranwetan","Karangpuri","Ketimang","Lambangan","Mojorangagung","Mulyodadi","Pagerngumbuk","Pilang","Plaosan","Ploso","Popoh","Sawocangkring","Semambung","Simoangin-angin","Simoketawang","Sumberejo","Tanggul","Wonoayu","Wonokalang","Wonokasian"]
};

const norm2 = (s) => s.toLowerCase().replace(/\s+/g, "");
let out = "KABUPATEN_KOTA\tKECAMATAN\tKELURAHAN_DESA\tKODE_POS\tKOORDINAT_LAT_LNG\n";
let count = 0;
for (const [kec, list] of Object.entries(official)) {
  const dbEntries = data.filter(d => norm2(d.Kecamatan.replace(" (Kota)","")) === norm2(kec));
  const dbNames = dbEntries.map(d => d.Kelurahan_Desa);
  for (const o of list) {
    const hit = dbNames.some(db => dice(db, o) >= 0.75);
    if (!hit) {
      out += `Kabupaten Sidoarjo\t${kec}\t${o}\t\t\n`;
      count++;
    }
  }
}
fs.writeFileSync("docs/kelurahan_hilang.tsv", out, "utf-8");
console.log("File: docs/kelurahan_hilang.tsv");
console.log("Total baris: " + count);
console.log("\nPreview:");
console.log(out.split("\n").slice(0, 8).join("\n"));
