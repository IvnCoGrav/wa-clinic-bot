import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * F7 / M17-13-WATCHDOG — token Telegram tidak boleh muncul di argv (terlihat
 * lewat `ps`), config tidak boleh di-`source` mentah, dan parser .env tidak boleh
 * memakai `xargs`/`export $(...)`.
 */

const ROOT = path.resolve(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf-8');

describe('F7 — keamanan token watchdog & parser env', () => {
  const watchdog = read('scripts/server-watchdog.sh');
  const installer = read('scripts/install-server-watchdog.sh');
  const backup = read('scripts/backup.sh');

  it('token tidak pernah dirangkai ke URL di baris perintah', () => {
    // Pola berbahaya: "$API_URL/bot$WATCHDOG_BOT_TOKEN/sendMessage" sebagai argv curl.
    expect(watchdog).not.toMatch(/\/bot\$WATCHDOG_BOT_TOKEN\//);
    expect(installer).not.toMatch(/\/bot\$BOT_TOKEN\//);
    expect(watchdog).not.toMatch(/\$API_URL\/bot\$\{?WATCHDOG_BOT_TOKEN/);
  });

  it('mengirim token via config curl dari file (mode privat), bukan argv', () => {
    expect(watchdog).toContain('mktemp');
    expect(watchdog).toContain('chmod 600 "$cfg"');
    expect(watchdog).toContain('-K "$cfg"');
    expect(watchdog).toContain('text@$textfile');
    expect(installer).toContain('-K "$CFG_FILE"');
  });

  it('tidak memakai `set -a; source` untuk config/state', () => {
    expect(watchdog).not.toMatch(/set -a\s*\n\s*source/);
    expect(watchdog).toContain('parse_kv_file');
    expect(watchdog).not.toMatch(/^\s*source "\$CONFIG_FILE"/m);
    expect(watchdog).not.toMatch(/^\s*source "\$STATE_FILE"/m);
  });

  it('watchdog memaksa umask privat', () => {
    expect(watchdog).toMatch(/^umask 077$/m);
    expect(installer).toMatch(/^umask 077$/m);
  });

  it('backup.sh tidak memakai parser .env berbahaya (export $(... xargs))', () => {
    expect(backup).not.toContain('export $(');
    expect(backup).not.toMatch(/grep -v '\^#' \.env \| xargs/);
    expect(backup).toContain("sed -n 's/^DATABASE_URL=//p' .env");
  });

  it('state watchdog tetap kompatibel dengan format KEY=VALUE', () => {
    expect(watchdog).toContain(
      "printf 'STATE=%s\\nCONSEC=%s\\nDOWN_SINCE=%s\\nLAST_ALERT=%s\\n'"
    );
    expect(watchdog).toContain('parse_kv_file "$STATE_FILE" STATE CONSEC DOWN_SINCE LAST_ALERT');
  });
});
