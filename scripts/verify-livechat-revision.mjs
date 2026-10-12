/**
 * Verifikasi revisi unsticky LiveChat mobile (state-based, tanpa hafalan kalimat user).
 * Menegaskan gerbang kode deterministik, bukan teks prompt:
 *  1. Header global hidden di mobile livechat (true ikut-scroll), sticky z-40 di desktop/halaman lain.
 *  2. Searchbar sticky top-0 z-20 penuh (keputusan user: search tetap sticky).
 *  3. Banner AI-off + sync + error: desktop-only di luar scroll + duplikat lg:hidden di dalam scroll.
 *  4. Loading branch: banner mobile AI-off ikut tampil.
 *  5. Tombol ☰ + copilot di Mobile Page Header via useCopilot (openMobileMenu/setCopilotOpen).
 *  6. Ke-4 situs Aktifkan AI konsisten via handler tunggal handleToggleGlobalBot + confirm + disabled.
 *  7. Larangan label WAHA: tidak ada addLabel/removeLabel.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const layout = readFileSync(join(root, 'packages/admin-dashboard/src/components/common/Layout.tsx'), 'utf8');
const live = readFileSync(join(root, 'packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx'), 'utf8');
const copilotCtx = readFileSync(join(root, 'packages/admin-dashboard/src/contexts/CopilotContext.tsx'), 'utf8');

let fails = 0;
const check = (name, cond, hint = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${cond ? '' : ` :: ${hint}`}`);
  if (!cond) fails++;
};

// 1. Header global
check('header hidden mobile livechat + sticky desktop', layout.includes("'hidden lg:block lg:sticky lg:top-0 z-40'"), 'Layout.tsx header class');
check('header z-40 dipertahankan semua viewport', /hidden lg:block lg:sticky lg:top-0 z-40.*sticky top-0 z-40/s.test(layout), 'z-40 hilang di salah satu cabang');
check('tidak ada lg:z-40 (z-40 hilang mobile)', !layout.includes('lg:z-40'), 'masih ada lg:z-40');

// 2. Search tetap sticky penuh
check('search sticky top-0 z-20 penuh', live.includes('sticky top-0 z-20 bg-white py-1.5'), 'searchbar class');
check('tidak ada lg:sticky search tersisa', !live.includes('lg:sticky lg:top-0 lg:z-20'), 'search masih lg:sticky');

// 3. Banner: desktop-only di luar + duplikat mobile di dalam
for (const [name, marker] of [['AI-off', 'CHATBOT AI NONAKTIF'], ['AI-off mobile', 'AI NONAKTIF'], ['sync bg', 'Sinkronisasi Background Berjalan'], ['sync mobile', 'Sync:</span>'], ['error mobile', null]]) {
  void marker;
}
check('banner AI global desktop-only', live.includes('hidden lg:flex p-2 sm:p-2.5 rounded-xl bg-amber-50'), 'banner AI global');
check('banner sync global desktop-only', live.includes('hidden lg:flex p-2 sm:p-2.5 rounded-xl bg-emerald-50'), 'banner sync global');
check('banner sky global desktop-only', live.includes('hidden lg:flex p-2 rounded-xl bg-sky-50'), 'banner sky global');
check('banner error global desktop-only', live.includes('hidden lg:flex p-2 rounded-xl bg-rose-50'), 'banner error global');
check(
  'duplikat mobile sync+error di dalam scroll',
  live.includes('Mobile Sync/Error Warnings') && (live.match(/lg:hidden mb-1\.5 p-2 rounded-xl bg-emerald-50/g) || []).length >= 1 && (live.match(/lg:hidden mb-1\.5 p-2 rounded-xl bg-rose-50/g) || []).length >= 1,
  'duplikat lg:hidden sync/error',
);

// 4. Loading branch banner mobile
check('loading branch banner AI-off mobile', live.includes('Loading: banner AI-off mobile ikut tampil'), 'loading branch');

// 5. Tombol ☰ + copilot via context
check('context sediakan openMobileMenu+dismiss', copilotCtx.includes('openMobileMenu') && copilotCtx.includes('dismissMobileMenu'), 'CopilotContext');
check('Mobile Page Header pakai openMobileMenu', live.includes('onClick={openMobileMenu}'), 'tombol menu in-scroll');
check('Mobile Page Header toggle copilot', live.includes('setCopilotOpen(!copilotOpen)'), 'tombol copilot in-scroll');
check('menu history-push di context', copilotCtx.includes("pushState({ modal: 'mobile-menu' }"), 'history push');
check('Layout pakai context (tanpa useState lokal menu)', !/const \[mobileMenuOpen, setMobileMenuOpen\] = useState/.test(layout), 'useState lokal tersisa');

// 6. Handler tunggal Aktifkan AI + confirm + disabled konsisten
const toggleSites = (live.match(/onClick=\{\(\) => handleToggleGlobalBot\(true\)\}/g) || []).length;
check('4 situs Aktifkan AI via handler tunggal', toggleSites === 4, `ditemukan ${toggleSites}, harap 4 (global+list+loading+chat-header)`);
check('confirm() dipakai di toggle', /const handleToggleGlobalBot[\s\S]{0,400}confirm\(/.test(live), 'confirm di handler');
check('disabled konsisten di semua situs', (live.match(/disabled=\{togglingBotCutoff\}/g) || []).length >= 4, 'disabled count');

// 7. Larangan label WAHA + guardrail state-based
check('tanpa addLabel/removeLabel', !live.includes('addLabel') && !live.includes('removeLabel'), 'label WAHA tersentuh');
check('tanpa if-else hafalan kalimat user', !/msg\.includes\(["']kuota|includes\(["']bunda["']\)/i.test(live.slice(0, 200000)), 'hafalan kalimat');

console.log(fails === 0 ? '\nSEMUA CEK LOLOS' : `\n${fails} CEK GAGAL`);
process.exit(fails === 0 ? 0 : 1);
