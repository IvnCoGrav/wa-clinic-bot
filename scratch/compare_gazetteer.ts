const fs = require('fs');
const data = JSON.parse(fs.readFileSync('src/config/surabaya_sidoarjo_subdistricts.json', 'utf-8'));

// Data resmi Sidoarjo (Wikipedia, 18 kecamatan)
const official = {
  'Balongbendo': ['Balongbendo','Bakalan Wringinpitu','Bakungpringgodani','Bakungtemenggungan','Bogempinggir','Gadungkepuhsari','Jabaran','Jeruklegi','Kedungsukodani','Kemangsen','Penambangan','Seduri','Seketi','Singkalang','Sumokebangsri','Suwaluh','Waruberon','Watesari','Wonokarang','Wonokupang'],
  'Buduran': ['Banjarkemantren','Banjarsari','Buduran','Damarsi','Dukuhtengah','Entalsewu','Pagerwojo','Prasung','Sawohan','Sidokerto','Sidomulyo','Sidokepung','Siwalanpanji','Sukorejo','Wadungasih'],
  'Candi': ['Balongdowo','Balonggabus','Bligo','Candi','Durungbanjar','Durungbedug','Gelam','Jambangan','Kalipecabean','Karangtanjung','Kebonsari','Kedungkendo','Kedungpeluk','Kendalpecabean','Klurak','Larangan','Ngampelsari','Sepande','Sidodadi','Sugihwaras','Sumokali','Sumorame','Tenggulunan','Wedoroklurak'],
  'Gedangan': ['Bangah','Ganting','Gedangan','Gemurung','Karangbong','Keboansikep','Keboan Anom','Ketajen','Kragan','Punggul','Sawotratap','Semambung','Seruni','Tebel','Wedi'],
  'Jabon': ['Balongtani','Dukuhsari','Jemirahan','Keboguyang','Kedungcangkring','Kedungpandan','Kedungrejo','Kupang','Panggreh','Permisan','Semambung','Tambakkalisogo','Trompoasri'],
  'Krembung': ['Balonggarut','Cangkring','Gading','Jenggot','Kandangan','Kedungrawan','Kedungsumur','Keper','Keret','Krembung','Lemujut','Mojoruntut','Ploso','Rejeni','Tambakrejo','Tanjegwagir','Wangkal','Wonomlati','Waung'],
  'Krian': ['Barengkrajan','Gamping','Jatikalang','Jerukgamping','Junwangi','Katerungan','Keboharan','Kraton','Ponokawan','Sedenganmijen','Sidomojo','Sidomulyo','Sidorejo','Tempel','Terik','Terungkulon','Terungwetan','Tropodo','Watugolong','Kemasan','Krian','Tambak Kemerakan'],
  'Prambon': ['Bendotretek','Bulang','Cangkringturi','Gampang','Gedangrowo','Jatialunalun','Jatikalang','Jedongcangkring','Kajartengguli','Kedungkembar','Kedungsugo','Kedungwonokerto','Pejangkungan','Prambon','Simogirang','Simpang','Temu','Watutulis','Wirobiting','Wonoplintahan'],
  'Porong': ['Candipari','Glagaharum','Kebakalan','Kebonagung','Kedungboto','Kedungsolo','Kesambi','Lajuk','Pamotan','Pesawahan','Plumbon','Wunut','Gedang','Juwetkenongo','Porong'],
  'Sedati': ['Banjarkemuning','Betro','Buncitan','Cemandi','Gisikcemandi','Kalanganyar','Kwangsan','Pabean','Pepe','Pranti','Pulungan','Sedatiagung','Sedatigede','Segorotambak','Semampir','Tambakcemandi'],
  'Sidoarjo': ['Banjarbendo','Bluru Kidul','Cemengbakalan','Jati','Kemiri','Lebo','Rangka Kidul','Sarirogo','Suko','Sumput','Bulusidokare','Celep','Cemengkalang','Gebang','Lemahputro','Magersari','Pekauman','Pucang','Pucanganom','Sekardangan','Sidokare','Sidoklumpuk','Sidokumpul','Urangagung'],
  'Sukodono': ['Anggaswangi','Bangsri','Cangkringsari','Jumputrejo','Kebonagung','Keloposepuluh','Jogosatru','Masangankulon','Masanganwetan','Ngaresrejo','Pademonegoro','Panjunan','Pekarungan','Plumbungan','Sambungrejo','Sukodono','Suko','Suruh','Wilayut'],
  'Taman': ['Bohar','Bringinbendo','Gilang','Jemundo','Kedungturi','Tanjungsari','Kletek','Kramatjegu','Krembangan','Pertapan Maduretno','Sadang','Sambibulu','Sidodadi','Tawangsari','Trosobo','Wage','Bebekan','Geluran','Kalijaten','Ketegan','Ngelom','Sepanjang','Taman','Wonocolo'],
  'Tanggulangin': ['Banjarasri','Banjarpanji','Boro','Ganggang Panjang','Gempolsari','Kalidawir','Kalisampurno','Kalitengah','Kedensari','Kedungbanteng','Ketapang','Ketegan','Kludan','Ngaban','Penatarsewu','Putat','Randegan','Sentul'],
  'Tarik': ['Banjarwungu','Balongmacekan','Gampingrowo','Gempolklutuk','Janti','Kalimati','Kedungbocok','Kedinding','Kemuning','Kendalsewu','Klantingsari','Kramattemenggung','Mergobener','Mergosari','Mindugading','Mliriprowo','Sebani','Segodobancang','Singogalih','Tarik'],
  'Tulangan': ['Gelang','Grabagan','Grinting','Grogol','Janti','Jiken','Kajeksan','Kebaron','Kedondong','Kemantren','Kenongo','Kepatihan','Kepadangan','Kepuhkemiri','Kepunten','Medalem','Modong','Pangkemiri','Singopadu','Sudimoro','Tlasih','Tulangan'],
  'Waru': ['Berbek','Bungurasih','Janti','Kedungrejo','Kepuhkiriman','Kureksari','Medaeng','Ngingas','Pepelegi','Tambakoso','Tambarejo','Tambaksawah','Tambaksumur','Tropodo','Wadungasri','Waru','Wedoro'],
  'Wonoayu': ['Becirongengor','Candinegoro','Jimbarankulon','Jimbaranwetan','Karangpuri','Ketimang','Lambangan','Mojorangagung','Mulyodadi','Pagerngumbuk','Pilang','Plaosan','Ploso','Popoh','Sawocangkring','Semambung','Simoangin-angin','Simoketawang','Sumberejo','Tanggul','Wonoayu','Wonokalang','Wonokasian'],
};

// Normalisasi: hilangkan spasi & lowercase
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const norm2 = (s) => s.toLowerCase().replace(/\s+/g, '');

// Bandingkan per kecamatan
for (const [kec, officialList] of Object.entries(official)) {
  const inDb = data.filter(d => norm2(d.Kecamatan.replace(' (Kota)','')) === norm2(kec)).map(d => norm(d.Kelurahan_Desa));
  const missing = officialList.filter(o => !inDb.includes(norm(o)));
  if (missing.length > 0) {
    console.log(\n###  — HILANG : );
  } else {
    console.log(###  — lengkap ());
  }
}
