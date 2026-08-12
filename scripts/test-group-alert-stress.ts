import { wahaClient } from '../src/integrations/waha/client';
import axios from 'axios';
import * as dotenv from 'dotenv';

dotenv.config();

const groupJid = process.env.ESCALATION_GROUP_JID || '120363412163204240@g.us';
const baseUrl = process.env.WAHA_BASE_URL || 'http://localhost:3001';
const apiKey = process.env.WAHA_API_KEY || 'my_waha_api_key_secret';
const session = process.env.WAHA_SESSION || 'default';

interface TestResult {
  iteration: number;
  sendLatencyMs: number;
  sendSuccess: boolean;
  postSendSessionStatus: string;
  error?: string;
}

async function checkSessionStatus(): Promise<string> {
  try {
    const res = await axios.get(`${baseUrl}/api/sessions/${session}`, {
      headers: { 'X-Api-Key': apiKey },
      timeout: 5000,
    });
    return res.data?.status || 'UNKNOWN';
  } catch (err: any) {
    return `ERROR: ${err.message}`;
  }
}

async function runGroupAlertStressTest() {
  console.log('================================================================');
  console.log('🚀 MEMULAI STRESS TEST FITUR WA GROUP ALERT ESKALASI (10 ITERASI)');
  console.log(`Target Group JID: ${groupJid}`);
  console.log('================================================================\n');

  const results: TestResult[] = [];

  // Verifikasi koneksi awal
  const initialStatus = await checkSessionStatus();
  console.log(`Status Koneksi Awal WAHA: [${initialStatus}]`);
  if (initialStatus !== 'WORKING') {
    console.error('❌ KONEKSI WAHA TIDAK WORKING! BATALKAN TEST.');
    process.exit(1);
  }

  for (let i = 1; i <= 10; i++) {
    console.log(`\n--- [ITERASI ${i}/10] ---`);
    const result: TestResult = {
      iteration: i,
      sendLatencyMs: 0,
      sendSuccess: false,
      postSendSessionStatus: 'UNKNOWN',
    };

    try {
      const timeStr = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
      const alertText = `🚨 *[TEST #${i}] ALERT ESKALASI CS (KLINIK KALA)*\n\n• *Pelanggan*: Bunda Yusi (+62 857-9421-0526)\n• *Status Bot*: HUMAN_HANDLING\n• *Alasan*: Customer bertanya jadwal spesifik ("Senin bisa nggak ya")\n• *Waktu*: ${timeStr}\n\n👉 *Klik untuk Balas Pelanggan*:\nhttps://wa.me/6285794210526`;

      // 1. KIRIM NOTIFIKASI ALERT KE GROUP WA
      const startSend = Date.now();
      const sendOk = await wahaClient.sendText(groupJid, alertText);
      result.sendLatencyMs = Date.now() - startSend;
      result.sendSuccess = sendOk;
      console.log(`1. sendText(GroupAlert) -> ${sendOk ? 'SUCCESS' : 'FAILED'} (${result.sendLatencyMs}ms)`);

      // 2. WAJIB CEK KONEKSI WHATSAPP SETELAH PENGIRIMAN
      result.postSendSessionStatus = await checkSessionStatus();
      console.log(`   Cek Koneksi WA -> Status: [${result.postSendSessionStatus}]`);

      // Jeda 2 detik antar iterasi untuk kestabilan socket
      await new Promise(r => setTimeout(r, 2000));

    } catch (err: any) {
      result.error = err.message;
      console.error(`❌ ERROR pada Iterasi ${i}:`, err.message);
    }

    results.push(result);

    // Jika koneksi terputus di tengah jalan, hentikan test dan laporkan
    if (result.postSendSessionStatus !== 'WORKING') {
      console.error(`⚠️ KONEKSI TERPUTUS / FAILURE TERDETEKSI PADA ITERASI ${i}! Uji dicoba diberhentikan.`);
      break;
    }
  }

  // --- REKAPITULASI REPORT ---
  console.log('\n================================================================');
  console.log('📊 REKAPITULASI STRESS TEST FITUR WA GROUP ALERT ESKALASI');
  console.log('================================================================');

  const totalRuns = results.length;
  const successes = results.filter(r => r.sendSuccess).length;
  const connectionFailures = results.filter(r => r.postSendSessionStatus !== 'WORKING').length;
  const avgLatency = Math.round(results.reduce((acc, r) => acc + r.sendLatencyMs, 0) / totalRuns);

  console.log(`Total Iterasi Dijalankan : ${totalRuns}/10`);
  console.log(`Sukses Kirim Notif Group : ${successes}/${totalRuns} (${Math.round((successes / totalRuns) * 100)}%)`);
  console.log(`Insiden Koneksi Terputus : ${connectionFailures} kali`);
  console.log(`Rata-rata Waktu Kirim    : ${avgLatency} ms`);
  console.log('================================================================\n');
}

runGroupAlertStressTest().catch(console.error);
