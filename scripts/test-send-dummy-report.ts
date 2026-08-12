import { wahaClient } from '../src/integrations/waha/client';

async function sendDummyDailyReport() {
  const dailyGroupJid = process.env.DAILY_REPORT_GROUP_JID || '120363428393473712@g.us';

  const reportDateStr = new Date().toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Jakarta'
  });

  const dummyReport = `📊 *Laporan Harian Operasional — Klinik Kala Spa*
*Tanggal*: ${reportDateStr}

💰 *Sales & Konversi*
- Reservasi Confirmed: *14 Reservasi*
- Total Omzet: *Rp 4.850.000*
- Customer Baru: *9 Pasien*
- Repeat Order: *5 Pasien*

💬 *Chat & Engagement*
- Percakapan Baru: *28 Chat*
- Pesan Masuk: *142 Pesan*
- Pesan Keluar: *138 Pesan*

🎯 *Atribusi Iklan (Meta Ads)*
- Klik Masuk: *45 Klik*
- Konversi ke Reservasi: *11 Reservasi (24.4% CR)*

🚨 *Kesehatan Operasional*
- Eskalasi Medis (High): *1* _(Diarahkan Konsul Spesialis)_
- Eskalasi Medis (Medium): *2*
- Medis Masih Pending: *0*
- Eskalasi Non-Medis (Jadwal/Lokasi): *3*
- Antrian Staging (Medis/Umum): *0 / 0*

🧠 *Insight AI*
- Ringkasan: _Layanan terfavorit hari ini: Pijat Bayi & Baby Spa (60%) dan Treatment Postpartum Bidan (30%). Pertanyaan jangkauan lokasi Surabaya Barat & Sidoarjo dijawab 100% presisi._
- Top Lokasi: *Surabaya Barat (6), Sidoarjo Kota (4), Rungkut (3)*
- Out of Coverage: *1 (Gresik - Diarahkan ke Layanan Custom Homecare)*

🔍 [Buka Control Panel](http://localhost:3000/admin) untuk detail lengkap operasional.`;

  console.log(`🚀 Sending DUMMY Daily Operational Report to WA Group Kala Rekap (${dailyGroupJid})...`);
  
  // Humanizer typing simulation
  await wahaClient.sendSeen(dailyGroupJid).catch(() => {});
  console.log('⏳ Simulasi mengetik natural (2 detik)...');
  await new Promise(r => setTimeout(r, 2000));

  const ok = await wahaClient.sendText(dailyGroupJid, dummyReport);
  console.log('✅ Status pengiriman report dummy:', ok ? 'SUCCESS' : 'FAILED');
}

sendDummyDailyReport().catch(console.error);
