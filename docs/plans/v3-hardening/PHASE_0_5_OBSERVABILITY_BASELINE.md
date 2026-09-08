# PHASE 0.5: OBSERVABILITY BASELINE (METRIK BIAYA & TOOL CALL RATE)

> **Estimasi Total:** 2–4 Hari Kerja  
> **Prasyarat:** Phase 0 selesai. Wajib selesai SEBELUM Phase 1 dimulai.  
> **Tujuan Strategis:** Mengukur kondisi awal (*baseline metric*) performa, biaya token, dan tingkat pemanggilan tool sebelum algoritma *Forced Tool-Calling* diterapkan di Phase 1. Tanpa baseline ini, kita tidak dapat memvalidasi apakah pengerasan guardrail membuat sistem lebih lambat atau boros token.

---

## 🔹 MIKRO-TASK 0.5.1 — Persistensi Metadata V3 ke Record Message (ID: A3-04)

### 1. Masalah & Lokasi Kode
Di `src/state-machine/machine.ts` baris 422–453:
`V3AgentRunner.processMessage(...)` mengembalikan `AgentRunnerOutput` yang kaya metadata:
- `tokens`: `{ prompt: number, completion: number, total: number }`
- `costIdr`: `number`
- `executedTools`: `Array<{ name: string, args: any, result: any }>`
- `reasoning`: `string | null`
- `retrievedChunks`: `V3RetrievedChunk[]`

Namun, di `src/state-machine/machine.ts` dan fungsi outbound pesan, data ini **dibuang** dan hanya mengambil `replyText` dan `nextState`. Kolom `payload_raw` (tipe `Json?`) di tabel `messages` tidak pernah diisi metadata eksekusi V3.

### 2. Modifikasi: `src/state-machine/machine.ts`
Perbarui baris 446–455 untuk meloloskan metadata V3 ke objek `result`:

```typescript
// SEBELUM (Baris 446-453):
result = {
  nextState: v3Result.isEscalated
    ? ConversationState.HUMAN_HANDLING
    : (v3Result.nextState || activeConversation.current_state),
  replyText: v3Result.replyText,
  shouldSendReply: v3Result.shouldSendReply && !!v3Result.replyText,
  isHumanHandling: v3Result.isEscalated,
};

// SESUDAH:
result = {
  nextState: v3Result.isEscalated
    ? ConversationState.HUMAN_HANDLING
    : (v3Result.nextState || activeConversation.current_state),
  replyText: v3Result.replyText,
  shouldSendReply: v3Result.shouldSendReply && !!v3Result.replyText,
  isHumanHandling: v3Result.isEscalated,
  metadata: {
    engine: 'V3_AGENT',
    tokens: v3Result.tokens,
    costIdr: v3Result.costIdr,
    executedTools: (v3Result.executedTools || []).map((t) => ({ name: t.name, args: t.args })),
    toolCount: (v3Result.executedTools || []).length,
    reasoning: v3Result.reasoning,
    retrievedChunksCount: (v3Result.retrievedChunks || []).length,
  },
};
```

### 3. Modifikasi: `src/services/queue.service.ts`
Pada saat `queueService` mencatat pesan OUTBOUND bot ke database (`messageService.logMessage`), sertakan `metadata` tersebut ke kolom `payload_raw`:

Di `src/services/queue.service.ts` cari pemanggilan `messageService.logMessage` untuk balasan bot (sekitar baris 330–360):
```typescript
await messageService.logMessage({
  tenantId: ctx.tenantId,
  conversationId: ctx.conversation.id,
  direction: 'OUTBOUND',
  content: result.replyText,
  senderType: 'BOT',
  senderName: 'Bidan Yusi (V3)',
  payloadRaw: (result as any).metadata ? { v3Execution: (result as any).metadata } : undefined,
});
```

### 4. Acceptance Test & Verifikasi
Kirim 1 pesan via CLI simulator (`npm run chat`) atau skrip simulasi. Periksa isi record database:
```sql
SELECT id, direction, content, payload_raw 
FROM messages 
WHERE direction = 'OUTBOUND' 
ORDER BY created_at DESC 
LIMIT 1;
```
**Kriteria Lolos:** Kolom `payload_raw` memuat JSON valid dengan struktur:
`{"v3Execution":{"engine":"V3_AGENT","tokens":{"total":...},"costIdr":...,"executedTools":[...]}}`.

---

## 🔹 MIKRO-TASK 0.5.2 — Pembuatan Skrip Baseline Performance & Cost Dashboard

### 1. Masalah
Saat ini tidak ada laporan terpadu untuk melihat:
- Berapa % pesan yang memicu tool-calling (`tool_call_rate`).
- Berapa rata-rata biaya Rupiah per turn balasan (`avg_cost_per_turn`).
- Berapa rata-rata token per turn.

### 2. File Baru: `src/scripts/measure-v3-baseline.ts`
Buat skrip evaluasi baseline metrik yang dapat dijalankan secara berkala:

```typescript
/**
 * src/scripts/measure-v3-baseline.ts
 * Mengukur metrik baseline V3: Tool Call Rate, Token Usage, dan Cost per Turn.
 * Jalankan: npx tsx src/scripts/measure-v3-baseline.ts --days=7
 */

import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';

async function runBaselineMeasurement() {
  const args = process.argv.slice(2);
  const daysArg = args.find((a) => a.startsWith('--days='));
  const days = daysArg ? parseInt(daysArg.split('=')[1], 10) : 7;
  const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  console.log(`\n📊 [V3 BASELINE AUDIT] Menganalisa log pesan ${days} hari terakhir (sejak ${sinceDate.toISOString()})...\n`);

  try {
    const outboundMessages = await prisma.message.findMany({
      where: {
        tenant_id: DEFAULT_TENANT_ID,
        direction: 'OUTBOUND',
        created_at: { gte: sinceDate },
      },
      select: {
        id: true,
        created_at: true,
        payload_raw: true,
      },
    });

    const v3Messages = outboundMessages.filter((m) => {
      const p: any = m.payload_raw;
      return p && p.v3Execution;
    });

    if (v3Messages.length === 0) {
      console.log('⚠️ Belum ditemukan pesan dengan metadata v3Execution di database.');
      console.log('Pastikan Task 0.5.1 sudah aktif di lingkungan pengujian sebelum menjalankan pengukuran.');
      return;
    }

    let totalTokens = 0;
    let totalCostIdr = 0;
    let turnsWithTools = 0;
    const toolFrequency: Record<string, number> = {};

    for (const msg of v3Messages) {
      const meta = (msg.payload_raw as any).v3Execution;
      const tokens = meta.tokens?.total || 0;
      const cost = meta.costIdr || 0;
      const tools: Array<{ name: string }> = meta.executedTools || [];

      totalTokens += tokens;
      totalCostIdr += cost;

      if (tools.length > 0) {
        turnsWithTools++;
        for (const t of tools) {
          toolFrequency[t.name] = (toolFrequency[t.name] || 0) + 1;
        }
      }
    }

    const totalTurns = v3Messages.length;
    const toolCallRate = ((turnsWithTools / totalTurns) * 100).toFixed(1);
    const avgTokens = (totalTokens / totalTurns).toFixed(0);
    const avgCostIdr = (totalCostIdr / totalTurns).toFixed(2);

    console.log('====================================================');
    console.log('📈 RINGKASAN METRIK BASELINE V3 AGENT');
    console.log('====================================================');
    console.log(`Total Turn Dianalisa      : ${totalTurns}`);
    console.log(`Tool-Call Rate (% Turn)   : ${toolCallRate}% (${turnsWithTools}/${totalTurns})`);
    console.log(`Rata-Rata Token / Turn    : ${avgTokens} tokens`);
    console.log(`Rata-Rata Biaya / Turn    : Rp ${avgCostIdr}`);
    console.log('----------------------------------------------------');
    console.log('Distribusi Pemanggilan Tool:');
    for (const [toolName, count] of Object.entries(toolFrequency)) {
      console.log(`  • ${toolName.padEnd(25)} : ${count}x (${((count / totalTurns) * 100).toFixed(1)}%)`);
    }
    console.log('====================================================\n');
  } catch (err: any) {
    console.error('Gagal menjalankan audit baseline:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

void runBaselineMeasurement();
```

### 3. Acceptance Test & Verifikasi
1. Jalankan `npm run chat` untuk menghasilkan minimal 3 percakapan simulasi (pertanyaan harga, ongkir, dan sapaan).
2. Jalankan skrip baseline:
   ```bash
   npx tsx src/scripts/measure-v3-baseline.ts --days=1
   ```
3. **Kriteria Lolos:** Skrip mencetak tabel ringkasan metrik (Total Turn, Tool-Call Rate, Rata-Rata Token, Rata-Rata Biaya) ke terminal tanpa runtime error. Angka baseline dicatat di changelog atau dokumentasi internal tim.

---

## 📋 Checklist Validasi Phase 0.5
- [ ] Task 0.5.1 selesai: metadata `tokens`, `costIdr`, dan `executedTools` tersimpan di `payload_raw` record `messages`.
- [ ] Task 0.5.2 selesai: skrip `measure-v3-baseline.ts` berhasil mengeksekusi audit metrik.
- [ ] Angka baseline "Before" tercatat resmi sebelum memulai Phase 1.
