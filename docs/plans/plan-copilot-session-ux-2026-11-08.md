# Implementation Plan — AI Copilot: Sesi 2 Hari, Reset, Indikator Status & UX Mobile

**Tanggal:** 2026-11-08
**Modul:** `packages/admin-dashboard` (AI Clinic Copilot) — **tanpa perubahan backend, tanpa database, tanpa dependency baru**
**Status:** MENUNGGU PERSETUJUAN MANUSIA (belum ada file kode yang diubah)

---

## 1. Tujuan yang diminta pengguna

1. **Sesi bertahan maksimal 2 hari** (48 jam) tanpa database.
2. **Tombol reset sesi** (hapus riwayat Copilot secara sadar, dengan konfirmasi).
3. **Pembeda status jelas**: `idle` / `sedang memproses` / `selesai`, **khususnya di mobile**, karena admin sering menutup panel tepat setelah mengirim perintah.

## 2. Temuan produksi yang mendasari plan ini

Sumber: query read-only ke `audit_logs`, `llm_audit_logs`, dan log app produksi 2026-11-08.

| Fakta | Angka | Implikasi desain |
|---|---|---|
| Turn Copilot | 101 turn, 3 admin, 27 Sep–8 Nov | Fitur dipakai nyata, bukan eksperimen |
| Waktu tunggu | p50 **18,8–19,4 dtk**, p90 **37 dtk**, maks **89 dtk** | Status `running` wajib terlihat walau panel ditutup |
| Panjang jawaban | p90 **611 token**, maks **921 token** | Panel 380×520 px butuh struktur, bukan teks bebas |
| Panjang daftar data | `query_followups` rata-rata **33 baris** (maks 60), `query_unscheduled_prospects` 20 | Daftar harus dipadatkan jadi baris + "Lihat semua" |
| Riwayat percakapan | `historyTurns = 0` pada **154/163** panggilan router | Fitur konteks percakapan praktis tidak terpakai → sesi 2 hari relevan |
| Jawaban tersimpan | **Tidak ada** (audit hanya simpan pertanyaan 200 karakter) | Tidak bisa audit UX pasca-kejadian → catat di KNOWN_ISSUES |
| Tautan rusak | 5 kejadian `COPILOT_LINK_UNREPAIRABLE` | Tautan tidak boleh diparse dari teks bebas |

**Kesimpulan arsitektural:** akar masalahnya bukan model, tetapi **kontrak prompt vs renderer**. Prompt mewajibkan "Header kelompok WAJIB jelas" (`src/services/copilot/copilot.service.ts:583`) dan link markdown inline (`:588`), sedangkan renderer dashboard hanya mengenal `**bold**` + link (`AdminCopilotPanel.tsx:50-93`) → `###` bocor ke layar dan tautan memecah kalimat.

## 3. Non-goals (tegas)

- Tidak menambah tabel/migrasi Prisma.
- Tidak mengubah endpoint backend atau prompt LLM.
- Tidak menyimpan riwayat jawaban di server (hanya di browser, 48 jam).
- Tidak membuat halaman baru (semua perubahan di komponen/drawer yang sudah ada).

## 4. Keputusan desain (default yang dipakai di plan ini)

| # | Keputusan | Default | Alasan |
|---|---|---|---|
| D1 | TTL sesi | **48 jam sliding** (diperbarui tiap turn) | "Maks 2 hari" dari permintaan; sliding lebih masuk akal untuk shift panjang |
| D2 | Media simpan | `localStorage` key `copilot:session:<tenantId>:<email>` | Tanpa DB; terisolasi per admin sehingga admin lain di PC yang sama tidak melihat riwayat |
| D3 | Ganti pasien | **Sesi TIDAK direset.** Tiap pesan menyimpan `contextCustomerId` saat dikirim; **riwayat yang dikirim ke LLM dipotong** di titik pergantian konteks pasien (tampilan tetap utuh). Chip header menunjukkan konteks aktif | Copilot 97% operasional (hanya 3/101 turn menyentuh data pasien), jadi reset sesi salah sasaran. Pemotongan konteks mencegah model mencampur "pasien ini" antar pasien, tanpa menghapus riwayat yang dilihat admin |
| D4 | Pemilik state | `CopilotContext` (sudah di level `App`) | Turn tetap hidup saat panel ditutup / admin pindah halaman |
| D5 | Mobile | **Bottom sheet** `85dvh` + scrim + safe-area; desktop tetap kartu melayang | Jangkauan jempol, keyboard (`dvh`), dan kejelasan modal. Kartu 70vh tanpa scrim = setengah modal setengah bebas |
| D6 | Renderer | Parser blok deterministik → heading/baris, **maks 8 baris** + "Lihat semua (N)"; daftar >20 baris diberi pintasan ke halaman tabel | 8×44px masih muat tanpa scroll di 667px; daftar 33–60 baris adalah tugas tabel, bukan bubble chat |
| D7 | Konstanta | Diekspor dari satu modul, bukan tersebar | Lihat §9 catatan SaaS-readiness |

---

## 5. FASE 0 — Fondasi murni (tanpa UI, tanpa risiko)

**Tujuan:** semua logika sesi, parser jawaban, dan badge menjadi fungsi murni yang teruji offline.

### T0.1 Buat `packages/admin-dashboard/src/utils/copilotSessionStore.ts`

Kontrak:

```ts
export interface CopilotSessionMessage {
  role: 'user' | 'assistant';
  content: string;
  toolsUsed?: string[];
  grounded?: boolean;
  summaryMeta?: { elapsedSec: number; toolsCount: number; rowsTotal: number };
  /** true = placeholder yang tidak pernah selesai (browser ditutup di tengah turn). */
  interrupted?: boolean;
}

export interface CopilotSessionV1 {
  version: 1;
  savedAt: number;
  expiresAt: number;              // savedAt + TTL (sliding)
  contextCustomerId: string | null;
  messages: CopilotSessionMessage[];
}

export const COPILOT_SESSION_TTL_MS = 48 * 60 * 60 * 1000; // 48 jam = maks 2 hari
export const COPILOT_MAX_MESSAGES = 60;                   // 30 turn
export const COPILOT_MAX_CHARS_PER_MESSAGE = 4000;

export interface KVAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function copilotSessionKey(tenantId: string, adminEmail: string): string;
export function pruneMessages(messages: CopilotSessionMessage[]): CopilotSessionMessage[];
export function markInterrupted(messages: CopilotSessionMessage[]): CopilotSessionMessage[];
export function readCopilotSession(store: KVAdapter, key: string, now?: number): CopilotSessionV1 | null;
export function writeCopilotSession(store: KVAdapter, key: string, session: CopilotSessionV1, now?: number): boolean;
export function createCopilotSession(contextCustomerId: string | null, now?: number): CopilotSessionV1;
/** Riwayat yang dikirim ke LLM: hanya pesan sejak konteks pasien terakhir berubah. */
export function sliceHistoryForContext<T extends { contextCustomerId?: string | null }>(
  messages: T[],
  currentCustomerId: string | null
): T[];
```

Aturan wajib (semua harus punya test):

| Aturan | Perilaku |
|---|---|
| TTL | `now > expiresAt` → `removeItem` + return `null` |
| Sliding | `writeCopilotSession` selalu menulis ulang `savedAt`/`expiresAt = now + TTL` |
| Pemangkasan | Simpan maksimal 60 pesan terakhir; tiap `content` dipotong 4.000 karakter (indikator "…" ditambahkan) |
| Data rusak | `JSON.parse` gagal / versi ≠ 1 / `messages` bukan array → buang, return `null` |
| Kuota penuh | `setItem` melempar → tangkap, coba `removeItem` lalu tulis ulang sekali; kalau gagal lagi return `false` (UI tidak crash) |
| Placeholder tergantung | `role: 'assistant'` dengan `content.trim() === ''` → `interrupted: true`, `content: 'Jawaban terputus sebelum selesai. Silakan tanya ulang.'` |
| PII minimal | Hanya `content`, `toolsUsed`, `grounded`, `summaryMeta` yang disimpan (payload tool mentah tidak pernah disimpan) |

### T0.2 Buat `packages/admin-dashboard/src/utils/copilotAnswerParser.ts`

```ts
export type CopilotBlock =
  | { type: 'heading'; text: string }
  | { type: 'row'; name: string; status: string; detail?: string; conversationId?: string }
  | { type: 'list'; text: string; conversationId?: string }
  | { type: 'paragraph'; text: string };

export const COPILOT_MAX_VISIBLE_ROWS = 8;
export function parseCopilotAnswer(answer: string): CopilotBlock[];
export function splitInlineLink(text: string): { text: string; conversationId?: string };
```

Aturan parsing (deterministik, **tidak memutilasi teks** — hanya mengklasifikasi blok):

1. Normalisasi `\r\n` → `\n`, buang baris kosong berlebih.
2. Baris `^#{2,4}\s+` → `heading`, tanda `#` dibuang, emoji di awal dipertahankan sebagai teks biasa.
3. Baris `^\s*(?:[-*]|\d+\.)\s+` → kandidat `row` **jika** mengandung tepat satu `[Buka Chat](/admin/live-chat?conversationId=X)` **dan** ada pemisah `—` / `·`; jika tidak → `list`.
4. `name` = segmen sebelum pemisah pertama; `status` = segmen kedua; `detail` = sisanya (boleh kosong). Nama tidak boleh kosong; jika kosong → turunkan ke `list`.
5. Tautan non-`/admin/live-chat` **tidak** diekstrak menjadi `conversationId` (anti open-redirect); tetap `list`/`paragraph`.
6. Baris lain → `paragraph` (teks utuh, tidak pernah dibuang).
7. Idempoten: `parseCopilotAnswer(x)` dua kali tidak mengubah hasil.
8. Fallback aman: input kosong / bukan string → `[]`; bila total blok 0 tetapi `answer` tidak kosong → satu `paragraph` berisi teks asli.

### T0.3 Perluas `packages/admin-dashboard/src/utils/copilotStatus.ts`

Tambahkan (tanpa mengubah fungsi lama):

```ts
export type CopilotRunStatus = 'idle' | 'running' | 'done' | 'error';

export interface CopilotBadge {
  kind: 'none' | 'spinner' | 'dot' | 'warn';
  label: string;   // untuk aria-label
}

export function resolveCopilotBadge(input: {
  status: CopilotRunStatus;
  hasUnread: boolean;
  panelOpen: boolean;
}): CopilotBadge;
```

Matriks (harus diuji):

| status | hasUnread | panelOpen | hasil |
|---|---|---|---|
| idle | – | – | `none` |
| running | – | – | `spinner` |
| done | true | false | `dot` |
| done | true | true | `none` (sudah dibaca) |
| done | false | – | `none` |
| error | – | – | `warn` |

### T0.4 Buat `packages/admin-dashboard/src/services/copilotStreamClient.ts`

Ekstrak transport dari panel agar bisa diuji:

```ts
export function parseSseFrames(buffer: string): { events: Array<{ event: string; data: string }>; rest: string };
export interface CopilotStreamHandlers {
  onStage?(payload: any): void;
  onToolStart?(payload: any): void;
  onToolResult?(payload: any): void;
  onChunk?(payload: any): void;
  onDone?(payload: any): void;
}
export async function streamCopilotTurn(args: {
  message: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  conversationId?: string;
  customerId?: string;
  signal: AbortSignal;
  handlers: CopilotStreamHandlers;
}): Promise<{ answer: string; toolsUsed: string[]; grounded?: boolean; rowsTotal: number }>;
```

Aturan: buffer diproses per `\n\n`, frame rusak diabaikan (bukan crash), event tak dikenal diabaikan, `AbortError` diteruskan ke pemanggil.

### T0.5 Test (root `tests/unit/`, node env, offline)

| File | Kasus wajib (adversarial) |
|---|---|
| `tests/unit/copilot-session-store.test.ts` | TTL 47j59m valid; 48j01m → `null` + item terhapus; sliding memperbarui `expiresAt`; prune 100→60; potong 10.000 char→4.000; JSON rusak; `version: 2`; `messages: "x"`; adapter `setItem` melempar (return `false`); placeholder kosong → `interrupted`; `sliceHistoryForContext`: semua konteks sama → riwayat utuh, konteks berubah di tengah → hanya pesan setelah titik perubahan, `customerId = null` → hanya pesan tanpa konteks, array kosong → kosong |
| `tests/unit/copilot-answer-parser.test.ts` | `### 🟠 Perlu Tindak Lanjut` → heading tanpa `#`; `1. Bunda X — menunggu ~3,7 hari · [Buka Chat](...)` → row lengkap; bullet tanpa link → list; link eksternal → tidak diekstrak; dua link dalam satu baris (hanya yang kanonis pertama menjadi `conversationId`, sisanya tetap teks); CRLF; string kosong; 5.000 char satu baris; idempoten |
| `tests/unit/copilot-badge.test.ts` | Seluruh 6 baris matriks T0.3 |
| `tests/unit/copilot-stream-client.test.ts` | Satu frame terpotong dua chunk → hanya diproses setelah `\n\n`; frame `: keepalive` diabaikan; `data:` tidak valid JSON diabaikan; event `tool_result` menghitung `rowsTotal` |

**Acceptance Fase 0:** 4 file test hijau, `npm run build` root exit 0 (util tidak diimport UI dulu, jadi aman).
**Regression gate:** `npx vitest run tests/unit/copilot-session-store.test.ts tests/unit/copilot-answer-parser.test.ts tests/unit/copilot-badge.test.ts tests/unit/copilot-stream-client.test.ts` + `npx vitest run tests/unit/copilot-status.test.ts`.

---

## 6. FASE 1 — Pindahkan mesin sesi ke `CopilotContext` + persist 48 jam + reset

**Tujuan:** sesi & status hidup di level App, bukan di panel. Panel ditutup / admin pindah halaman → turn tetap berjalan dan status terbaca.

### T1.1 Buat `packages/admin-dashboard/src/contexts/copilot/useCopilotSession.ts`

Isi hook (mesin state, tanpa JSX):

```ts
export interface CopilotSessionState {
  messages: CopilotSessionMessage[];
  status: 'idle' | 'running' | 'done' | 'error';
  hasUnread: boolean;
  error: string | null;
  elapsedMs: number;
  stage: string | null;
  step: { step: number; maxSteps: number } | null;
  rowsFound: number;
  contextCustomerId: string | null;   // pasien saat pesan terakhir dikirim
}

export function useCopilotSession(args: {
  tenantId: string;
  adminEmail: string;
  getPanelVisible: () => boolean;     // open && document.visibilityState === 'visible'
}): CopilotSessionState & {
  send(text: string, ctx: { conversationId?: string | null; customerId?: string | null }): Promise<void>;
  cancel(): void;
  reset(): void;
  markRead(): void;
};
```

Micro-tasks:

1. Ambil kunci dari `copilotSessionKey(tenantId, adminEmail)`; `readCopilotSession` saat mount (lazy `useState` initializer) → `markInterrupted` bila ada placeholder.
2. `send(text, ctx)`:
   - guard `status === 'running'` (anti double-send),
   - history = `sliceHistoryForContext(messages, ctx.customerId ?? null)` (maks 60, sudah dipangkas),
   - append user + placeholder assistant,
   - `status = 'running'`, timer `elapsedMs` berbasis timestamp (pola yang sudah ada di panel baris 132-143),
   - panggil `streamCopilotTurn`; event mengisi stage/step/rows,
   - `finally`: `status = 'done'`, `hasUnread = !getPanelVisible()`, tulis sesi ke localStorage (sliding TTL).
   - Fallback non-streaming `POST /api/admin/copilot/chat` (timeout 305000) **dipertahankan apa adanya** — pola panel baris 285-326.
3. `cancel()`: abort controller, isi placeholder dengan "Pencarian dibatalkan oleh pengguna.", `status = 'done'`, tulis sesi.
4. `reset()`: `removeItem` + state kosong + `hasUnread = false` + `status = 'idle'`.
5. `markRead()`: `hasUnread = false`; dipanggil saat panel dibuka.
6. Listener `storage` (event browser) → bila `key` cocok dan `status === 'idle'` → rehidrasi (dua tab admin yang sama). Jika `running`, abaikan (last-write-wins, diterima sebagai batasan).
7. Semua akses storage dibungkus `try/catch` — mode private / kuota penuh tidak boleh mematikan panel.

### T1.2 Ubah `packages/admin-dashboard/src/contexts/CopilotContext.tsx`

- Tambahkan ke `CopilotContextValue` (baris 16-27): `session`, `send`, `cancel`, `reset`, `markRead`, `setContext`, `context`.
- Di provider (baris 40-98): panggil `useCopilotSession({ tenantId: user?.tenantId ?? 'default-tenant', adminEmail: user?.email ?? 'anon', getPanelVisible: () => open && document.visibilityState === 'visible' })`.
- `setOpen(true)` → `markRead()` (panggil setelah `setOpenState`).
- Jangan mengubah kontrak `mobileMenuOpen`/`openMobileMenu`/`dismissMobileMenu`.

### T1.3 Ubah `packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx`

Tambahkan satu `useEffect` tepat setelah `const selectedChat = chats.find(...)` (baris 376):

```tsx
const { setContext: setCopilotContext } = useCopilot();
useEffect(() => {
  setCopilotContext({
    conversationId: selectedChat?.conversationId ?? null,
    customerId: selectedChat?.customerId ?? null,
  });
}, [selectedChat?.conversationId, selectedChat?.customerId, setCopilotContext]);
```

(Impor `useEffect` sudah ada; `useCopilot` sudah dipanggil di baris 352 — cukup tambahkan `setContext` ke destructuring yang ada.)

### T1.4 Ubah `packages/admin-dashboard/src/components/copilot/AdminCopilotPanel.tsx`

Hapus dari panel: `messages`, `loading`, `elapsedMs`, `streamStage`, `stepInfo`, `rowsFound`, `startedAtRef`, `abortControllerRef`, `runStreaming`, `send`, `cancelTurn` (baris 100-333) → ganti dengan pembacaan context:

```tsx
const { open, setOpen, session, send, cancel, reset, context } = useCopilot();
```

Panel menjadi presentasional (±200 baris). Perilaku yang **wajib dipertahankan**: fallback non-stream, `aria-live`, tombol Batal, ringkasan meta per jawaban.

### T1.5 Sesi tidak direset saat ganti pasien (D3 revisi)

**Bukan reset.** Copilot ini 97% dipakai untuk pertanyaan operasional, jadi mereset sesi saat admin berpindah chat akan menghapus konteks yang masih berguna. Yang dilakukan:

1. **Stempel konteks per pesan**: setiap pesan (user & assistant) menyimpan `contextCustomerId` = `customerId` aktif **saat pesan dikirim**.
2. **Pemotongan riwayat yang dikirim ke LLM** (deterministik, berbasis state — bukan analisis teks):

```ts
/** Riwayat yang dikirim ke server: hanya pesan sejak konteks pasien terakhir berubah. */
export function sliceHistoryForContext<T extends { contextCustomerId: string | null }>(
  messages: T[],
  currentCustomerId: string | null
): T[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].contextCustomerId !== currentCustomerId) return messages.slice(i + 1);
  }
  return messages;
}
```

   Konsekuensi yang diterima: bila admin berpindah pasien, pertanyaan lanjutan yang sangat bergantung pada obrolan sebelumnya (mis. "kalau bulan ini?") kehilangan konteks. Ini disengaja demi mencegah jawaban tercampur antar pasien. Data menunjukkan dampaknya kecil: hanya **9 dari 163** panggilan LLM yang membawa riwayat.
3. **Chip header** selalu menampilkan konteks yang sedang aktif: `Konteks: <nama pasien>` atau `Tanpa konteks pasien`. Bila konteks berubah dibanding jawaban terakhir yang terlihat, tampilkan penanda tipis `Konteks berpindah` (informasi, bukan reset).
4. **Tombol reset manual** tetap ada: ikon `RotateCcw` di header, memakai `confirm({...})` dari `useUiFeedback` — dilarang `window.confirm`. Isi konfirmasi: "Hapus riwayat chat Copilot di perangkat ini?".

**Acceptance Fase 1:**
1. Kirim pertanyaan → tutup panel → buka lagi: jawaban tetap ada, `status` sudah `done`.
2. Kirim pertanyaan → pindah ke halaman Overview → kembali: jawaban tetap ada (tidak hilang).
3. Refresh halaman: riwayat kembali (dari localStorage), timestamp `savedAt` bertambah tiap turn.
4. Ubah `expiresAt` di DevTools ke masa lalu → refresh → riwayat kosong & key terhapus.
5. Reset → konfirmasi → riwayat kosong, key hilang, `status = idle`.
6. Dua tab: kirim di tab A saat tab B idle → tab B ikut memperbarui.
7. Ganti pasien lalu tanya "dia sudah bayar?": riwayat tampil utuh, tetapi payload ke server tidak memuat pesan pasien sebelumnya (verifikasi di tab Network).

**Regression gate:** `cd packages/admin-dashboard && npm run build` (0 error) + `npm run build` di root + seluruh test Fase 0 hijau.

---

## 7. FASE 2 — Indikator status (badge + pill), khusus mobile

**Tujuan:** admin tahu "sedang proses / selesai" **tanpa** harus membuka panel.

### T2.1 Buat `packages/admin-dashboard/src/components/copilot/CopilotStatusPill.tsx`

- Tampil hanya bila `!panelOpen` dan (`status === 'running'` atau `hasUnread` atau `status === 'error'`).
- running: `⏳ Copilot memproses… {formatElapsedSeconds(elapsedMs)}`
- done+unread: `✅ Jawaban siap` (otomatis hilang setelah 8 detik, badge tetap ada sampai panel dibuka)
- error: `⚠️ Copilot gagal — coba lagi`
- Klik → `setOpen(true)`.
- Posisi: `fixed right-4 z-40 bottom-[calc(6rem+env(safe-area-inset-bottom))]`, tinggi ≥44px, `role="status"`, `aria-live="polite"`.
- Hormati `prefers-reduced-motion` (pulse dimatikan).

### T2.2 Pasang badge di dua pemicu

1. `packages/admin-dashboard/src/components/common/Layout.tsx` blok tombol baris 915-930 → sisipkan `<span>` indikator di dalam tombol:
   - `spinner`: `absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full border-2 border-accent border-t-transparent animate-spin`
   - `dot`: `absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-danger`
   - `warn`: `bg-warning`
   - `aria-label` mengikuti `resolveCopilotBadge(...).label`.
2. `packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx` blok tombol baris 4621-4636 → logika badge identik (kedua tombol membaca satu sumber dari context, tidak ada state duplikat).

### T2.3 Render pill

Di `LiveChatMonitor.tsx` tepat sebelum `<AdminCopilotPanel ... />` (baris 8123): `<CopilotStatusPill />`.

**Acceptance Fase 2:**
1. Kirim pertanyaan di HP → tutup panel → pill "Copilot memproses… 0:12" muncul dan detiknya berjalan.
2. Saat selesai → pill berubah "Jawaban siap", badge titik muncul di tombol Copilot.
3. Buka panel → badge & pill hilang.
4. Batal → pill hilang, tidak ada badge tersisa.
5. Tombol tetap ≥44px dan badge tidak menutupi ikon.

**Regression gate:** dashboard build + cek manual 375×667 dan 360×800 (panel tertutup & terbuka).

---

## 8. FASE 3 — Panel jadi bottom sheet + tipografi + target sentuh

### T3.1 Shell panel (mobile) — `AdminCopilotPanel.tsx` baris 339-355 & 470-472

Ganti struktur return menjadi:

```tsx
{open && (
  <>
    <div className="fixed inset-0 z-30 bg-black/30 backdrop-blur-[2px] sm:hidden" onClick={() => setOpen(false)} aria-hidden="true" />
    <div
      id="copilot-panel"
      role="dialog"
      aria-modal="true"
      aria-label="AI Clinic Copilot"
      className="fixed inset-x-0 bottom-0 z-40 flex h-[85dvh] flex-col overflow-hidden rounded-t-2xl border-t border-divider bg-surface shadow-lg
                 sm:inset-auto sm:bottom-24 sm:right-4 sm:h-[min(70vh,520px)] sm:w-[380px] sm:rounded-2xl sm:border"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {/* drag handle (mobile saja) */}
      <div className="flex justify-center pt-2 sm:hidden" onTouchStart={...} onTouchEnd={...}>
        <span className="h-1 w-10 rounded-full bg-divider" />
      </div>
      ...
```

Micro-tasks:
1. `vh` → `dvh` (mencegah terpotong saat keyboard muncul).
2. Swipe-down: `onTouchStart` menyimpan `clientY`, `onTouchEnd` menutup bila delta > 80px (tanpa dependency).
3. Esc menutup: `useEffect` listener `keydown`.
4. `overscroll-contain` pada area pesan.

### T3.2 Tipografi & target sentuh

| Elemen | Sekarang | Target |
|---|---|---|
| Bubble pesan | `text-[12px]` (baris 381) | `text-sm` (14px) + `leading-relaxed` |
| Meta jawaban | `text-[9px]` (baris 389) | `text-[11px]` |
| Input | `text-[12px]` (baris 458) | `text-base sm:text-sm` (16px di mobile → anti auto-zoom iOS) |
| Tombol Kirim | `w-9 h-9` (464) | `min-h-[44px] min-w-[44px]` |
| Tombol Tutup | `p-1.5` + ikon 14 (350) | `min-h-[44px] min-w-[44px]` |
| Tombol Batal | `text-[10px] py-0.5` (429) | `min-h-[44px] px-3` (teks 12px) |
| Quick prompt | `px-2.5 py-1.5` (369) | `min-h-[44px]` |

### T3.3 Header kontekstual

Sisipkan di header (setelah judul baris 344-346), sebelum tombol reset:
- Chip pasien: `context.customerId ? <span class="...">Konteks: {namaPasien || 'pasien aktif'}</span> : null`.
  Nama pasien diambil dari prop `customerId` yang sudah ada — **jangan** menambah request baru; cukup kirim `patientName` opsional dari `LiveChatMonitor` (`selectedChat?.customerName`) sebagai prop tambahan ke panel.
- Chip `Konteks berbeda` (T1.5) bila perlu.
- Tombol reset (T1.5) + tombol tutup.

**Acceptance Fase 3:**
1. Di 360×800 & 375×667: panel menempel ke bawah, sudut atas membulat, ada scrim, tidak ada celah aneh di bawah (safe-area).
2. Fokus input di iOS: halaman **tidak** auto-zoom.
3. Keyboard terbuka: area pesan menyusut, input tetap terlihat.
4. Semua tombol terukur ≥44×44 px (cek DevTools).
5. Swipe-down >80px menutup; Esc menutup; scrim diklik menutup.
6. Desktop (≥640px) tetap kartu melayang di kanan bawah.

**Regression gate:** dashboard build + uji manual di 2 ukuran HP + desktop.

---

## 9. FASE 4 — Renderer jawaban: heading & baris

### T4.1 Buat `packages/admin-dashboard/src/components/copilot/CopilotAnswer.tsx`

- Pakai `parseCopilotAnswer` (T0.2).
- `heading` → `<div className="text-[11px] font-bold uppercase tracking-wide text-ink-2 mt-2">`
- `row` → satu baris 44px, seluruh baris dapat diklik (bila ada `conversationId`):
  `Nama · status · detail` + `ChevronRight`; `onClick` → `openLiveChat('/admin/live-chat?conversationId=…')` (fungsi `openLiveChat` yang sudah ada di panel baris 113-121).
- `list`/`paragraph` → teks dengan bold inline (`**x**`) tetap didukung.
- Render maksimal `COPILOT_MAX_VISIBLE_ROWS` (8) baris; sisanya di balik tombol `Lihat semua (N)` (state lokal `expanded`).
- Baris dipotong dengan `truncate` (satu baris), judul lengkap tetap tersedia lewat `title` — bukan dipotong di tengah kalimat.

### T4.3 Pintasan untuk daftar panjang (D6)

- Buat peta deterministik di `copilotAnswerParser.ts`:

```ts
export const COPILOT_TOOL_PAGE: Record<string, { path: string; label: string }> = {
  query_followups:               { path: '/admin/follow-ups',   label: 'Buka halaman Follow-up' },
  query_reservations_by_filter:  { path: '/admin/reservations', label: 'Buka halaman Reservasi' },
  query_stalled_inquiries:       { path: '/admin/reservations', label: 'Buka halaman Reservasi' },
  query_unscheduled_prospects:   { path: '/admin/reservations', label: 'Buka halaman Reservasi' },
  query_unreplied_chats:         { path: '/admin/live-chat',    label: 'Buka Live Chat' },
};
```

- Tampilkan tombol pintasan **hanya bila** `totalRows > 20` dan tool jawaban itu ada di peta. Alasan: daftar 33–60 baris adalah tugas tabel, bukan bubble chat.
- Peta ini konstanta navigasi UI (bukan data bisnis), tidak memuat nama layanan/harga/SOP.

### T4.2 Ganti `RichMessage` (baris 58-93) dengan `CopilotAnswer`

- Hapus `INLINE_RE` dan `RichMessage`; pastikan tidak ada pemanggil lain (`rg "RichMessage" packages/admin-dashboard/src` harus kosong).
- Tautan eksternal tetap dirender sebagai `<a rel="noopener noreferrer" target="_blank">`.

**Acceptance Fase 4:**
1. `### 🟠 Perlu Tindak Lanjut — Tunggu > 5 Jam` tampil sebagai label seksi **tanpa** karakter `#`.
2. Daftar 11 baris (kasus produksi 8 Nov) menampilkan **8 baris** + "Lihat semua (11)".
3. Klik baris → pindah ke Live Chat percakapan yang benar (`sessionStorage['liveChat:selectedId']` terisi).
4. Jawaban tanpa tanda markdown apa pun tetap tampil utuh (tidak ada teks hilang).
5. Jawaban 33 baris (`query_followups`) menampilkan 8 baris + "Lihat semua (33)" + pintasan "Buka halaman Follow-up".
6. `rg '###' packages/admin-dashboard/src` tidak menemukan renderer yang membocorkan tanda pagar.

**Regression gate:** dashboard build + test parser (Fase 0) + uji manual dengan jawaban produksi yang sudah ada di screenshot.

---

## 10. FASE 5 — Verifikasi menyeluruh & dokumentasi

### T5.1 Build & test

```powershell
cd packages/admin-dashboard; npm run build; cd ..\..
npm run build
npx vitest run tests/unit/copilot-session-store.test.ts tests/unit/copilot-answer-parser.test.ts tests/unit/copilot-badge.test.ts tests/unit/copilot-stream-client.test.ts tests/unit/copilot-status.test.ts
npm test
```

Aturan kegagalan (sesuai AGENTS.md): kegagalan yang diklaim *pre-existing* **wajib dibuktikan** dengan revert-and-rerun pada file yang gagal. Baseline saat ini: ±16 kegagalan pre-existing di 9 file (lihat CHANGELOG 2026-11-04). Tidak boleh ada **file kegagalan baru**.

### T5.2 Uji manual (checklist deploy)

| # | Skenario | Ekspektasi |
|---|---|---|
| 1 | Kirim → tutup panel → tunggu | Pill hitung detik; badge spinner |
| 2 | Selesai saat panel tertutup | Pill "Jawaban siap"; badge titik |
| 3 | Tutup tab, buka lagi <48 jam | Riwayat kembali |
| 4 | `expiresAt` dimundurkan | Riwayat kosong |
| 5 | Reset sesi | Konfirmasi modal; riwayat kosong |
| 6 | Ganti pasien setelah bertanya | Chip "Konteks berbeda" + tombol sesi baru |
| 7 | Ganti tab browser (2 tab) | Tab idle ikut sinkron |
| 8 | Kirim saat running | Input terkunci (tidak ada 429) |
| 9 | Jawaban 33 baris (`query_followups`) | 8 baris + Lihat semua (33) + pintasan halaman Follow-up |
| 10 | iOS Safari fokus input | Tidak auto-zoom |

### T5.3 Dokumentasi wajib

1. `CHANGELOG.md` — satu entri tanggal dengan ringkasan fitur + angka validasi produksi.
2. `docs/FEATURE_INVENTORY.md` — perbarui baris "AI Copilot Analitik & Streaming": tambahkan sesi 2 hari, reset, badge status, renderer baris.
3. `docs/KNOWN_ISSUES.md` — catat 3 batasan yang **diterima** (bukan bug tersembunyi):
   - Riwayat Copilot 48 jam tersimpan plaintext di `localStorage` browser (PC klinik dipakai bergantian) — mitigasi: TTL, reset, batas 60 pesan, tidak menyimpan payload tool.
   - Transkrip jawaban tidak tersimpan di server → keluhan UX tidak dapat diaudit pasca-kejadian.
   - TTL/konstanta UI belum per-tenant; bila kelak perlu beda per tenant → `Tenant.settings.copilot.sessionTtlHours` + endpoint settings (butuh migrasi).
4. Regenerasi `docs/changelog/INDEX.md` bila script tersedia.

---

## 11. Estimasi & urutan

| Fase | Isi | File disentuh | Estimasi |
|---|---|---|---|
| 0 | Util murni + 4 test | 4 baru + 4 test | 3–4 jam |
| 1 | Mesin sesi ke context + persist + reset | `CopilotContext.tsx`, `useCopilotSession.ts`, `AdminCopilotPanel.tsx`, `LiveChatMonitor.tsx` | 4–5 jam |
| 2 | Badge + pill | `CopilotStatusPill.tsx`, `Layout.tsx`, `LiveChatMonitor.tsx` | 2 jam |
| 3 | Bottom sheet + tipografi + header | `AdminCopilotPanel.tsx` | 2–3 jam |
| 4 | Renderer heading/baris | `CopilotAnswer.tsx`, `AdminCopilotPanel.tsx` | 2–3 jam |
| 5 | Verifikasi + docs | `CHANGELOG.md`, `FEATURE_INVENTORY.md`, `KNOWN_ISSUES.md` | 1–2 jam |

**Total ±14–19 jam kerja.** Setiap fase berdiri sendiri dan bisa dideploy terpisah; urutan tidak boleh ditukar (Fase 2 bergantung pada Fase 1; Fase 4 memakai parser Fase 0).

## 12. Risiko & rollback

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Refactor mesin ke context memutus alur streaming | Jawaban tidak muncul | Fase 1 wajib mempertahankan fallback non-stream + diuji manual sebelum Fase 2 |
| `localStorage` penuh / diblokir (mode private) | Sesi tidak tersimpan | Semua akses dibungkus `try/catch`; panel tetap berfungsi dalam memori |
| Dua tab menulis bersamaan | Riwayat tertimpa | Diterima (last-write-wins); sinkron hanya saat idle |
| Parser salah klasifikasi baris | Teks hilang | Aturan fallback: blok 0 tapi teks ada → satu `paragraph`; test idempoten + teks 5.000 char |
| Bottom sheet menutupi elemen lain | Admin tidak bisa menekan tombol di belakang | Scrim menangkap klik; tombol tutup 44px + swipe + Esc |

**Rollback:** hanya file `packages/admin-dashboard` — `git revert` commit fase terkait lalu `npm run build` di dashboard dan restart container `app`. Tidak ada migrasi DB, tidak ada perubahan env, tidak menyentuh WAHA.

## 13. Keputusan yang sudah dikonfirmasi (2026-11-08)

| # | Keputusan | Status |
|---|---|---|
| 1 | TTL **48 jam sliding** | ✅ dikonfirmasi pengguna |
| 2 | **Sesi tidak direset** saat ganti pasien — hanya pemotongan konteks riwayat yang dikirim ke LLM + chip konteks di header | ✅ dikonfirmasi pengguna (Copilot 97% operasional) |
| 3 | Mobile **bottom sheet 85dvh + scrim**, desktop tetap kartu melayang | ✅ rekomendasi disetujui arahnya |
| 4 | Daftar: **8 baris** + "Lihat semua (N)" + pintasan halaman tabel bila >20 baris | ✅ rekomendasi disetujui arahnya |
| 5 | Jawaban **tidak disimpan di server** | ✅ dikonfirmasi pengguna |

**Sisa gerbang (wajib sebelum kode disentuh):** perintah eksekusi eksplisit dari pengguna, mis. "setuju, mulai Fase 0". Setelah itu eksekusi berjalan fase-per-fase dan **berhenti di setiap gerbang regresi** sebelum lanjut.
