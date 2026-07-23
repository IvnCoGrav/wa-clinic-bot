import { knowledgeBaseService } from '../services/knowledge.service';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { prisma } from '../db/client';

const faqs = [
  {
    "question": "Dimana lokasi Kala Moms and Baby Spa?",
    "answer": "Kami berlokasi di daerah Waru, perbatasan Sidoarjo-Surabaya. Kami melayani homecare, jadi tim kami yang datang langsung ke rumah Bunda, bukan Bunda yang datang ke tempat kami."
  },
  {
    "question": "Apakah yang melakukan pijat adalah bidan bersertifikat?",
    "answer": "Benar Bunda, treatment dilakukan oleh bidan kami."
  },
  {
    "question": "Berapa lama durasi treatment?",
    "answer": "Untuk treatment pijat bayi sekitar 40 menit. Untuk oksitosin massage fullbody (moms) sekitar 60 menit. Untuk paket laktasi, pijat punggung sekitar 30 menit dan pijat payudara sekitar 20-25 menit."
  },
  {
    "question": "Anak saya sedang pilek/batuk pilek, apakah masih bisa dipijat?",
    "answer": "Masih bisa Bunda, kami sarankan pakai treatment pijat bayi pulih ceria untuk membantu meredakan gejala bapil-nya."
  },
  {
    "question": "Apa itu treatment sinar moksa, dan apa bedanya dengan pijat biasa?",
    "answer": "Sinar moksa adalah tambahan treatment berupa terapi sinar/hangat untuk membantu meredakan bapil (batuk pilek) pada bayi, biasanya dikombinasikan dengan pijat bayi pulih ceria."
  },
  {
    "question": "Apa saja yang perlu disiapkan sebelum treatment?",
    "answer": "Tidak perlu menyiapkan apa-apa Bunda, semua perlengkapan treatment (minyak pijat, dll) sudah dibawa oleh tim kami."
  },
  {
    "question": "Metode pembayaran apa saja yang bisa dipakai?",
    "answer": "Bisa cash maupun transfer/QRIS Bunda. Pembayaran bisa dilakukan setelah treatment selesai."
  },
  {
    "question": "Apa saja pilihan treatment untuk bayi/anak?",
    "answer": "Untuk Baby & Kids kami punya beberapa pilihan seperti pijat bayi ceria, pijat bayi pulih ceria, dan relaksasi. Ada juga tambahan opsi sinar moksa untuk treatment tertentu."
  },
  {
    "question": "Apa saja pilihan treatment untuk ibu (moms)?",
    "answer": "Untuk Moms kami punya oksitosin massage fullbody and induksi massage fullbody (untuk usia kehamilan tertentu, biasanya 37-38 minggu ke atas)."
  },
  {
    "question": "Bagaimana kalau saya mau reschedule atau membatalkan jadwal?",
    "answer": "Pembatalan atau reschedule harap dilakukan minimal H-3 jam sebelum jadwal treatment ya Bunda."
  },
  {
    "question": "Apakah saya akan diingatkan sebelum jadwal treatment?",
    "answer": "Iya Bunda, kami akan mengirimkan reminder di pagi hari pada hari H sebelum tim kami berangkat ke rumah Bunda."
  },
  {
    "question": "Bagaimana cara booking treatment?",
    "answer": "Bunda bisa chat kami dengan info lokasi rumah, nanti kami bantu cek jarak dan ongkirnya, lalu kami bantu carikan jadwal yang sesuai."
  },
  {
    "question": "Apakah bisa booking untuk anak usia berapa saja?",
    "answer": "Bisa Bunda, kami melayani dari bayi baru lahir sampai anak usia beberapa tahun. Kalau boleh tau usia anaknya berapa Bunda, biar kami bisa rekomendasikan treatment yang sesuai."
  },
  {
    "question": "Apakah bisa booking lebih dari satu anak dalam satu jadwal?",
    "answer": "Bisa Bunda, kami bisa treatment lebih dari satu anak dalam satu kunjungan, tinggal infokan detail nama dan usia masing-masing anak ya Bunda."
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
