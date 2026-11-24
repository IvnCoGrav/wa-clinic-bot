/**
 * Guard statis untuk perbaikan viewport Live Chat iOS (#370).
 *
 * Bukan pengganti uji perangkat: kontrak ini hanya memastikan pola kode
 * (kompensasi visual viewport + container-only scroll) tidak hilang saat refactor.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

const layout = read('packages/admin-dashboard/src/components/common/Layout.tsx');
const composer = read('packages/admin-dashboard/src/components/livechat/LiveChatComposer.tsx');
const thread = read('packages/admin-dashboard/src/hooks/useLiveChatActiveThread.ts');
const quoted = read('packages/admin-dashboard/src/components/livechat/LiveChatQuotedPreview.tsx');
const pane = read('packages/admin-dashboard/src/components/livechat/LiveChatMessagePane.tsx');

let fails = 0;
const check = (name, cond, hint = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} - ${name}${cond ? '' : ` :: ${hint}`}`);
  if (!cond) fails++;
};

check(
  'Layout menyimpan pageTop ke --vvt',
  layout.includes("setProperty('--vvt'"),
  'Layout.tsx visualViewport pageTop',
);
check(
  'Shell Live Chat memakai top: var(--vvt)',
  layout.includes("top: isLiveChat ? 'var(--vvt, 0px)'"),
  'Layout.tsx shell top',
);
check(
  'Layout memperbarui --vvt saat window scroll (Live Chat)',
  layout.includes("window.addEventListener('scroll', updateVvtOnScroll"),
  'Layout.tsx window scroll listener',
);
check(
  'Composer tidak memanggil window.scrollTo saat fokus',
  !composer.includes('window.scrollTo(0, 0)'),
  'LiveChatComposer.tsx onFocus',
);
check(
  'scrollToBottom tidak memakai messagesEndRef.scrollIntoView',
  !thread.includes('messagesEndRef.current.scrollIntoView'),
  'useLiveChatActiveThread.ts scrollToBottom',
);
check(
  'scrollToMessage memakai container-only helper',
  thread.includes('centerElementInScrollContainer'),
  'useLiveChatActiveThread.ts scrollToMessage',
);
check(
  'Quoted preview tidak memakai scrollIntoView',
  !quoted.includes('scrollIntoView'),
  'LiveChatQuotedPreview.tsx',
);
check(
  'Container pesan memiliki data-chat-scroll-container',
  pane.includes('data-chat-scroll-container="true"'),
  'LiveChatMessagePane.tsx',
);

if (fails > 0) {
  console.error(`\n${fails} check gagal.`);
  process.exit(1);
}
console.log('\nSemua check Live Chat viewport lulus.');
