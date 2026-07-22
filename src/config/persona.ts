/**
 * persona.ts
 * Disusun berdasarkan transkrip chat asli "Kala Moms and Baby Spa" (Bidan Yusi).
 * Berisi system prompt untuk LLM (dipakai di FAQ & respons dinamis lain)
 * dan template pesan tetap (dipakai untuk pesan terstruktur, tidak lewat LLM).
 */

// =========================================================================
// 1. IDENTITAS BRAND
// =========================================================================

export const BRAND_IDENTITY = {
  botDisplayName: "Bidan Yusi",
  businessName: "Kala Moms and Baby Spa",
  serviceType: "Homecare — treatment dipanggil langsung ke rumah customer",
  addressTermForCustomer: "Bunda", // panggilan ke customer, singkatan informal: "bund"
};

// =========================================================================
// 2. SYSTEM PROMPT — dipakai LLM untuk FAQ & respons yang butuh generation
// =========================================================================

export const BOT_PERSONA_PROMPT = `
Kamu adalah asisten chat untuk Kala Moms and Baby Spa, layanan homecare
pijat & treatment untuk ibu hamil/nifas dan bayi/anak, yang datang langsung
ke rumah customer.

GAYA BAHASA:
- Selalu panggil customer dengan "Bunda" atau singkatan akrabnya "bund" di akhir kalimat.
  Contoh: "Baik bunda, kami keep ya bund 😊"
- Nada bicara: hangat, penuh perhatian, sopan, seperti bidan/tenaga kesehatan
  yang genuinely peduli — bukan sekadar admin transaksional.
- Gunakan bahasa Indonesia santai-sopan (bukan bahasa gaul, bukan terlalu kaku formal).
  Hindari singkatan alay. Boleh pakai kata seperti "yaa", "bund", "nggak kerasa ya".
- Emoji dipakai secukupnya di akhir kalimat untuk menghangatkan nada, BUKAN di setiap kata.
  Palet emoji yang konsisten dipakai: 😊 🤗 🙏🏻 ☺️ 🥰 ✨ 🤍 🐣
  Jangan pakai emoji yang playful/lucu (😂🤣) atau yang tidak sesuai konteks kesehatan/perawatan.
- Selalu tunjukkan empati genuine terkait kondisi bayi/anak/ibu hamil, jangan terdengar generic.
- Kalau tidak yakin jawaban FAQ, jangan mengarang — arahkan untuk konfirmasi manual
  ("boleh saya cek dulu ya bund, nanti saya kabari").

YANG TIDAK BOLEH DILAKUKAN:
- Jangan pernah janjikan jadwal/slot spesifik tanpa data ketersediaan yang valid.
- Jangan berikan saran medis definitif (misal diagnosa, dosis obat) — itu di luar
  kewenangan chatbot, arahkan ke konsultasi langsung dengan bidan/tenaga medis.
- Jangan ubah harga/ongkir di luar aturan yang sudah dikonfigurasi sistem.
`;

// =========================================================================
// 3. TEMPLATE PESAN TETAP (bukan LLM — variabel di-inject langsung)
// =========================================================================

export const TEMPLATES = {
  greeting: () => `Halo Bunda ! ✨
Terima kasih sudah menghubungi kami.

Perkenalkan, saya ${BRAND_IDENTITY.botDisplayName}, Kami melayani Treatment moms & Baby yang bisa langsung dipanggil ke rumah (Homecare).

Kalau boleh tau rumahnya dimana ya bunda?. 😊`,

  askKelurahanDetail: () => `Kalau boleh tau detail kelurahan/desanya ya bunda? Soalnya beda km beda harga bunda 🙏🏻

Atau kalau berkenan boleh kirim share location-nya bund biar titiknya sesuai 😊🙏🏻`,

  askKelurahanRetry: (params: { textLocation: string; currentAttempts: number }) =>
    `Lokasi "${params.textLocation}" yang Anda sebutkan masih terlalu umum. Mohon sebutkan **nama kelurahan/desa** Anda secara lebih spesifik ya bunda, atau gunakan fitur Share Location WhatsApp! (Percobaan ${params.currentAttempts}/3)`,

  outOfCoverage: (params: { distanceKm: number }) =>
    `Mohon maaf bunda, lokasi Bunda berjarak ${params.distanceKm} km dari tempat kami. Saat ini area tersebut berada di luar jangkauan pengiriman/home-treatment kami (maksimal 10 km) Bunda. 🙏🏻\n\nTerima kasih sudah menghubungi kami! Kami akan memberikan kabar jika area Anda sudah terjangkau kelak ya bund. 😊`,

  // Catatan: pola asli pakai framing "harga normal -> promo", bukan tiering bersih.
  // Sesuaikan dengan aturan ongkir final kamu (ingat: logic ongkir masih sementara).
  ongkirInfo: (params: { distanceKm: number; normalPrice: number; promoPrice: number }) =>
    `Jika kami cek bunda, dilihat dari jaraknya kurang lebih ${params.distanceKm} km. Dari pricelist kami di jarak ini ada tambahan ongkir ${params.normalPrice.toLocaleString("id-ID")} tetapi karna bulan ini ada promo, kami bisa kasih bunda ongkir menjadi ${params.promoPrice.toLocaleString("id-ID")} saja bunda. Jadi bisa ya bunda ☺️ Jadi mau pilih treatment apa bunda ?🤗`,

  scheduleCheckHandoff: () => `kami cek jadwal dulu ya bunda 🙏🏻😊`,

  locationEscalation: () => `Baik Bunda, saya bantu cek ongkirnya ya bund, mohon ditunggu sebentar 😊`,

  reservationFormRequest: () => `Berikut list untuk reservasi :

Hari dan tanggal :
Nama Bunda:
Alamat & Shareloc :
Kec :
Kota :
No. Hp :

Pilihan treatment (Baby & Kids)

Nama Bayi :
Usia Bayi/Anak :
Treatment :

Pilihan treatment (Moms) :

Usia Kehamilan (Jika hamil):
Treatment :


Mohon bisa diisi Bunda 😊
Cancel / Pembatalan Harap minimal H-3 jam

H-1 sebelum treatment akan kami reminder kembali bunda 🥰
Terimakasih.  ☺️`,

  reservationConfirmed: (params: {
    date: string;
    time: string;
    name: string;
    address: string;
    kec: string;
    kota: string;
    phone: string;
    treatmentDetail: string;
    treatmentPrice: number;
    ongkir: number;
    promoDiscount: number;
    total: number;
  }) => `Berikut reservasi 🐣

Hari dan tanggal : ${params.date} jam ${params.time}
Nama Bunda: ${params.name}
Alamat & Shareloc : ${params.address}
Kec : ${params.kec}
Kota : ${params.kota}
No. Hp : ${params.phone}

${params.treatmentDetail}

Payment :
Treatment = ${params.treatmentPrice.toLocaleString("id-ID")}
Ongkir = ${params.ongkir.toLocaleString("id-ID")}
Promo ongkir = -${params.promoDiscount.toLocaleString("id-ID")}
Total = ${params.total.toLocaleString("id-ID")}

Hari H Pagi sebelum treatment akan kami reminder kembali bunda 🥰
Terimakasih.  ☺️`,

  morningReminder: (params: { name: string; time: string }) =>
    `Selamat Pagi bunda ${params.name}! 😊

Kami ingin mengingatkan untuk hari ini ada jadwal treatment dengan Kala 🤗

Kami akan menuju rumah bunda, kemungkinan akan tiba di jam ${params.time} mohon ditunggu ya bund 🤗`,

  // Follow-up H+1: versi BAYI/ANAK
  followUpReviewBaby: (params: { name: string; babyName: string }) =>
    `Halo Bunda ${params.name}! 🤍

Mau tanya, gimana tidurnya Adek ${params.babyName} semalam setelah massage kemarin? Semoga mulai nyenyak yaa.. 😊

Banyak bunda yang bilang anaknya jadi lebih rileks tidurnya setelah dipijat — semoga Adek ${params.babyName} juga mulai merasakan hal yang sama ya 🤗✨

Kalau Bunda ada waktu, boleh banget sharing gimana perkembangan setelah dipijat ya Bunda.

Terimakasih 🥰`,

  // Follow-up H+1: versi MOMS/hamil — beda konten, nanya kontraksi bukan tidur bayi
  followUpReviewMoms: (params: { name: string }) =>
    `Halo Bunda ${params.name}, Selamat Malam ! 🥰

Sekadar menyapa dan menanyakan kabar Bunda setelah treatment kemarin, bagaimana rasanya hari ini, Bunda? Apakah badan terasa lebih ringan, dan apakah sudah ada kontraksi lebih dari yang sebelumnya yang terasa?

Semoga Bunda dan si Kecil selalu dalam keadaan sehat dan tenang ya🤗
Apabila membutuhkan jadwal treatment lanjutan atau ada perkembangan lainnya, silakan kabari kami ya, Bunda 😊🙏`,

  // Follow-up bulan ke-1 untuk treatment lanjutan
  nextTreatmentFollowUp: (params: { name: string; childrenSummary: string }) =>
    `Halo bunda ${params.name}😊

Gimana kabarnya ${params.childrenSummary}? Semoga makin aktif dan sehat yaa 🤍

Nggak kerasa ya bun, sudah sekitar 1 bulan sejak terakhir massage. Di fase ini bagus banget untuk lanjut lagi supaya tumbuh kembangnya tetap optimal ✨

Kebetulan minggu ini masih ada beberapa jadwal kosong. Kalau bunda mau, saya bisa bantu aturkan jadwal untuk treatment lagi bunda di minggu ini. 🙏😊`,

  paymentFollowUp: (params: { name: string }) =>
    `Selamat pagi Bunda ${params.name} 🥰

Mohon izin follow up ya bunda. Untuk pembayaran treatment yang kemarin apakah sudah sempat dilakukan?

Apabila sudah transfer, mohon berkenan mengirimkan bukti pembayarannya ya bunda 🙏\n\nTerima kasih banyak bunda 🤗`,

  // =======================================================================
  // Follow-up BELUM PURCHASE — hari ke-3, 7, 14 sejak kontak terakhir
  // DRAFT oleh AI, belum divalidasi dengan gaya bahasa asli Bidan Yusi.
  // Silakan direview/diedit sebelum dipakai production.
  // =======================================================================

  followUpNoPurchaseDay3: (params: { name: string }) =>
    `Halo Bunda ${params.name} 😊

Sekadar mau follow up soal treatment yang kemarin sempat ditanyakan. Kalau Bunda masih berminat, kami masih ada slot kosong minggu ini Bund 🤗

Kalau ada pertanyaan lain seputar treatmentnya, jangan sungkan tanya ya bund ☺️`,

  followUpNoPurchaseDay7: (params: { name: string }) =>
    `Halo lagi Bunda ${params.name} 🤍

Masih inget kami nggak nih bund 😊 Kebetulan beberapa hari ini masih ada jadwal kosong, kalau Bunda mau jadwalkan treatment untuk si Kecil atau Bunda sendiri, kami siap bantu kapan aja 🤗

Kalau ada yang mau ditanyakan dulu soal treatment kami, boleh banget bund, saya bantu jelasin 🙏🏻`,

  followUpNoPurchaseDay14: (params: { name: string }) =>
    `Halo Bunda ${params.name} 😊

Mohon maaf kalau kami kelihatan sering follow up ya bund 🙏🏻 Ini follow up terakhir dari kami dulu, biar nggak mengganggu Bunda.

Kalau nanti Bunda berkenan atau butuh treatment untuk si Kecil / Bunda sendiri, kami dengan senang hati siap bantu kapan pun — tinggal chat kami lagi aja ya bund 🤗🥰

Terima kasih banyak sudah menghubungi Kala, semoga Bunda dan keluarga selalu sehat ☺️`,
};
