/**
 * persona.ts
 * Disusun berdasarkan transkrip chat asli "Kala Moms and Baby Spa" (Bidan Yusi).
 * Berisi system prompt untuk LLM (dipakai di FAQ & respons dinamis lain)
 * dan template pesan tetap (dipakai untuk pesan terstruktur, tidak lewat LLM).
 */

import fs from 'fs';
import path from 'path';
import { getBrandIdentity } from './brand';

const CUSTOM_PERSONA_PATH = path.join(__dirname, 'persona_custom.txt');

// =========================================================================
// 2. SYSTEM PROMPT — dipakai LLM untuk FAQ & respons yang butuh generation
// =========================================================================

const DEFAULT_PERSONA_PROMPT = `
Kamu adalah asisten chat resmi ${getBrandIdentity().businessName}, layanan homecare
pijat & treatment untuk ibu hamil/nifas dan bayi/anak, yang datang langsung
ke rumah customer.

PERSONA & NADA:
- Kamu adalah sosok yang ramah, kalem, sopan, dan profesional — seperti bidan
  berpengalaman (${getBrandIdentity().botDisplayName}) yang tenang dan terpercaya.
- Jangan terlalu ceria atau kekanak-kanakan. Bicaralah dengan tenang, lembut,
  dan meyakinkan, bukan heboh. Hindari gaya ngobrol anak muda yang berlebihan.
- Penuh perhatian dan mengayomi (Caregiver), jujur dan apa adanya (Innocent),
  serta informatif dan menenangkan (Sage).

REASONING & INTENT ANALYSIS (EMPATI & KETENANGAN):
1. Analisa Emosi & Kebutuhan: Customer adalah ibu hamil/menyusui atau orang tua
   baru yang mungkin sedang lelah, khawatir, atau butuh dukungan. Pahami emosi mereka
   dari pesan (khawatir anak rewel, capek hamil tua, butuh relaksasi).
2. Tanggapan yang Menenangkan: Sebelum menawarkan produk, dengarkan dan respon
   keluhan/pertanyaan mereka dengan tenang, sabar, dan penuh pengertian. Tunjukkan
   empati yang wajar dan tidak berlebihan.
   - Contoh curhat: "Bayiku susah tidur nih bidan..."
   - Respon kaku: "Untuk pijat bayi harganya..." (SALAH)
   - Respon baik: "Tidak perlu khawatir, Bunda. Pada fase ini memang wajar jika si
     kecil rewel dan sulit tidur. Bidan bisa bantu dengan pijat relaksasi agar
     tidurnya lebih lelap. Boleh kami bantu jadwalkan?" (BENAR)
3. Jangan Memaksa: Jangan mendesak customer untuk booking atau membagi lokasi
   jika mereka masih bertanya santai atau berbagi keluh. Jawab dengan sabar dan beri
   mereka kenyamanan serta waktu.

GAYA BAHASA:
- Panggil customer dengan "Bunda" (jangan singkatan slang yang berlebihan).
- FORMAT TEKS (PENTING): WhatsApp hanya mengenal format SATU tanda. Untuk teks tebal
  pakai *satu bintang* (contoh: *Pijat Bayi Ceria*), DILARANG memakai dua bintang
  (**teks**) karena akan tampil mentah di WhatsApp. Miring pakai _teks_, coretan pakai
  ~teks~. Jangan memakai ** markdown ganda.
- Nama bisnis kami adalah ${getBrandIdentity().businessName} — EJAAN HARUS PERSIS.
  DILARANG menulis "Kala Mom's Baby Spa", "Kalaspia", atau variasi lainnya.
- Nada: ramah, sopan, tenang, profesional — seperti ${getBrandIdentity().botDisplayName}
  yang genuine peduli, bukan admin transaksional.
- Gunakan bahasa Indonesia yang santai namun sopan dan formal-baik (bukan gaul, bukan
  terlalu kaku). Detail, singkat, dan jelas.
- Emoji digunakan sangat sedikit dan hanya di akhir kalimat untuk memberi kesan hangat.
  Palet terbatas: 🙏🏻 ☺️ ✨ 🤍. Hindari emoji playful/berlebihan (😂🤣🥰 terlalu sering).
- Tanggapi pertanyaan dengan informasi yang akurat dan menenangkan, tidak mengada.
- Customer terkadang memanggilmu "bubid" (kependekan "bu bidan") atau
  "${getBrandIdentity().botDisplayName}". Kenali sebagai sapaan hangat.

YANG TIDAK BOLEH DILAKUKAN:
- DILARANG melempar pertanyaan ke tim/admin: jangan pernah mengetik frasa seperti
  "tanya ke tim kami", "nanti saya kabari", "mau cekkan ke tim dulu", atau sejenisnya.
  Kamu mewakili klinik yang serba tahu dan tenang.
- Jika ada detail harga/info spesifik yang tidak tercantum, jelaskan pelayanan yang
  kamu ketahui dengan ramah dan profesional tanpa alasan "tidak bisa memastikan".
- Jangan pernah janjikan jadwal/slot tanpa data ketersediaan yang valid.
- Jangan nasihat medis definitif (diagnosa/dosis) — di luar wewenang chatbot.
- Jangan ubah harga/ongkir di luar aturan terkonfigurasi.
- Jangan mulai pesan lanjutan dengan sapaan berulang ("Halo Bund", dll). Langsung
  jawab inti dengan santun dan tenang.
- HANYA bahasa Indonesia. DILARANG bahasa Inggris, Mandarin, Jepang, Arab, dst.
`;

let currentPersona = DEFAULT_PERSONA_PROMPT;
try {
  if (fs.existsSync(CUSTOM_PERSONA_PATH)) {
    currentPersona = fs.readFileSync(CUSTOM_PERSONA_PATH, 'utf8');
  }
} catch (err) {
  console.error('Failed to load custom persona from file:', err);
}

export let BOT_PERSONA_PROMPT = currentPersona;

// Cache maksimal karakter per balasan AI, keyed per tenant (SaaS-ready).
// null = tanpa limit. Terisi saat loadPersonaFromDb / savePersonaToDb.
const maxCharsByTenant = new Map<string, number | null>();

export function getMaxCharsPerReply(tenantId: string): number | null {
  const val = maxCharsByTenant.get(tenantId);
  return val === undefined ? null : val;
}

/**
 * Potong teks aman ke maksimal karakter, tanpa memotong di tengah kata.
 * Cari akhir kalimat (. ! ? \n) atau spasi terakhir sebelum batas.
 * max <= 0 / null => kembalikan teks apa adanya.
 */
export function truncateToMaxChars(text: string, max: number | null | undefined): string {
  if (!text) return text;
  const limit = Number(max);
  if (!limit || limit <= 0) return text;
  if (text.length <= limit) return text;

  const rawSlice = text.slice(0, limit);

  // 1. Cari akhir kalimat terakhir sebelum batas (agar tidak putus di tengah kalimat).
  //    Hanya . ! ? — jangan \n (baris baru bisa muncul di tengah format daftar, bukan akhir kalimat).
  const lastSentenceEnd = Math.max(
    rawSlice.lastIndexOf('.'),
    rawSlice.lastIndexOf('!'),
    rawSlice.lastIndexOf('?')
  );
  if (lastSentenceEnd > 0) {
    return rawSlice.slice(0, lastSentenceEnd + 1).trimEnd();
  }

  // 2. Fallback: potong di spasi terakhir (tidak memotong kata).
  const lastSpace = rawSlice.lastIndexOf(' ');
  if (lastSpace > 0) {
    return rawSlice.slice(0, lastSpace).trimEnd();
  }

  return rawSlice.trimEnd();
}

export function updatePersonaInMemoryAndFile(newPersona: string) {
  BOT_PERSONA_PROMPT = newPersona;
  try {
    fs.writeFileSync(CUSTOM_PERSONA_PATH, newPersona, 'utf8');
  } catch (err) {
    console.error('Failed to write custom persona to file:', err);
  }
}

/**
 * Load persona dari database per tenant (SaaS-ready).
 * Sumber kebenaran: tabel tenant_persona. Fallback: persona_custom.txt / default.
 */
export async function loadPersonaFromDb(tenantId: string): Promise<string> {
  try {
    const { prisma } = await import('../db/client');
    const record = await prisma.tenantPersona.findUnique({
      where: { tenant_id: tenantId },
    });
    if (record && record.persona && record.persona.trim().length > 0) {
      BOT_PERSONA_PROMPT = record.persona;
      maxCharsByTenant.set(tenantId, record.max_chars_per_reply ?? null);
      return record.persona;
    }
    // Tidak ada di DB -> seed dari current (file/default)
    if (BOT_PERSONA_PROMPT && BOT_PERSONA_PROMPT.trim().length > 0) {
      await prisma.tenantPersona.upsert({
        where: { tenant_id: tenantId },
        update: { persona: BOT_PERSONA_PROMPT },
        create: { tenant_id: tenantId, persona: BOT_PERSONA_PROMPT },
      });
    }
    return BOT_PERSONA_PROMPT;
  } catch (err) {
    console.warn('[PERSONA] DB unavailable, using file/default:', (err as Error).message);
    return BOT_PERSONA_PROMPT;
  }
}

/**
 * Simpan persona ke database per tenant (SaaS-ready) + update in-memory/file.
 * maxCharsPerReply (opsional): null/undefined = tanpa limit balasan AI.
 */
export async function savePersonaToDb(
  newPersona: string,
  tenantId: string,
  maxCharsPerReply?: number | null
): Promise<boolean> {
  try {
    const { prisma } = await import('../db/client');
    await prisma.tenantPersona.upsert({
      where: { tenant_id: tenantId },
      update: {
        persona: newPersona,
        ...(maxCharsPerReply === undefined ? {} : { max_chars_per_reply: maxCharsPerReply }),
      },
      create: {
        tenant_id: tenantId,
        persona: newPersona,
        max_chars_per_reply: maxCharsPerReply ?? null,
      },
    });
    updatePersonaInMemoryAndFile(newPersona);
    if (maxCharsPerReply !== undefined) {
      maxCharsByTenant.set(tenantId, maxCharsPerReply ?? null);
    }
    return true;
  } catch (err) {
    console.warn('[PERSONA] DB unavailable, using file fallback:', (err as Error).message);
    updatePersonaInMemoryAndFile(newPersona);
    if (maxCharsPerReply !== undefined) {
      maxCharsByTenant.set(tenantId, maxCharsPerReply ?? null);
    }
    return true;
  }
}

// =========================================================================
// 3. TEMPLATE PESAN TETAP (bukan LLM — variabel di-inject langsung)
// =========================================================================

export const TEMPLATES = {
  greeting: (params?: { skipGreeting?: boolean }) => {
    if (params?.skipGreeting) {
      return `Kami melayani Treatment moms & Baby yang bisa langsung dipanggil ke rumah (Homecare). Kalau boleh tau rumahnya dimana ya bunda?. 😊`;
    }
    return `Halo Bunda ! ✨
Terima kasih sudah menghubungi kami.

Perkenalkan, saya ${getBrandIdentity().botDisplayName}, Kami melayani Treatment moms & Baby yang bisa langsung dipanggil ke rumah (Homecare).

Kalau boleh tau rumahnya dimana ya bunda?. 😊`;
  },

  // Sapaan hangat untuk sesi idle panjang (1-2 hari): customer kembali chat dengan
  // sapaan basa-basi tanpa kebutuhan spesifik. Buka pertanyaan terbuka — jangan dorong
  // pitch reservasi/form. Rotasi variasi agar tidak kaku dipakai berulang (pola rolling template).
  warmReopenGreeting: () => {
    const variations: Array<() => string> = [
      () => `Halo Bunda! 😊 Ada yang bisa saya bantu hari ini?`,
      () => `Halo Bunda, senang bertemu lagi! 🌸 Ada yang bisa kami bantu untuk Bunda hari ini?`,
      () => `Halo Bunda! 👋 Gimana kabarnya? Kalau ada yang mau ditanyakan soal treatment homecare kami, silakan ya bund 😊`,
    ];
    return variations[Math.floor(Math.random() * variations.length)]();
  },

  askKelurahanDetail: () => `Kalau boleh tau detail kelurahan/desanya ya bunda? Soalnya beda km beda harga bunda 🙏🏻

Atau kalau berkenan boleh kirim share location-nya bund biar titiknya sesuai 😊🙏🏻`,

  greetingWithLocation: (params: { kelurahan: string; kecamatan: string; skipGreeting?: boolean }) => {
    if (params.skipGreeting) {
      return `Apakah treatment-nya masih di lokasi yang sama ya bund di *Kelurahan ${params.kelurahan}, Kec. ${params.kecamatan}*? Atau ada alamat baru? 😊`;
    }
    return `Halo Bunda! Selamat datang kembali di ${getBrandIdentity().businessName}. ✨
    
Apakah treatment-nya masih di lokasi yang sama ya bund di *Kelurahan ${params.kelurahan}, Kec. ${params.kecamatan}*? Atau ada alamat baru? 😊`;
  },

  confirmFuzzyLocation: (params: { kelurahan: string; kecamatan: string }) =>
    `Apakah yang Bunda maksud kelurahan *${params.kelurahan}*, Kec. *${params.kecamatan}*? 😊`,

  askClarifyMixedSignal: () =>
    `Mohon maaf bunda, saya agak kurang menangkap maksudnya. Apakah Bunda ingin menggunakan lokasi tersebut, atau ingin mengganti alamat? 😊`,

  confirmLocationFailedRetry: (params: { kelurahan: string; kecamatan: string }) =>
    `Mohon dikonfirmasi dulu ya Bunda 😊 — untuk lokasinya di Kelurahan ${params.kelurahan}, Kec. ${params.kecamatan} sudah benar atau mau pakai alamat lain ya bund?`,

  askKelurahanRetry: (params: { textLocation: string; currentAttempts: number }) =>
    `Kalau boleh tau lebih tepatnya ${params.textLocation} di kelurahan atau desa mana bunda? Nanti kami bantu cek an ongkir nya bund 🤗\nAtau jika berkenan mungkin bisa kirim sharelock nya bunda 😊🙏`,

  askKelurahanAmbiguous: (params: { kelurahanName: string; options: Array<{ Kelurahan_Desa: string; Kecamatan: string; Kabupaten_Kota: string }> }) => {
    const optionsText = params.options
      .map(opt => `- ${opt.Kelurahan_Desa}, Kec. ${opt.Kecamatan} (${opt.Kabupaten_Kota})`)
      .join('\n');
    return `Kalau boleh tau lebih tepatnya kelurahan/desa ${params.kelurahanName} di kecamatan mana ya bunda? Kami menemukan ada beberapa daerah dengan nama tersebut:\n\n${optionsText}\n\nMohon sebutkan nama kelurahan dan kecamatan Bunda secara lengkap agar kami tidak salah hitung ongkir ya bund! 🤗\nAtau jika berkenan mungkin bisa kirim sharelock nya bunda 😊🙏`;
  },

  outOfCoverage: (params: { distanceKm: number; maxCoverageKm?: number }) =>
    `Mohon maaf bunda, lokasi Bunda berjarak ${params.distanceKm.toFixed(1)} km dari tempat kami. Saat ini area tersebut berada di luar jangkauan pengiriman/home-treatment kami (maksimal ${params.maxCoverageKm ?? 30} km) Bunda. 🙏🏻\n\nTerima kasih sudah menghubungi kami! Kami akan memberikan kabar jika area Anda sudah terjangkau kelak ya bund. 😊`,

  // Catatan: pola asli pakai framing "harga normal -> promo", bukan tiering bersih.
  // Sesuaikan dengan aturan ongkir final kamu (ingat: logic ongkir masih sementara).
  ongkirInfo: (params: { distanceKm: number; normalPrice: number; promoPrice: number; freeTierKm?: number }) => {
    if (params.promoPrice === 0) {
      return `Wah, Deket Bunda, Dilihat dari jaraknya kurang lebih ${params.distanceKm.toFixed(1)} km (masih dalam jangkauan gratis ongkir hingga ${params.freeTierKm ?? 5} km), jadi layanan kami GRATIS ongkir ya bund ☺️ Jadi mau pilih treatment apa bunda ?🤗`;
    }
    return `Jika kami cek bunda, dilihat dari jaraknya kurang lebih ${params.distanceKm.toFixed(1)} km. Dari pricelist kami di jarak ini ada tambahan ongkir Rp${params.normalPrice.toLocaleString("id-ID")} tetapi karna bulan ini ada promo, kami bisa kasih bunda ongkir menjadi Rp${params.promoPrice.toLocaleString("id-ID")} saja bunda. Jadi bisa ya bunda ☺️ Jadi mau pilih treatment apa bunda ?🤗`;
  },

  scheduleCheckHandoff: () => `kami cek jadwal dulu ya bunda 🙏🏻😊`,

  locationEscalation: () => `Baik Bunda, saya bantu cek ongkirnya ya bund, mohon ditunggu sebentar 😊`,

  // =======================================================================
  // JAWABAN HARGA & PRICELIST (fitur "tanya harga -> beri tahu")
  // =======================================================================
  // CTA assumptive-close (yes-yes, bukan yes-no): arahkan ke konversi.
  priceCta: (name: string) => `Mau coba ${name} bunda ?`,
  // Format harga yang NATURAL/ngobrol (bukan brosur): deterministik, tanpa LLM,
  // tapi dibungkus kalimat percakapan supaya tidak terkesan "menempel brosur".
  priceInfo: (params: { name: string; ageTierLabel?: string; durationMinutes?: number; normalPrice: number; promoPrice: number }) => {
    const fmt = (n: number) => `Rp${n.toLocaleString('id-ID')}`;
    const dur = params.durationMinutes ? `, durasinya ${params.durationMinutes} menit` : '';
    const tier = params.ageTierLabel && params.ageTierLabel.trim()
      ? ` Sesuai untuk ${params.ageTierLabel.toLowerCase()}.`
      : '';
    return `Untuk *${params.name}*-nya, promo sekarang ${fmt(params.promoPrice)} aja Bunda (normalnya ${fmt(params.normalPrice)})${dur}.${tier} 😊`;
  },
  pricelistPrompt: () => `pricelist dari kami bunda, mau pilih yang mana bund ?`,
  pricelistIntro: () => `Berikut pricelist dari kami ya Bunda 😊`,
  // Minta share location setelah customer submit form reservasi (jika pin belum pernah dikirim).
  askShareLocation: () => `Kalau boleh, Bunda bisa sekalian kirim share location (pin) biar titiknya presisi ya 😊`,
  // INITIAL (belum ada lokasi): jangan menolak, langsung alihkan ke tanya lokasi.
  askLocationFirstPrice: () => `Boleh Bunda, nanti kita cek bareng soal harga treatment & ongkirnya ya 😊 Untuk itu kami perlu tahu lokasi Bunda dulu — rumahnya di mana ya, Bunda? 😊`,
  // AWAITING_LOCATION (belum ada lokasi, tapi harga sudah ditampilkan): tetap minta lokasi,
  // pakai nada ngobrol yang hangat, bukan formal.
  askLocationShort: () => `Bunda sekarang di area mana ya? Biar sekalian kami cek ongkirnya ke tempat Bunda 😊`,

  faqFollowUp: (faqAnswer: string, treatmentName?: string) => {
    // Follow-up personal dengan rotasi variasi supaya tidak kaku/terlalu mirip tiap kali
    const personal = treatmentName && treatmentName.trim() ? [
      `Kalau Bunda berminat, mau langsung pilih treatment *${treatmentName.trim()}* bunda? 😊`,
      `Bunda tertarik sama *${treatmentName.trim()}*-nya? Boleh langsung booking, nanti kami siapkan jadwalnya ya bund 🤗`,
      `Mau kami jadwalkan *${treatmentName.trim()}* untuk si kecil/bunda? Kabarin aja, nanti dibantuin 😊`,
      `Kalau cocok, *${treatmentName.trim()}* bisa langsung di-book bunda. Mau dibantu? 🙏`,
    ][Math.floor(Math.random() * 4)]
      : `Apakah Bunda tertarik untuk lanjut ke pengisian list reservasi treatment sekarang? 😊`;
    return `${faqAnswer}\n\n${personal}`;
  },

  interestUnrelatedFollowUp: () => `Apakah Bunda tertarik untuk lanjut mengisi list reservasi treatment homecare kami? 😊\n\nAtau jika ada hal yang ingin ditanyakan terlebih dahulu, silakan kabari kami ya, Bunda. Saya dengan senang hati siap membantu! 🤗`,

  notInterestedReply: () => `Baik Bunda, tidak apa-apa. Terima kasih banyak sudah menghubungi ${getBrandIdentity().businessName}! Jika sewaktu-waktu membutuhkan pijat atau treatment homecare, Bunda bisa menghubungi kami kembali ya bund. Have a great day! 🤗✨`,

  reservationFormRequest: (params?: { kecamatan?: string; kota?: string; phone?: string; name?: string; formatCheckout?: string }) => {
    const headerText = params?.formatCheckout && params.formatCheckout.trim().length > 0
      ? params.formatCheckout.trim()
      : 'Berikut list untuk reservasi :';

    const prefill = (field: string, value?: string) => {
      if (value && value.trim().length > 0) {
        return `${field} : ${value.trim()}`;
      }
      return `${field} :`;
    };

    return `${headerText}

Hari dan tanggal :
Nama Bunda:${params?.name ? ` ${params.name}` : ''}
Alamat & Shareloc :
${prefill('Kec', params?.kecamatan)}
${prefill('Kota', params?.kota)}
${prefill('No. Hp', params?.phone)}

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
Terimakasih.  ☺️`;
  },

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
    formatPurchase?: string;
    formatValue?: string;
  }) => {
    const purchaseLabel = params.formatPurchase && params.formatPurchase.trim().length > 0
      ? params.formatPurchase.trim()
      : 'Payment';

    const formatValueStr = (label: string, price: number) => {
      if (params.formatValue && params.formatValue.includes('%VALUE%')) {
        return params.formatValue.replace('%VALUE%', price.toLocaleString("id-ID"));
      }
      return `${label} = ${price.toLocaleString("id-ID")}`;
    };

    return `Berikut reservasi 🐣

Hari dan tanggal : ${params.date} jam ${params.time}
Nama Bunda: ${params.name}
Alamat & Shareloc : ${params.address}
Kec : ${params.kec}
Kota : ${params.kota}
No. Hp : ${params.phone}

${params.treatmentDetail}

${purchaseLabel} :
${formatValueStr('Treatment', params.treatmentPrice)}
Ongkir = ${params.ongkir.toLocaleString("id-ID")}
Promo ongkir = -${params.promoDiscount.toLocaleString("id-ID")}
Total = ${params.total.toLocaleString("id-ID")}

Hari H Pagi sebelum treatment akan kami reminder kembali bunda 🥰
Terimakasih.  ☺️`;
  },

  morningReminder: (params: { name: string; time: string }) =>
    `Selamat Pagi bunda ${params.name}! 😊

Kami ingin mengingatkan untuk hari ini ada jadwal treatment dengan ${getBrandIdentity().businessName} 🤗

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

  // Follow-up bulan ke-1 untuk treatment lanjutan (array varian)
  nextTreatmentFollowUp: [
    (params: { name: string; childrenSummary: string }) => `Halo bunda ${params.name}😊

Gimana kabarnya ${params.childrenSummary}? Semoga makin aktif dan sehat yaa 🤍

Nggak kerasa ya bun, sudah sekitar 1 bulan sejak terakhir massage. Di fase ini bagus banget untuk lanjut lagi supaya tumbuh kembangnya tetap optimal ✨

Kebetulan minggu ini masih ada beberapa jadwal kosong. Kalau bunda mau, saya bisa bantu aturkan jadwal untuk treatment lagi bunda di minggu ini. 🙏😊`,
    (params: { name: string; childrenSummary: string }) => `Halo Bunda ${params.name} 🤗

Apa kabar ${params.childrenSummary}? Semoga sehat-sehat terus ya 🤍

Sudah cukup lama nih sejak treatment terakhir. Kalau Bunda mau lanjut lagi, kami masih ada slot kosong yang bisa diatur sesuai jadwal Bunda 😊`
  ],

  paymentFollowUp: (params: { name: string }) =>
    `Selamat pagi Bunda ${params.name} 🥰

Mohon izin follow up ya bunda. Untuk pembayaran treatment yang kemarin apakah sudah sempat dilakukan?

Apabila sudah transfer, mohon berkenan mengirimkan bukti pembayarannya ya bunda 🙏\n\nTerima kasih banyak bunda 🤗`,

  // =======================================================================
  // Follow-up BELUM PURCHASE — hari ke-3, 7, 14 sejak kontak terakhir
  // Array varian: dipilih random tiap broadcast supaya tidak identik semua.
  // =======================================================================

  followUpNoPurchaseDay3: [
    (params: { name: string }) => `Halo Bunda ${params.name} 😊

Sekadar mau follow up soal treatment yang kemarin sempat ditanyakan. Kalau Bunda masih berminat, kami masih ada slot kosong minggu ini lho 🤗

Kalau ada pertanyaan lain seputar treatmentnya, jangan sungkan tanya ya bund ☺️`,
    (params: { name: string }) => `Hai Bunda ${params.name} 🤍

Mau nanya, gimana pertimbangannya soal treatment kemarin? Kami masih ada jadwal kosong kalau Bunda mau lanjut booking 😊

Ada yang mau ditanyakan dulu, boleh banget bund, siap bantu jelasin 🙏🏻`,
    (params: { name: string }) => `Selamat siang Bunda ${params.name} 😊

Ijin follow up soal treatment yang kemarin ya bund. Kalau masih tertarik, kabarin kami aja, nanti dibantu carikan jadwal yang pas 🤗`
  ],

  followUpNoPurchaseDay7: [
    (params: { name: string }) => `Halo lagi Bunda ${params.name} 🤍

Masih inget kami nggak nih bund 😊 Kebetulan beberapa hari ini masih ada jadwal kosong, kalau Bunda mau jadwalkan treatment untuk si Kecil atau Bunda sendiri, kami siap bantu kapan aja 🤗

Kalau ada yang mau ditanyakan dulu soal treatment kami, boleh banget bund, saya bantu jelasin 🙏🏻`,
    (params: { name: string }) => `Halo Bunda ${params.name} 😊

Udah seminggu ya sejak terakhir kita ngobrol soal treatment. Kalau Bunda masih mikir-mikir, nggak masalah bund, kami tetap siap bantu kapanpun Bunda siap 🤗

Ada yang bisa saya bantu jelaskan lagi soal treatmentnya? 🙏🏻`,
    (params: { name: string }) => `Hai Bunda ${params.name} 🥰

Kami masih inget Bunda lho 😊 Kalau masih berminat sama treatment yang kemarin dibahas, kabarin kami ya, jadwal masih ada kok 🤗`
  ],

  followUpNoPurchaseDay14: [
    (params: { name: string }) => `Halo Bunda ${params.name} 😊

Mohon maaf kalau kami kelihatan sering follow up ya bund 🙏🏻 Ini follow up terakhir dari kami dulu, biar nggak mengganggu Bunda.

Kalau nanti Bunda berkenan atau butuh treatment untuk si Kecil / Bunda sendiri, kami dengan senang hati siap bantu kapan pun — tinggal chat kami lagi aja ya bund 🤗🥰

Terima kasih banyak sudah menghubungi ${getBrandIdentity().businessName}, semoga Bunda dan keluarga selalu sehat ☺️`,
    (params: { name: string }) => `Halo Bunda ${params.name} 🤍

Ini follow up terakhir kami ya bund, biar Bunda nggak merasa terus-terusan dikejar 🙏🏻 Kapanpun Bunda butuh treatment, pintu kami selalu terbuka.

Terima kasih sudah pernah menghubungi ${getBrandIdentity().businessName}, semoga Bunda dan si Kecil sehat selalu 🥰`
  ],
};
