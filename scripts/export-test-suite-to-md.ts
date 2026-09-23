import fs from 'fs';
import path from 'path';

function buildMarkdown() {
  const fixturePath = path.join(process.cwd(), 'tests', 'fixtures', 'test-suite-v2.json');
  const targetPath = path.join(process.cwd(), 'docs', 'TEST_SUITE_V2_CASES.md');

  if (!fs.existsSync(fixturePath)) {
    console.error('Fixture not found:', fixturePath);
    process.exit(1);
  }

  const raw = fs.readFileSync(fixturePath, 'utf8');
  const suite = JSON.parse(raw);
  const cases: any[] = suite.cases || [];

  let md = '';
  md += `# 🧪 Test Suite V2 — 119 Kasus Lengkap (Dataset Pengujian Chatbot)\n\n`;
  md += `> Dokumen ini diekstrak langsung dari ground truth \`tests/fixtures/test-suite-v2.json\`.\n`;
  md += `> Total memuat **${cases.length} kasus pengujian** yang mencakup seluruh spektrum alur percakapan nyata, penanganan keluhan medis (Red Flag), komplain layanan (CX), serangan adversial (ADV), dan operasional (OPS).\n\n`;

  md += `## 📊 Ringkasan Distribusi Kasus\n\n`;
  md += `| Kategori | Kode | Jumlah Kasus | Deskripsi |\n`;
  md += `|---|---|---|---|\n`;
  md += `| **Alur Transkrip Nyata** | \`CASE-001\` s/d \`CASE-100\` | 100 Kasus | Transkrip percakapan nyata pelanggan anonim dari awal greeting hingga reservasi/closing. |\n`;
  md += `| **Red Flags Medis** | \`RF-01\` s/d \`RF-08\` | 8 Kasus | Tanda bahaya klinis (dehidrasi, demam tinggi, neonatus, kejang) yang wajib eskalasi/rujuk dokter. |\n`;
  md += `| **Customer Experience** | \`CX-01\` s/d \`CX-04\` | 4 Kasus | Penanganan komplain pelayanan, terapis telat, alamat nyasar, dan permintaan ganti jadwal. |\n`;
  md += `| **Adversarial Testing** | \`ADV-01\` s/d \`ADV-04\` | 4 Kasus | Permintaan di luar domain (obat kimia keras, suntik putih, pinjol, dsb.). |\n`;
  md += `| **Operasional & Kebijakan** | \`OPS-01\` s/d \`OPS-03\` | 3 Kasus | Pertanyaan metode pembayaran, sertifikasi Bidan (STR), jam operasional & jangkauan. |\n\n`;

  md += `## 🚀 Cara Menjalankan di Sistem Lokal / Mesin Lain\n\n`;
  md += `Dokumen ini berada di dalam repositori Git. Anda dapat membawanya ke komputer/server lain dengan cara:\n`;
  md += `1. **Via Git (Direkomendasikan)**:\n`;
  md += `   \`\`\`bash\n`;
  md += `   git add docs/TEST_SUITE_V2_CASES.md\n`;
  md += `   git commit -m "docs: export full 119 test cases of test suite v2"\n`;
  md += `   git push origin <branch-anda>\n`;
  md += `   # Di komputer lain:\n`;
  md += `   git pull origin <branch-anda>\n`;
  md += `   \`\`\`\n`;
  md += `2. **Menjalankan Seluruh Kasus (Mode Offline - Cepat & Deterministik)**:\n`;
  md += `   \`\`\`bash\n`;
  md += `   npm run test:suite            # Replay offline tanpa koneksi DB/LLM\n`;
  md += `   \`\`\`\n`;
  md += `3. **Menjalankan 1 Kasus Tertentu**:\n`;
  md += `   \`\`\`bash\n`;
  md += `   npx tsx scripts/run-test-plan.ts --suite=v2 --id=RF-01\n`;
  md += `   npx tsx scripts/run-test-plan.ts --suite=v2 --id=CASE-001\n`;
  md += `   \`\`\`\n\n`;

  md += `---\n\n`;
  md += `## 📑 Daftar Lengkap 119 Kasus Uji\n\n`;

  cases.forEach((c, idx) => {
    md += `### [${idx + 1}/${cases.length}] ${c.id}: ${c.flowCategory}\n\n`;
    md += `- **ID Kasus**: \`${c.id}\`\n`;
    md += `- **Prioritas**: \`${c.priority || 'NORMAL'}\`\n`;
    md += `- **Kategori Alur**: ${c.flowCategory}\n`;
    md += `- **Total Giliran (Turns)**: ${c.totalTurns || (c.customerDialogueFlow || []).length} putaran\n`;
    if (c.expected_behavior?.expected_final_state) {
      md += `- **Target State Akhir**: \`${c.expected_behavior.expected_final_state}\`\n`;
    }
    md += `- **Sasaran Pengujian (*Objective*)**:\n  > ${c.caseObjective}\n\n`;

    if (c.expected_behavior) {
      const eb = c.expected_behavior;
      md += `#### 🎯 Kontrak Perilaku yang Diharapkan (*Expected Behavior*):\n`;
      if (eb.expected_reservation_fields) {
        md += `- **Field Reservasi Kunci**: \`${JSON.stringify(eb.expected_reservation_fields)}\`\n`;
      }
      if (eb.expected_sop_compliance && eb.expected_sop_compliance.length > 0) {
        md += `- **Kepatuhan SOP Wajib**: ${eb.expected_sop_compliance.map((s: string) => `\`${s}\``).join(', ')}\n`;
      }
      if (eb.expected_tools_masked && eb.expected_tools_masked.length > 0) {
        md += `- **Tool yang Wajib Dibatasi (*Masked*)**: ${eb.expected_tools_masked.map((t: string) => `\`${t}\``).join(', ')}\n`;
      }
      if (eb.expected_total_price !== undefined) {
        md += `- **Ekspektasi Harga/Nominal**: ${eb.expected_total_price === null ? '*Tidak boleh ada nominal harga*' : `\`${eb.expected_total_price}\``}\n`;
      }
      md += `\n`;
    }

    if (c.paraphrases && c.paraphrases.length > 0) {
      md += `#### 🔀 Variasi Parafrase Pengguna (*Adversarial Phrasing*):\n`;
      c.paraphrases.forEach((p: string, pIdx: number) => {
        md += `${pIdx + 1}. *"${p}"*\n`;
      });
      md += `\n`;
    }

    md += `#### 💬 Alur Dialog Customer (*Customer Dialogue Flow*):\n\n`;
    const turns = c.customerDialogueFlow || [];
    if (turns.length === 0) {
      md += `*(Tidak ada langkah pesan customer)*\n\n`;
    } else {
      turns.forEach((t: string, tIdx: number) => {
        const cleaned = t.trim();
        if (cleaned.includes('\n')) {
          md += `${tIdx + 1}. **Turn ${tIdx + 1}**:\n   \`\`\`text\n   ${cleaned.split('\n').join('\n   ')}\n   \`\`\`\n`;
        } else {
          md += `${tIdx + 1}. **Turn ${tIdx + 1}**: "${cleaned}"\n`;
        }
      });
      md += `\n`;
    }

    md += `---\n\n`;
  });

  fs.writeFileSync(targetPath, md, 'utf8');
  console.log(`Berhasil mengekstrak ${cases.length} kasus ke: ${targetPath}`);
  console.log(`Ukuran file: ${(fs.statSync(targetPath).size / 1024).toFixed(1)} KB`);
}

buildMarkdown();
