import { wahaHistorySyncService } from '../services/waha-history-sync.service';

/**
 * CLI: npm run sync:history [--limit=50] [--offset=0] [--messages=100]
 * Backfill history chat dari WAHA ke DB bot (idempoten, bisa diulang).
 */
async function main() {
  const args = process.argv.slice(2);
  const parseArg = (name: string, def: number): number => {
    const raw = args.find((a) => a.startsWith(`--${name}=`));
    if (!raw) return def;
    const val = parseInt(raw.split('=')[1], 10);
    return isNaN(val) ? def : val;
  };

  const limit = parseArg('limit', 50);
  const offset = parseArg('offset', 0);
  const messages = parseArg('messages', 100);

  console.log(`[SYNC WAHA HISTORY] batch limit=${limit} offset=${offset} messagesPerChat=${messages}`);
  const result = await wahaHistorySyncService.syncChats(limit, offset, messages);

  if (!result.success) {
    console.error('[SYNC WAHA HISTORY] Gagal:', result.error);
    process.exit(1);
  }

  console.log(`[SYNC WAHA HISTORY] Selesai.`);
  console.log(`  Chat diproses : ${result.syncedChats} (skip ${result.skippedChats}) dari total ${result.totalChats}`);
  console.log(`  Pesan baru    : ${result.syncedMessages}`);
  console.log(`  Lanjut offset : ${result.nextOffset} | hasMore=${result.hasMore}`);
  if (result.hasMore) {
    console.log(`\nJalankan batch berikutnya: npm run sync:history -- --offset=${result.nextOffset}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('[SYNC WAHA HISTORY] Fatal:', err.message);
  process.exit(1);
});
