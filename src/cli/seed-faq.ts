import { knowledgeBaseService } from '../services/knowledge.service';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { prisma } from '../db/client';

const faqs = [
  {
    question: 'Apakah bayi sedang flu, batuk, atau pilek (bapil) boleh dipijat?',
    answer: 'Masih bisa dan sangat dianjurkan, Bunda. Kita bisa menggunakan treatment "Pijat Bayi Pulih Ceria" khusus bapil yang dirancang untuk membantu meredakan flu/batuk/pilek, mengencerkan lendir, dan merilekskan otot pernapasan si kecil.'
  },
  {
    question: 'Apakah bayi perlu mandi sebelum dipijat?',
    answer: 'Tidak perlu mandi sebelum pijat, Bunda. Nanti mandinya disarankan setelah pijat saja ya bund, agar minyak pijat/aromaterapi dapat meresap optimal di kulit si kecil terlebih dahulu.'
  },
  {
    question: 'Jika bayi sedang tidur saat Bidan Yusi datang, apakah perlu dibangunkan?',
    answer: 'Tidak usah dibangunkan tidak apa-apa, Bunda. Pijatan tetap bisa dilakukan saat si kecil tidur agar tidak merusak mood atau membuatnya kaget dan rewel. Jika si kecil terbangun sendiri secara alami baru kita sesuaikan ya bund.'
  },
  {
    question: 'Berapa lama durasi treatment pijat bayi?',
    answer: 'Untuk treatment pijat bayi durasinya berkisar sekitar 40 menit, Bunda. Waktu kedatangan yang kami jadwalkan (misal range 09.00-09.30) adalah estimasi jam tiba bidan kami di rumah Bunda.'
  },
  {
    question: 'Apakah treatment dikerjakan langsung oleh Bidan?',
    answer: 'Benar sekali, Bunda. Seluruh treatment (baik untuk Moms maupun Baby & Kids) ditangani langsung oleh bidan profesional kami yang berlatar belakang pendidikan kebidanan terdaftar (Bidan Yusi) sehingga aman bagi Bunda dan si kecil.'
  },
  {
    question: 'Di mana lokasi fisik/alamat kantor Kala Moms and Baby Spa?',
    answer: 'Kami berlokasi di daerah Waru (perbatasan Sidoarjo - Surabaya), Bunda. Kami melayani sistem Homecare (panggilan langsung ke rumah) sehingga Bunda tidak perlu repot keluar rumah.'
  },
  {
    question: 'Bagaimana metode pembayaran yang tersedia?',
    answer: 'Pembayaran bisa dilakukan secara tunai (cash) maupun non-tunai (transfer bank BCA / QRIS ShopeePay), Bunda. Pembayaran dilakukan setelah seluruh treatment selesai dilaksanakan.'
  },
  {
    question: 'Bagaimana ketentuan biaya transport (ongkir) untuk wilayah Surabaya & Sidoarjo?',
    answer: 'Ongkir dihitung berdasarkan jarak dari titik klinik kami di Waru. Di bawah 5 km free ongkir. Untuk jarak 5-30 km berkisar antara Rp 5.000 hingga Rp 25.000 setelah promo (ongkir normal Rp 15.000 - Rp 30.000). Di atas 30 km berada di luar jangkauan homecare kami.'
  },
  {
    question: 'Anak saya sedang menjalani fisioterapi, apakah aman dipijat agar tidak kaku?',
    answer: 'Aman dan sangat bagus, Bunda. Pijatan akan kami fokuskan pada area tubuh yang kaku (seperti tangan, kaki, punggung, dan pundak) dengan gerakan lembut yang bertujuan merilekskan otot-otot si kecil sesuai kondisinya.'
  },
  {
    question: 'Apa perbedaan antara treatment Pijat Ceria (Rileksasi) dan Pijat Pulih Ceria (Terapi)?',
    answer: 'Pijat Ceria (Rileksasi) ditujukan untuk bayi sehat tanpa keluhan untuk membantu tidur nyenyak. Pijat Pulih Ceria (Terapi) ditujukan untuk bayi dengan keluhan tertentu (seperti flu, batuk, pilek, rewel, susah BAB, kembung, kolik) menggunakan double aromaterapi dan stimulasi titik akupresur khusus.'
  },
  {
    question: 'Bagaimana jika anak rewel atau menangis saat latihan tengkurap (tummy time)?',
    answer: 'Hal itu sangat wajar karena otot leher/pundak si kecil belum terbiasa, Bunda. Jangan merasa bersalah atau memaksakannya. Bunda bisa melatihnya dengan metode chest-to-chest (menengkurapkan bayi di atas dada Bunda saat Bunda bersandar) selama 1-2 menit secara berkala sambil diajak bernyanyi atau diberi mainan.'
  },
  {
    question: 'Apa itu treatment Sinar Moksa / Inframerah hangat?',
    answer: 'Terapi tambahan sinar inframerah hangat (moksa) digunakan untuk membantu menghangatkan dada/punggung bayi guna mengencerkan dahak, melegakan saluran pernapasan, serta meredakan flu dan batuk secara efektif.'
  },
  {
    question: 'Apakah ada terapi untuk membantu mengeluarkan dahak bayi?',
    answer: 'Ada, Bunda. Kami menyediakan paket Pijat + Moksa (sinar hangat) seharga Rp 80rb - Rp 85rb, Pijat + Nebulizer (terapi uap) seharga Rp 105rb - Rp 150rb, dan paket lengkap Pijat + Nebulizer + Obat seharga Rp 135rb - Rp 180rb.'
  },
  {
    question: 'Kapan ibu pasca melahirkan boleh mulai dipijat?',
    answer: 'Ibu pasca melahirkan boleh langsung dipijat segera setelah melahirkan nifas (kondisi sehat), Bunda. Kami melayani Oksitosin Massage Fullbody untuk membantu pemulihan stamina pasca persalinan.'
  },
  {
    question: 'Apa manfaat dari Oksitosin Massage untuk ibu menyusui?',
    answer: 'Oksitosin Massage bermanfaat untuk merangsang pengeluaran hormon oksitosin yang memperlancar aliran ASI, merilekskan otot-otot punggung yang tegang akibat menyusui/menggendong, meningkatkan mood, serta membantu Bunda tidur lebih nyenyak.'
  },
  {
    question: 'Bagaimana penanganan lubang tindikan telinga bayi yang posisinya tidak pas (ketinggian)?',
    answer: 'Jika posisi tindikan kurang pas, anting yang bersangkutan (misal kanan) bisa segera dilepas dulu agar lubangnya menutup kembali secara alami. Pastikan mencuci tangan bersih dan berikan antiseptik di daun telinga bayi agar terhindar dari infeksi. Tindik ulang dapat dibetulkan pada kunjungan berikutnya.'
  }
];

async function main() {
  console.log('\x1b[36m[SEEDING] Mengosongkan data knowledge_chunks lama...\x1b[0m');
  try {
    await prisma.knowledgeChunk.deleteMany({
      where: { tenant_id: DEFAULT_TENANT_ID, source_type: 'FAQ' }
    });
    console.log('\x1b[32m[SEEDING] Data knowledge_chunks lama berhasil dikosongkan.\x1b[0m');
  } catch (err) {
    console.warn('\x1b[33m[SEEDING] Database kosong atau offline, lanjut ke seeding...\x1b[0m');
  }

  console.log(`\x1b[36m[SEEDING] Mengimpor ${faqs.length} FAQ baru...\x1b[0m`);
  const count = await knowledgeBaseService.importFaqs(faqs, DEFAULT_TENANT_ID);
  console.log(`\x1b[32m[SEEDING] Sukses! Berhasil mengimpor ${count} pasangan FAQ.\x1b[0m\n`);
}

main()
  .catch((e) => {
    console.error('\x1b[31m[SEEDING ERROR] Gagal menjalankan seed:\x1b[0m', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
