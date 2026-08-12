import { wahaClient } from '../src/integrations/waha/client';

async function run() {
  const groupJids = (process.env.ESCALATION_GROUP_JID || '120363428465130209@g.us,120363428393473712@g.us')
    .split(',')
    .map(j => j.trim())
    .filter(Boolean);

  const text = `🚨 *ALERT ESKALASI CS (KLINIK KALA)*

• *Pelanggan*: Bunda Yusi (+62 857-9421-0526)
• *Status Bot*: HUMAN_HANDLING
• *Alasan*: Customer bertanya jadwal spesifik ("Senin bisa nggak ya")
• *Waktu*: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}

👉 *Klik untuk Balas Pelanggan*:
https://wa.me/6285794210526`;

  for (const gJid of groupJids) {
    console.log('Sending alert message to group:', gJid);
    const ok = await wahaClient.sendText(gJid, text);
    console.log(`Send result for ${gJid}:`, ok);
  }
}

run().catch(console.error);
