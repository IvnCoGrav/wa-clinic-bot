import { wahaClient } from '../src/integrations/waha/client';
import axios from 'axios';
import * as dotenv from 'dotenv';

dotenv.config();

const targetChatId = '6285794210526@c.us';
const baseUrl = process.env.WAHA_BASE_URL || 'http://localhost:3001';
const apiKey = process.env.WAHA_API_KEY || 'my_waha_api_key_secret';
const session = process.env.WAHA_SESSION || 'default';

interface TestResult {
  iteration: number;
  addLatencyMs: number;
  addSuccess: boolean;
  postAddSessionStatus: string;
  labelVerifiedInStore: boolean;
  removeLatencyMs: number;
  removeSuccess: boolean;
  postRemoveSessionStatus: string;
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

async function verifyChatLabels(): Promise<string[]> {
  try {
    const res = await axios.get(`${baseUrl}/api/${session}/labels/chats/${targetChatId}`, {
      headers: { 'X-Api-Key': apiKey },
      timeout: 5000,
    });
    const list = res.data?.value || res.data || [];
    return list.map((l: any) => l.name);
  } catch (err: any) {
    return [];
  }
}

async function run30TestIterations() {
  console.log('=====================================================');
  console.log('🚀 MEMULAI STRESS TEST FITUR WAHA LABEL (30 ITERASI)');
  console.log(`Target Chat: ${targetChatId}`);
  console.log('=====================================================\n');

  const results: TestResult[] = [];

  // Verifikasi koneksi awal
  const initialStatus = await checkSessionStatus();
  console.log(`Status Koneksi Awal WAHA: [${initialStatus}]`);
  if (initialStatus !== 'WORKING') {
    console.error('❌ KONEKSI WAHA TIDAK WORKING! BATALKAN TEST.');
    process.exit(1);
  }

  for (let i = 1; i <= 30; i++) {
    console.log(`\n--- [ITERASI ${i}/30] ---`);
    const result: TestResult = {
      iteration: i,
      addLatencyMs: 0,
      addSuccess: false,
      postAddSessionStatus: 'UNKNOWN',
      labelVerifiedInStore: false,
      removeLatencyMs: 0,
      removeSuccess: false,
      postRemoveSessionStatus: 'UNKNOWN',
    };

    try {
      // 1. TAMBAH LABEL HOLD
      const startAdd = Date.now();
      const addOk = await wahaClient.addLabel(targetChatId, 'hold');
      result.addLatencyMs = Date.now() - startAdd;
      result.addSuccess = addOk;
      console.log(`1. addLabel('hold') -> ${addOk ? 'SUCCESS' : 'FAILED'} (${result.addLatencyMs}ms)`);

      // 2. CEK KONEKSI WHATSAPP SETELAH ADD
      result.postAddSessionStatus = await checkSessionStatus();
      console.log(`   Cek Koneksi WA -> Status: [${result.postAddSessionStatus}]`);

      // 3. VERIFIKASI STORE WAHA
      const currentLabels = await verifyChatLabels();
      result.labelVerifiedInStore = currentLabels.some(l => l.toLowerCase() === 'hold');
      console.log(`   Cek Store WAHA -> Label aktif: [${currentLabels.join(', ') || 'KOSONG'}] (Terverifikasi: ${result.labelVerifiedInStore})`);

      // Jeda singkat antar operasi
      await new Promise(r => setTimeout(r, 1000));

      // 4. HAPUS LABEL HOLD
      const startRemove = Date.now();
      const removeOk = await wahaClient.removeLabel(targetChatId, 'Hold');
      result.removeLatencyMs = Date.now() - startRemove;
      result.removeSuccess = removeOk;
      console.log(`2. removeLabel('Hold') -> ${removeOk ? 'SUCCESS' : 'FAILED'} (${result.removeLatencyMs}ms)`);

      // 5. CEK KONEKSI WHATSAPP SETELAH REMOVE
      result.postRemoveSessionStatus = await checkSessionStatus();
      console.log(`   Cek Koneksi WA -> Status: [${result.postRemoveSessionStatus}]`);

      // Jeda 1.5 detik antar iterasi untuk kestabilan socket
      await new Promise(r => setTimeout(r, 1500));

    } catch (err: any) {
      result.error = err.message;
      console.error(`❌ ERROR pada Iterasi ${i}:`, err.message);
    }

    results.push(result);

    // Jika koneksi terputus di tengah jalan, hentikan test dan laporkan
    if (result.postAddSessionStatus !== 'WORKING' || result.postRemoveSessionStatus !== 'WORKING') {
      console.error(`⚠️ KONEKSI TERPUTUS / FAILURE TERDETEKSI PADA ITERASI ${i}! Uji dicoba diberhentikan.`);
      break;
    }
  }

  // --- REKAPITULASI REPORT ---
  console.log('\n=====================================================');
  console.log('📊 REKAPITULASI STRESS TEST 30 ITERASI WAHA LABEL');
  console.log('=====================================================');

  const totalRuns = results.length;
  const addSuccesses = results.filter(r => r.addSuccess && r.labelVerifiedInStore).length;
  const removeSuccesses = results.filter(r => r.removeSuccess).length;
  const connectionFailures = results.filter(r => r.postAddSessionStatus !== 'WORKING' || r.postRemoveSessionStatus !== 'WORKING').length;

  const avgAddLatency = Math.round(results.reduce((acc, r) => acc + r.addLatencyMs, 0) / totalRuns);
  const avgRemoveLatency = Math.round(results.reduce((acc, r) => acc + r.removeLatencyMs, 0) / totalRuns);

  console.log(`Total Iterasi Dijalankan : ${totalRuns}/30`);
  console.log(`Sukses Pasang Label (Add): ${addSuccesses}/${totalRuns} (${Math.round((addSuccesses / totalRuns) * 100)}%)`);
  console.log(`Sukses Hapus Label (Del): ${removeSuccesses}/${totalRuns} (${Math.round((removeSuccesses / totalRuns) * 100)}%)`);
  console.log(`Insiden Koneksi Terputus : ${connectionFailures} kali`);
  console.log(`Rata-rata Waktu Add     : ${avgAddLatency} ms`);
  console.log(`Rata-rata Waktu Remove  : ${avgRemoveLatency} ms`);
  console.log('=====================================================\n');
}

run30TestIterations().catch(console.error);
