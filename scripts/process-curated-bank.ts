import * as fs from 'fs';
import * as path from 'path';

interface RawMessage {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  sender_type: string;
  content: string;
  created_at: string;
}

interface RawConversation {
  phone: string;
  customer_name: string | null;
  kelurahan: string | null;
  kecamatan: string | null;
  kota: string | null;
  conversation_id: string;
  created_at: string;
  messages: RawMessage[];
}

interface CuratedChatPair {
  id: string;
  category: string;
  customer_question: string;
  bidan_answer: string;
  customer_location?: string;
}

// 1. Filter: Hapus form/list template reservasi
function isReservationForm(text: string): boolean {
  return /(?:Format\s+Reservasi|Nama\s+(?:Bayi|Anak|Bunda|Ibu|Pasien)\s*:|Usia\s+(?:Bayi|Anak|Kehamilan)\s*:|Pilihan\s+treatment\s*:|Mohon\s+bisa\s+diisi|Cancel\s*\/\s*Pembatalan\s+Harap|H-1\s+sebelum\s+treatment|Alamat\s+Lengkap\s*:|Share\s+Loc\s*:|Hari\s*\/\s*Tgl\s+Treatment\s*:|Jam\s+Treatment\s*:|Pricelist\s+Treatment\s+Moms|isi\s+format|bantu\s+isi\s+reservasi|keep\s+jamnya)/i.test(text);
}

// 2. Filter: Hapus penginfoan ongkir (hitungan km, tarif jarak, angka ongkir)
function isOngkirInfo(text: string): boolean {
  return /(?:ongkir|ongkos\s+kirim|tambahan\s+ongkir|ongkirnya|gratis\s+ongkir|kurang\s+lebih\s+\d+(\.\d+)?\s*km|jarak\s+\d+\s*km|\b\d+\s*km\b)/i.test(text);
}

// 3. Deteksi pertanyaan/jawaban terkait ketersediaan jadwal slot/hari/waktu
function isScheduleInquiry(q: string, a: string): boolean {
  const combined = (q + ' ' + a).toLowerCase();
  return /(?:besok\s+(?:bisa|ada|bisa\s*kak|bisa\s*nggak|sore|pagi|siang|malam|gpp)|(?:bisa|ada\s*slot)\s+besok|hari\s+(?:senin|selasa|rabu|kamis|jumat|sabtu|minggu)\s+(?:bisa|ada)|klo\s+sabtu|apakah\s+bsk\s+msh\s+ada\s+slot|ada\s+slot\s+kosong|masih\s+ada\s+slot|slotnya\s+kosong|bisa\s+hari\s+(?:ini|besok)|jadwal\s+kosong\s+terdekat|sudah\s+full|sudah\s+penuh|weekend\s+kami\s+sudah\s+full|bisanya\s+dari\s+hari|sabtu\s+tgl\s+\d+|minggu\s+tgl\s+\d+|jadwal\s+kosong\s+kami\s+ada|jadwal\s+terdekat\s+kami|bisa\s+dijadwalkan\s+kapan)/i.test(combined);
}

function isNoise(q: string, a: string): boolean {
  const cleanQ = q.trim().toLowerCase();
  const cleanA = a.trim().toLowerCase();
  if (cleanQ.length < 3 || cleanA.length < 3) return true;
  if (/^(tes|test|p|halo|siang|pagi|malam|ok|oke|siap|\.)$/i.test(cleanQ) && /^(tes|test|p|halo|siang|pagi|malam|ok|oke|siap|\.|ini gambar tes)$/i.test(cleanA)) return true;
  if (/^ini gambar tes/i.test(cleanA) || /^tes$/i.test(cleanA) || /^ok$/i.test(cleanA) || /^siap$/i.test(cleanA)) return true;
  return false;
}

function categorizePair(q: string, a: string): string {
  const combined = (q + ' ' + a).toLowerCase();

  // 1. Layanan Tidak Tersedia / Penolakan Santun
  if (/(?:treatment\s+itu\s+kami\s+belum\s+ada|belum\s+ada\s+bunda|belum\s+melayani|hanya\s+melayani|mohon\s+maaf\s+bunda\s+untuk\s+treatment\s+itu|kami\s+belum\s+ada\s+layanan|cuci\s+hidung|tindik\s+anak\s+besar|tindik\s+dewasa)/i.test(a)) {
    return 'layanan_tidak_tersedia';
  }

  // 2. Batuk Pilek, Kembung, Flu, Nafas Grok-grok
  if (/(?:batuk|pilek|bapil|flu|grok|grook|meler|lendir|dahak|ingus|pulih\s*ceria|moksa|kembung|kolik|nebu|nebulizer)/i.test(combined)) {
    return 'terapi_batuk_pilek_dan_kembung';
  }

  // 3. Ibu Hamil, Nifas, Laktasi, Oksitosin
  if (/(?:hamil|ibu\s*hamil|nifas|pasca\s*melahirkan|laktasi|\basi\b|asi\s*seret|payudara|bengkak|oksitosin|pijat\s*ibu|ibu\s*menyusui)/i.test(combined)) {
    return 'perawatan_ibu_hamil_nifas_laktasi';
  }

  // 4. Newborn 0-40 hari, Selapan, Cukur, Tindik
  if (/(?:newborn|baru\s*lahir|0-40\s*hari|selapan|selapanan|cukur|gundul|potong\s*rambut|tindik|puput\s*pusar)/i.test(combined)) {
    return 'newborn_selapan_cukur_tindik';
  }

  // 5. Nafsu Makan / GTM
  if (/(?:susah\s*makan|gtm|nafsu\s*makan|lahap\s*juara|makan\s*lahap)/i.test(combined)) {
    return 'pijat_nafsu_makan_gtm';
  }

  // 6. Pijat Bayi Relaksasi & Rewel / Begadang
  if (/(?:rewel|susah\s*tidur|tidur\s*nyenyak|begadang|pijat\s*bayi|relaksasi|pijat\s*ceria|capek|pegal|masuk\s*angin)/i.test(combined)) {
    return 'pijat_bayi_relaksasi_dan_rewel';
  }

  // 7. Kids Spa (Balita & Anak)
  if (/(?:kids|balita|anak\s*2|anak\s*3|anak\s*4|anak\s*5|bubble\s*spa|kids\s*ceria)/i.test(combined)) {
    return 'perawatan_anak_kids_spa';
  }

  // 8. Jam Layanan & Operasional
  if (/(?:jam\s*operasional|batas\s*jam|bisa\s*malam|pijat\s*malam|sampai\s*jam\s*berapa)/i.test(combined)) {
    return 'jam_layanan_dan_operasional';
  }

  // 9. Konsep Layanan Homecare & Tanya Domisili
  if (/(?:homecare|datang\s*ke\s*rumah|dipanggil\s*ke\s*rumah|klinik\s*dimana|lokasinya\s*dimana|area\s*mana|daerah\s*mana|waru)/i.test(combined)) {
    return 'konsep_homecare_dan_domisili';
  }

  // 10. Metode Pembayaran
  if (/(?:bayar|transfer|bca|mandiri|bri|qris|tunai|cash)/i.test(combined)) {
    return 'metode_pembayaran';
  }

  // 11. Kualifikasi Bidan & STR
  if (/(?:bidan|terapis|str|sertifikat|resmi|pengalaman)/i.test(combined)) {
    return 'kualifikasi_bidan_dan_str';
  }

  // 12. Konsultasi Pasca-Vaksinasi
  if (/(?:vaksin|imunisasi|demam)/i.test(combined)) {
    return 'konsultasi_pasca_vaksin';
  }

  // 13. Ucapan Terima Kasih & Penutup
  if (/(?:makasih|terima\s*kasih|sama-sama\s*bunda)/i.test(combined)) {
    return 'ucapan_terima_kasih_dan_penutup';
  }

  return 'konsultasi_dan_edukasi_klinis';
}

async function main() {
  const inputPath = path.join(process.cwd(), 'data', 'all_conversations.jsonl');
  const fileContent = fs.readFileSync(inputPath, 'utf8');
  const lines = fileContent.split('\n').filter(l => l.trim().length > 0 && !l.startsWith('time='));

  const rawPairs: Array<{
    convId: string;
    phone: string;
    customerName: string | null;
    location: string | null;
    q: string;
    a: string;
  }> = [];

  for (const line of lines) {
    try {
      const conv: RawConversation = JSON.parse(line);
      conv.messages = (conv.messages || []).filter(m => m.content && m.content.trim().length > 0);
      conv.messages.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

      const locParts = [conv.kelurahan, conv.kecamatan, conv.kota].filter(Boolean);
      const locStr = locParts.length > 0 ? locParts.join(', ') : (conv.customer_name || null);

      let pendingQ: string[] = [];
      for (let i = 0; i < conv.messages.length; i++) {
        const m = conv.messages[i];
        if (m.direction === 'INBOUND') {
          pendingQ.push(m.content.trim());
        } else if (m.direction === 'OUTBOUND') {
          // 100% PURE HUMAN ADMIN ONLY! BOT DROPPED!
          const isHuman = m.sender_type === 'ADMIN' || m.sender_type === 'human';
          if (isHuman && pendingQ.length > 0) {
            const qText = pendingQ.join('\n');
            const aText = m.content.trim();
            rawPairs.push({
              convId: conv.conversation_id,
              phone: conv.phone,
              customerName: conv.customer_name,
              location: locStr,
              q: qText,
              a: aText,
            });
            pendingQ = [];
          } else if (!isHuman) {
            pendingQ = [];
          }
        }
      }
    } catch (e) {}
  }

  console.log(`Raw Human Pairs: ${rawPairs.length}`);

  let scheduleCount = 0;
  let thanksCount = 0;
  const filteredPairs: CuratedChatPair[] = [];
  let idCounter = 1;

  for (const item of rawPairs) {
    // 1. Filter: Hapus form/list reservasi
    if (isReservationForm(item.q) || isReservationForm(item.a)) {
      continue;
    }

    // 2. Filter: Hapus penginfoan ongkir
    if (isOngkirInfo(item.q) || isOngkirInfo(item.a)) {
      continue;
    }

    // 3. Filter: Noise
    if (isNoise(item.q, item.a)) {
      continue;
    }

    // 4. Filter Ketat Jadwal: Sisakan TEPAT 2 contoh untuk ketersediaan jadwal / "besok bisa"!
    const isSched = isScheduleInquiry(item.q, item.a);
    if (isSched) {
      if (scheduleCount >= 2) {
        continue;
      }
      scheduleCount++;
      filteredPairs.push({
        id: `HUMAN-${idCounter++}`,
        category: 'ketersediaan_jadwal_besok_bisa',
        customer_question: item.q,
        bidan_answer: item.a,
        customer_location: item.location || undefined,
      });
      continue;
    }

    // Lewatkan pesan yang isinya hanya konfirmasi form pendek ("sudah diisi bund", "data sudah saya kirim")
    if (/(?:sudah\s+(?:diisi|dikirim|transfer|tf|bayar)|mohon\s+bantu\s+isi|ini\s+datanya\s+ya\s+kak)/i.test(item.q) && /(?:terima\s*kasih|siap|baik|kami\s+jadwalkan)/i.test(item.a)) {
      continue;
    }

    const category = categorizePair(item.q, item.a);

    // Batasi terima kasih pendek maksimal 3 contoh
    if (category === 'ucapan_terima_kasih_dan_penutup') {
      if (thanksCount >= 3) {
        continue;
      }
      thanksCount++;
    }

    filteredPairs.push({
      id: `HUMAN-${idCounter++}`,
      category,
      customer_question: item.q,
      bidan_answer: item.a,
      customer_location: item.location || undefined,
    });
  }

  // Deduplicate
  const uniquePairs: CuratedChatPair[] = [];
  const seenKeys = new Set<string>();

  for (const p of filteredPairs) {
    const key = `${p.customer_question.toLowerCase().slice(0, 30)}|||${p.bidan_answer.toLowerCase().slice(0, 30)}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      uniquePairs.push(p);
    }
  }

  console.log(`Curated Clean Pairs: ${uniquePairs.length}`);

  const categoryCounts: Record<string, number> = {};
  for (const p of uniquePairs) {
    categoryCounts[p.category] = (categoryCounts[p.category] || 0) + 1;
  }
  for (const [cat, count] of Object.entries(categoryCounts)) {
    console.log(`- ${cat.padEnd(35)}: ${count}`);
  }

  // Save JSON
  const jsonPath = path.join(process.cwd(), 'data', 'bank_chat_curated_human.json');
  fs.writeFileSync(jsonPath, JSON.stringify(uniquePairs, null, 2), 'utf8');
  console.log(`\nSaved curated JSON to ${jsonPath}`);

  // Generate Clean Markdown
  generateMarkdown(uniquePairs, categoryCounts);
}

function generateMarkdown(pairs: CuratedChatPair[], counts: Record<string, number>) {
  const docPath = path.join(process.cwd(), 'docs', 'BANK_CONTOH_CHAT_BIDAN_YUSI.md');

  const titles: Record<string, string> = {
    'terapi_batuk_pilek_dan_kembung': '1. Terapi Batuk Pilek (Bapil), Flu, Dahak & Kembung',
    'perawatan_ibu_hamil_nifas_laktasi': '2. Perawatan Ibu (Hamil, Nifas, Laktasi & Oksitosin)',
    'newborn_selapan_cukur_tindik': '3. Bayi Baru Lahir (Newborn), Selapan, Cukur & Tindik',
    'pijat_bayi_relaksasi_dan_rewel': '4. Pijat Bayi Relaksasi & Rewel / Susah Tidur',
    'pijat_nafsu_makan_gtm': '5. Pijat Nafsu Makan (GTM)',
    'perawatan_anak_kids_spa': '6. Perawatan Anak (Kids Spa)',
    'layanan_tidak_tersedia': '7. Penolakan Santun untuk Layanan yang Belum Tersedia',
    'ketersediaan_jadwal_besok_bisa': '8. Pertanyaan Ketersediaan Jadwal "Besok Bisa" (Tepat 2 Contoh Terpilih)',
    'jam_layanan_dan_operasional': '9. Jam Layanan & Batas Jam Kunjungan',
    'konsep_homecare_dan_domisili': '10. Informasi Layanan Homecare & Tanya Domisili',
    'metode_pembayaran': '11. Metode Pembayaran',
    'kualifikasi_bidan_dan_str': '12. Kualifikasi Bidan & STR',
    'konsultasi_pasca_vaksin': '13. Konsultasi Pasca-Vaksinasi',
    'ucapan_terima_kasih_dan_penutup': '14. Sapaan Ramah & Ucapan Terima Kasih Singkat',
    'konsultasi_dan_edukasi_klinis': '15. Konsultasi & Edukasi Klinis Lainnya',
  };

  let md = `# 📚 Bank Contoh Chat Asli Bidan Yusi (100% Jawaban Manusia Asli)\n\n`;
  md += `Dokumen ini adalah **Bank Contoh Chat Murni** yang berisi percakapan nyata antara customer WhatsApp dengan **jawaban langsung dari Bidan Yusi / Admin manusia asli** di live server klinik.\n\n`;
  md += `### 🛡️ Standar Kurasi Ketat (Sesuai Arahan Pengguna):\n`;
  md += `1. **0% Pesan Bot:** Seluruh balasan bot otomatis telah **dihapus total**. Hanya respon murni manusia yang dipertahankan.\n`;
  md += `2. **Form / Template Reservasi Dihapus:** Draft formulir panjang dan isian form reservasi telah **dihapus total**.\n`;
  md += `3. **Penginfoan Ongkir Dihapus:** Tanya-jawab hitungan km dan nominal ongkir telah **dihapus** karena bersifat matematis repetitif.\n`;
  md += `4. **Pertanyaan Jadwal "Besok Bisa" Dibatasi Tepat 2:** Pertanyaan ketersediaan slot jadwal seperti *"besok bisa / ada slot?"* disaring ketat dan **hanya disisakan 2 contoh representatif** yang paling elegan.\n\n`;
  md += `---\n\n## 📊 Statistik Kategori Terkurasi (${pairs.length} Dialog Pilihan):\n\n`;

  for (const [key, title] of Object.entries(titles)) {
    const c = counts[key] || 0;
    if (c > 0) {
      md += `- **${title}**: ${c} dialog pilihan\n`;
    }
  }

  md += `\n---\n\n`;

  for (const [key, title] of Object.entries(titles)) {
    const list = pairs.filter(p => p.category === key);
    if (list.length === 0) continue;

    md += `## ${title}\n\n`;

    list.forEach((p, idx) => {
      const loc = p.customer_location ? ` *(Area/Pasien: ${p.customer_location})*` : '';
      md += `### Contoh ${idx + 1}${loc}\n`;
      md += `**Customer:**\n> "${p.customer_question.replace(/\n/g, '\n> ')}"\n\n`;
      md += `**Bidan Yusi (Asli):**\n> "${p.bidan_answer.replace(/\n/g, '\n> ')}"\n\n`;
    });

    md += `---\n\n`;
  }

  fs.writeFileSync(docPath, md, 'utf8');
  console.log(`Generated docs/BANK_CONTOH_CHAT_BIDAN_YUSI.md successfully with ${pairs.length} curated pure human examples!`);
}

main().catch(console.error);