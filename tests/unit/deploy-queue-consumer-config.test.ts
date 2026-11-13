import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Insiden 2026-11-13: `SEPARATE_WORKER=true` dipasang di app DAN worker.
 * Karena flag itu dulu juga mematikan konsumen chat, tidak ada proses yang
 * mengonsumsi antrean → 421 pesan menumpuk berhari-hari.
 *
 * Gerbang ini mengunci kontrak compose:
 *  - app   : SEPARATE_WORKER=true (skip cron) TANPA CHAT_CONSUMER_ENABLED=false
 *  - worker: SEPARATE_WORKER=true + CHAT_CONSUMER_ENABLED=false (produsen cron)
 */
const ROOT = process.cwd();
const composePath = path.join(ROOT, 'docker-compose.yml');

function serviceBlock(lines: string[], name: string): string[] {
  const start = lines.findIndex((l) => l.trim() === `${name}:`);
  if (start < 0) throw new Error(`service ${name} tidak ditemukan`);
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    // Service baru: indentasi 2 spasi diakhiri ':'
    if (/^ {2}[a-zA-Z0-9_-]+:\s*$/.test(line)) break;
    out.push(line);
  }
  return out;
}

describe('Kontrak compose: konsumen chat hanya di container app', () => {
  const lines = fs.readFileSync(composePath, 'utf8').split(/\r?\n/);
  const app = serviceBlock(lines, 'app').join('\n');
  const worker = serviceBlock(lines, 'worker').join('\n');

  it('app melewati cron tetapi tetap menjadi konsumen chat', () => {
    expect(app).toMatch(/SEPARATE_WORKER=true/);
    expect(app).not.toMatch(/CHAT_CONSUMER_ENABLED=false/);
  });

  it('worker adalah produsen cron dan bukan konsumen chat', () => {
    expect(worker).toMatch(/SEPARATE_WORKER=true/);
    expect(worker).toMatch(/CHAT_CONSUMER_ENABLED=false/);
  });
});
