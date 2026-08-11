import axios from 'axios';
import dotenv from 'dotenv';
import { normalizeWhatsAppFormat } from '../../utils/whatsapp-format';
import {
  getCachedLabels,
  setCachedLabels,
  invalidateCachedLabels,
  getCachedLidPhone,
  setCachedLidPhone,
} from './label-cache';
dotenv.config();

export interface WahaChat {
  id: string;
  name?: string;
  unreadCount?: number;
}

export interface WahaContact {
  id: string;
  pushname?: string;
}

export interface WahaMessage {
  id: string;
  body: string;
  from: string;
  fromMe: boolean;
  timestamp: number;
  type: string;
}

export interface WahaQr {
  mimetype: string;
  data: string;
}

/**
 * PNG 1x1 transparan (base64) — dipakai sebagai QR deterministik saat WAHA_MOCK aktif,
 * agar UI/flow koneksi bisa diuji tanpa WAHA asli.
 */
export const MOCK_QR_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

export interface IWahaClient {
  sendSeen(chatId: string, messageId?: string): Promise<boolean>;
  startTyping(chatId: string): Promise<boolean>;
  stopTyping(chatId: string): Promise<boolean>;
  sendText(chatId: string, text: string): Promise<boolean>;
  sendImage(chatId: string, url: string, caption?: string): Promise<boolean>;
  addLabel(chatId: string, labelName: string): Promise<boolean>;
  removeLabel(chatId: string, labelName: string): Promise<boolean>;
  getChatLabels(chatId: string): Promise<string[]>;
  getChatLabelsOrNull(chatId: string): Promise<string[] | null>;

  getSessionStatus(session?: string): Promise<string>;
  startSession(session?: string): Promise<string>;
  stopSession(session?: string): Promise<boolean>;
  getAuthQr(session?: string): Promise<WahaQr | null>;
  getSession(session?: string): Promise<any | null>;
  deleteSession(session?: string): Promise<boolean>;
  createSession(session?: string, config?: any): Promise<string>;
  getChats(): Promise<WahaChat[]>;
  getMessages(chatId: string, limit?: number): Promise<WahaMessage[]>;
  getContact(phone: string): Promise<WahaContact | null>;
  downloadMedia(messageId: string, chatId: string): Promise<Buffer | null>;
}

/**
 * Client Service untuk berkomunikasi dengan WAHA (WhatsApp HTTP API Self-Hosted)
 * Dokumentasi WAHA: https://waha.devlike.pro
 */
export class WahaClient implements IWahaClient {
  private baseUrl: string;
  private apiKey: string;
  private session: string;

  // Semaphore sederhana untuk membatasi call HTTP WAHA yang berjalan bersamaan
  private concurrentCalls = 0;
  private limiterQueue: Array<() => void> = [];

  // Mutex per-chat untuk operasi mutasi label (addLabel/removeLabel/batchUpdateLabels).
  // Read-modify-write label WAHA dari 2 pemanggilan nyaris bersamaan untuk chat yang
  // sama bisa saling menimpa (lost update); kunci per targetChatId memastikan operasi
  // mutasi untuk chat yang sama dijalankan sekuensial.
  private labelLocks = new Map<string, Promise<void>>();

  constructor() {
    this.baseUrl = (process.env.WAHA_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
    this.apiKey = process.env.WAHA_API_KEY || '';
    this.session = process.env.WAHA_SESSION || 'default';
  }

  private get headers() {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      h['X-Api-Key'] = this.apiKey;
    }
    return h;
  }

  private get timeoutMs() {
    return parseInt(process.env.HUMANIZER_HTTP_TIMEOUT_MS || '10000', 10);
  }

  /**
   * Timeout khusus untuk operasi media (sendImage & fetch gambar remote).
   * Upload media ke server WhatsApp via WAHA bisa jauh lebih lambat dari
   * endpoint interact biasa, sehingga pakai timeout khusus (default 30s)
   * — jangan menumpang HUMANIZER_HTTP_TIMEOUT_MS (10s) yang terlalu ketat.
   */
  private get mediaTimeoutMs() {
    return parseInt(process.env.WAHA_SEND_TIMEOUT_MS || '30000', 10);
  }

  private get shouldMock(): boolean {
    return (
      process.env.NODE_ENV === 'test' ||
      process.env.WAHA_MOCK === 'true'
    );
  }

  private get retryAttempts(): number {
    return parseInt(process.env.WAHA_RETRY_ATTEMPTS || '2', 10);
  }

  private get retryBackoffMs(): number {
    return parseInt(process.env.WAHA_RETRY_BACKOFF_MS || '1500', 10);
  }

  private get maxConcurrentCalls(): number {
    return parseInt(process.env.WAHA_MAX_CONCURRENT_CALLS || '6', 10);
  }

  /**
   * Batasi jumlah call HTTP interaktif WAHA yang berjalan bersamaan (global per client).
   * Tanpa ini, beberapa shard BullMQ yang memproses paralel bisa membombardir WAHA
   * (sendText + typing + seen sekaligus) → timeout beruntun seperti di log produksi.
   * maxConcurrentCalls <= 0 = nonaktifkan limiter.
   */
  private async runSerialized<T>(fn: () => Promise<T>): Promise<T> {
    if (this.maxConcurrentCalls <= 0) {
      return fn();
    }
    if (this.concurrentCalls >= this.maxConcurrentCalls) {
      await new Promise<void>((resolve) => this.limiterQueue.push(resolve));
    }
    this.concurrentCalls++;
    try {
      return await fn();
    } finally {
      this.concurrentCalls--;
      const next = this.limiterQueue.shift();
      if (next) next();
    }
  }

  /**
   * Retry HANYA untuk error transien (timeout/koneksi), BUKAN 4xx/5xx.
   * WAHA kadang lambat saat beban tinggi — satu retry dengan backoff pendek
   * menyelamatkan reply yang sebelumnya hilang tanpa jejak (worker BullMQ
   * tidak mengulang job yang gagal).
   */
  private async withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
    let lastErr: any;
    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        lastErr = err;
        if (!this.isTransientError(err) || attempt >= this.retryAttempts) {
          throw err;
        }
        console.warn(`[WAHA RETRY] ${label} gagal (percobaan ${attempt}/${this.retryAttempts}), coba ulang dalam ${this.retryBackoffMs}ms: ${err?.message || err}`);
        await this.sleep(this.retryBackoffMs);
      }
    }
    throw lastErr;
  }

  private isTransientError(err: any): boolean {
    const code = err?.code || '';
    const msg = String(err?.message || err || '');
    return (
      ['ECONNABORTED', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EPIPE', 'ECONNRESET'].includes(code) ||
      /timeout|socket hang up|econnaborted|econnreset|network/i.test(msg)
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Sinkronkan kolom Customer.is_admin_labeled / is_hold_labeled untuk mutasi
   * label yang dilakukan BOT via API (event WAHA label.chat.added/deleted adalah
   * jalur utama untuk perubahan dari aplikasi WA Business / admin).
   * Best-effort penuh (DB offline → memory fallback via customerService).
   */
  private async syncLabelColumn(
    targetChatId: string,
    labelName: string,
    isAdded: boolean
  ): Promise<void> {
    const lower = (labelName || '').toLowerCase();
    if (lower !== 'admin' && lower !== 'hold') return;
    const phone = targetChatId.replace(/@.*$/, '');
    if (!phone) return;
    try {
      const { customerService } = await import('../../services/customer.service');
      await customerService.setLabelFlags(phone, {
        isAdminLabeled: lower === 'admin' ? isAdded : undefined,
        isHoldLabeled: lower === 'hold' ? isAdded : undefined,
      });
    } catch (err: any) {
      console.warn(`[LABEL SYNC] Failed to sync "${lower}" column for ${targetChatId}:`, err.message);
    }
  }

  /**
   * Mutex per targetChatId untuk mutasi label. Calls untuk chat yang sama
   * dieksekusi sekuensial; chat berbeda tetap paralel.
   */
  private async withLabelLock<T>(chatId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.labelLocks.get(chatId) || Promise.resolve();
    let release!: () => void;
    const curr = new Promise<void>((resolve) => { release = resolve; });
    this.labelLocks.set(chatId, curr);
    // Jangan biarkan reject dari pemanggil sebelumnya memutus rantai antrian
    await prev.catch(() => {});
    try {
      return await fn();
    } finally {
      release();
      if (this.labelLocks.get(chatId) === curr) {
        this.labelLocks.delete(chatId);
      }
    }
  }

  private async resolveActiveJid(chatId: string): Promise<string> {
    // 1. Jika sudah berupa @lid, gunakan langsung (karena ini JID paling presisi dari webhook)
    if (chatId.includes('@lid')) {
      return chatId;
    }

    if (this.shouldMock) {
      return chatId;
    }

    // 2. Jika berupa @c.us, tanyakan ke API WAHA /api/{session}/lids/pn/{phoneNumber} untuk mendapatkan LID-nya
    try {
      const targetPn = chatId.includes('@c.us') ? chatId : `${chatId}@c.us`;
      const encodedPn = encodeURIComponent(targetPn);
      const response = await this.withRetry('resolveActiveJid', () =>
        axios.get(
          `${this.baseUrl}/api/${this.session}/lids/pn/${encodedPn}`,
          { headers: this.headers, timeout: this.timeoutMs }
        )
      );
      if (response.data?.lid) {
        return response.data.lid;
      }
    } catch (err) {
      // Abaikan error, fallback ke JID asal
    }

    return chatId;
  }

  /**
   * Mengonversi JID apapun (termasuk @lid) ke JID primer (@c.us / @g.us).
   * Penting untuk memanipulasi label, karena label harus menempel ke JID primer
   * agar bisa muncul di aplikasi WhatsApp Business.
   *
   * PUBLIC: dipakai webhook handler untuk resolve SEKALI per pesan masuk,
   * hasilnya diturunkan ke nomor HP & cache key label.
   */
  public async resolvePrimaryJid(chatId: string): Promise<string> {
    if (chatId.includes('@g.us')) return chatId;
    
    if (chatId.includes('@lid')) {
      const pn = await this.getPhoneNumberFromLid(chatId);
      return `${pn}@c.us`;
    }
    
    if (!chatId.includes('@c.us')) {
      return `${chatId}@c.us`;
    }
    return chatId;
  }

  /**
   * Mengonversi JID LID (misal: 79903991054369@lid) kembali ke nomor HP asli (misal: 6285794210526)
   * Hasil resolusi di-cache TTL pendek (lihat label-cache.ts) agar jalur webhook tidak
   * memanggil /lids/* berulang kali untuk chat yang sama dalam window singkat.
   */
  public async getPhoneNumberFromLid(lid: string): Promise<string> {
    if (!lid.includes('@lid')) {
      return lid.replace(/@.*$/, '');
    }

    if (this.shouldMock) {
      return lid.replace(/@.*$/, '');
    }

    const cached = getCachedLidPhone(lid);
    if (cached) return cached;

    try {
      const encodedLid = encodeURIComponent(lid);
      const response = await this.withRetry('getPhoneNumberFromLid', () =>
        axios.get(
          `${this.baseUrl}/api/${this.session}/lids/${encodedLid}`,
          { headers: this.headers, timeout: this.timeoutMs }
        )
      );
      const pn = response.data?.pn;
      if (pn) {
        const cleaned = pn.replace(/@.*$/, '');
        setCachedLidPhone(lid, cleaned);
        return cleaned;
      }
    } catch (err) {
      // Abaikan error, fallback ke user part
    }
    return lid.replace(/@.*$/, '');
  }

  /**
   * Mengirim sinyal pesan telah dibaca (sendSeen).
   * Termasuk parameter messageId dan timeout guard.
   */
  public async sendSeen(chatId: string, messageId?: string): Promise<boolean> {
    const targetChatId = await this.resolveActiveJid(chatId);

    if (this.shouldMock) {
      console.log(`[MOCK WAHA] sendSeen -> chatId: ${targetChatId}, messageId: ${messageId}`);
      return true;
    }

    try {
      await this.runSerialized(() =>
        this.withRetry('sendSeen', () =>
          axios.post(
            `${this.baseUrl}/api/sendSeen`,
            {
              chatId: targetChatId,
              messageId: messageId || undefined,
              session: this.session,
            },
            { headers: this.headers, timeout: this.timeoutMs }
          )
        )
      );
      return true;
    } catch (error: any) {
      console.warn('[WAHA API ERROR] sendSeen failed:', error?.response?.data || error.message);
      return false;
    }
  }

  /**
   * Mulai indikator status mengetik (startTyping)
   */
  public async startTyping(chatId: string): Promise<boolean> {
    const targetChatId = await this.resolveActiveJid(chatId);

    if (this.shouldMock) {
      console.log(`[MOCK WAHA] startTyping -> chatId: ${targetChatId}`);
      return true;
    }

    try {
      await this.runSerialized(() =>
        axios.post(
          `${this.baseUrl}/api/startTyping`,
          {
            chatId: targetChatId,
            session: this.session,
          },
          { headers: this.headers, timeout: this.timeoutMs }
        )
      );
      return true;
    } catch (error: any) {
      console.warn('[WAHA API ERROR] startTyping failed:', error?.response?.data || error.message);
      return false;
    }
  }

  /**
   * Hentikan indikator status mengetik (stopTyping)
   */
  public async stopTyping(chatId: string): Promise<boolean> {
    const targetChatId = await this.resolveActiveJid(chatId);

    if (this.shouldMock) {
      console.log(`[MOCK WAHA] stopTyping -> chatId: ${targetChatId}`);
      return true;
    }

    try {
      await this.runSerialized(() =>
        axios.post(
          `${this.baseUrl}/api/stopTyping`,
          {
            chatId: targetChatId,
            session: this.session,
          },
          { headers: this.headers, timeout: this.timeoutMs }
        )
      );
      return true;
    } catch (error: any) {
      console.warn('[WAHA API ERROR] stopTyping failed:', error?.response?.data || error.message);
      return false;
    }
  }

  /**
   * Pengiriman pesan teks utama ke WAHA API (/api/sendText)
   */
  public async sendText(chatId: string, text: string): Promise<boolean> {
    const targetChatId = await this.resolveActiveJid(chatId);
    // Normalisasi markdown ganda (mis. **bold**) → formatting WhatsApp SATU tanda (*bold*)
    const normalizedText = normalizeWhatsAppFormat(text);

    if (this.shouldMock) {
      console.log(`[MOCK WAHA OUTBOUND] sendText -> chatId: ${targetChatId} | text: "${normalizedText}"`);
      return true;
    }

    try {
      const response = await this.runSerialized(() =>
        this.withRetry('sendText', () =>
          axios.post(
            `${this.baseUrl}/api/sendText`,
            {
              chatId: targetChatId,
              text: normalizedText,
              session: this.session,
            },
            { headers: this.headers, timeout: this.timeoutMs }
          )
        )
      );
      return response.status === 200 || response.status === 201;
    } catch (error: any) {
      console.error(`[WAHA API ERROR] sendText failed for ${targetChatId}:`, error?.response?.data || error.message);
      return false;
    }
  }

  // --- MOCK LABELS FOR TESTING ---
  public mockLabels: Map<string, string[]> = new Map();
  public mockChats: WahaChat[] = [];
  public mockMessages: Map<string, WahaMessage[]> = new Map();

  /**
   * Mengirim media/gambar ke WAHA API (/api/sendImage)
   * Mendukung konversi URL (remote) dan File Path (lokal) menjadi Base64 Payload secara otomatis
   */
  public async sendImage(chatId: string, url: string, caption?: string): Promise<boolean> {
    const targetChatId = await this.resolveActiveJid(chatId);

    if (this.shouldMock) {
      console.log(`[MOCK WAHA OUTBOUND] sendImage -> chatId: ${targetChatId} | url: "${url}" | caption: "${caption || ''}"`);
      return true;
    }

    try {
      let base64Data = '';
      let mimetype = 'image/jpeg';
      let filename = 'image.jpg';

      if (url.startsWith('http://') || url.startsWith('https://')) {
        // Fetch remote image lewat axios sebagai arraybuffer
        const response = await axios.get(url, { responseType: 'arraybuffer', timeout: this.mediaTimeoutMs });
        base64Data = Buffer.from(response.data, 'binary').toString('base64');
        mimetype = String(response.headers['content-type'] || 'image/jpeg');


        const urlPathname = new URL(url).pathname;
        const lastSegment = urlPathname.substring(urlPathname.lastIndexOf('/') + 1);
        if (lastSegment) filename = lastSegment;
      } else {
        // Baca file lokal (dukung path absolut & relative /media/outbound/... atau storage/media/...)
        const fs = await import('fs/promises');
        const { existsSync } = await import('fs');
        const path = await import('path');

        let resolvedPath = path.resolve(url);
        if (!existsSync(resolvedPath)) {
          if (url.startsWith('/media/') || url.startsWith('media/')) {
            const relClean = url.replace(/^\/?media\//, '');
            resolvedPath = path.join(process.cwd(), 'storage', 'media', relClean);
          } else if (url.startsWith('/storage/') || url.startsWith('storage/')) {
            const relClean = url.replace(/^\/?storage\//, '');
            resolvedPath = path.join(process.cwd(), 'storage', relClean);
          } else if (!path.isAbsolute(url)) {
            resolvedPath = path.join(process.cwd(), url);
          }
        }

        if (!existsSync(resolvedPath)) {
          throw new Error(`File media lokal tidak ditemukan di: ${resolvedPath} (input original: ${url})`);
        }

        const fileBuffer = await fs.readFile(resolvedPath);
        base64Data = fileBuffer.toString('base64');

        const ext = path.extname(resolvedPath).toLowerCase();
        if (ext === '.png') mimetype = 'image/png';
        else if (ext === '.gif') mimetype = 'image/gif';
        else if (ext === '.webp') mimetype = 'image/webp';
        filename = path.basename(resolvedPath);
      }

      const response = await axios.post(
        `${this.baseUrl}/api/sendImage`,
        {
          chatId: targetChatId,
          file: {
            mimetype,
            data: base64Data,
            filename,
          },
          caption,
          session: this.session,
        },
        { headers: this.headers, timeout: this.mediaTimeoutMs }
      );
      return response.status === 200 || response.status === 201;
    } catch (error: any) {
      console.error(`[WAHA API ERROR] sendImage failed for ${targetChatId}:`, error?.response?.data || error.message);
      return false;
    }
  }

  /**
   * Menambahkan label ke chat menggunakan API WAHA baru (PUT /api/{session}/labels/chats/{chatId})
   * Best-effort: kegagalan tidak pernah melempar ke pemanggil (return false).
   */
  public async addLabel(chatId: string, labelName: string): Promise<boolean> {
    const targetChatId = await this.resolvePrimaryJid(chatId);

    if (this.shouldMock) {
      console.log(`[MOCK WAHA OUTBOUND] addLabel -> chatId: ${targetChatId} | label: "${labelName}"`);
      const existing = this.mockLabels.get(targetChatId) || [];
      if (!existing.includes(labelName)) {
        existing.push(labelName);
      }
      this.mockLabels.set(targetChatId, existing);
      invalidateCachedLabels(targetChatId);
      await this.syncLabelColumn(targetChatId, labelName, true);
      return true;
    }

    return this.withLabelLock(targetChatId, () =>
      this.runSerialized(() =>
        this.withRetry('addLabel', async () => {
          // 1. Dapatkan ID label dari daftar label yang ada di session
          const labelsListResponse = await axios.get(
            `${this.baseUrl}/api/${this.session}/labels`,
            { headers: this.headers, timeout: this.timeoutMs }
          );
          const labels = labelsListResponse.data?.value || labelsListResponse.data || [];
          let targetLabel = labels.find((l: any) => l.name.toLowerCase() === labelName.toLowerCase());

          // Jika label belum ada di session, kita buat baru
          if (!targetLabel) {
            const createResponse = await axios.post(
              `${this.baseUrl}/api/${this.session}/labels`,
              { name: labelName, color: 1 },
              { headers: this.headers, timeout: this.timeoutMs }
            );
            targetLabel = createResponse.data;
          }

          if (!targetLabel) {
            console.error(`[WAHA API ERROR] addLabel failed for ${targetChatId}: Could not find or create label "${labelName}"`);
            return false;
          }

          // 2. Dapatkan label yang saat ini menempel pada chat
          const currentLabelsResponse = await axios.get(
            `${this.baseUrl}/api/${this.session}/labels/chats/${targetChatId}`,
            { headers: this.headers, timeout: this.timeoutMs }
          );
          const currentLabels = currentLabelsResponse.data?.value || currentLabelsResponse.data || [];

          // 3. Gabungkan label target jika belum terpasang
          const alreadyHas = currentLabels.some((l: any) => l.id === targetLabel.id);
          if (alreadyHas) return true;

          const newLabelsList = [...currentLabels, targetLabel].map((l: any) => ({ id: l.id }));

          // 4. Update label chat menggunakan PUT
          await axios.put(
            `${this.baseUrl}/api/${this.session}/labels/chats/${targetChatId}`,
            { labels: newLabelsList },
            { headers: this.headers, timeout: this.timeoutMs }
          );
          invalidateCachedLabels(targetChatId);
          console.log(`[WAHA LABEL] Successfully added label "${labelName}" to ${targetChatId}`);
          return true;
        })
      )
    ).then(async (ok) => {
        if (ok) await this.syncLabelColumn(targetChatId, labelName, true);
        return ok;
      }).catch((error: any) => {
      console.error(`[WAHA API ERROR] addLabel failed for ${targetChatId} (label: "${labelName}"):`, error?.response?.data || error.message);
      return false;
    });
  }

  /**
   * Menghapus label dari chat menggunakan API WAHA baru (PUT /api/{session}/labels/chats/{chatId})
   * Best-effort: kegagalan tidak pernah melempar ke pemanggil (return false).
   */
  public async removeLabel(chatId: string, labelName: string): Promise<boolean> {
    const targetChatId = await this.resolvePrimaryJid(chatId);

    if (this.shouldMock) {
      console.log(`[MOCK WAHA OUTBOUND] removeLabel -> chatId: ${targetChatId} | label: "${labelName}"`);
      const existing = this.mockLabels.get(targetChatId) || [];
      const filtered = existing.filter(l => l !== labelName);
      this.mockLabels.set(targetChatId, filtered);
      invalidateCachedLabels(targetChatId);
      await this.syncLabelColumn(targetChatId, labelName, false);
      return true;
    }

    return this.withLabelLock(targetChatId, () =>
      this.runSerialized(() =>
        this.withRetry('removeLabel', async () => {
          // 1. Dapatkan label yang saat ini menempel pada chat
          const currentLabelsResponse = await axios.get(
            `${this.baseUrl}/api/${this.session}/labels/chats/${targetChatId}`,
            { headers: this.headers, timeout: this.timeoutMs }
          );
          const currentLabels = currentLabelsResponse.data?.value || currentLabelsResponse.data || [];

          // 2. Filter buang label yang sesuai dengan nama target
          const filteredLabels = currentLabels
            .filter((l: any) => l.name.toLowerCase() !== labelName.toLowerCase())
            .map((l: any) => ({ id: l.id }));

          // 3. Update label chat menggunakan PUT
          await axios.put(
            `${this.baseUrl}/api/${this.session}/labels/chats/${targetChatId}`,
            { labels: filteredLabels },
            { headers: this.headers, timeout: this.timeoutMs }
          );
          invalidateCachedLabels(targetChatId);
          console.log(`[WAHA LABEL] Successfully removed label "${labelName}" from ${targetChatId}`);
          return true;
        })
      )
    ).then(async (ok) => {
        if (ok) await this.syncLabelColumn(targetChatId, labelName, false);
        return ok;
      }).catch((error: any) => {
      console.error(`[WAHA API ERROR] removeLabel failed for ${targetChatId} (label: "${labelName}"):`, error?.response?.data || error.message);
      return false;
    });
  }

  /**
   * Aplikasikan beberapa perubahan label untuk 1 chat sebagai SATU operasi atomik
   * (1x GET daftar label session + 1x GET label chat + 1x PUT), bukan berkali-kali
   * GET/PUT terpisah per label yang bisa saling menimpa (race condition).
   *
   * Best-effort: return false bila gagal, tidak pernah melempar ke pemanggil.
   * addLabel/removeLabel tetap dipertahankan untuk pemakaian 1-label di tempat lain.
   */
  public async batchUpdateLabels(
    chatId: string,
    changes: { add?: string[]; remove?: string[] }
  ): Promise<boolean> {
    const targetChatId = await this.resolvePrimaryJid(chatId);
    const toAdd = changes.add || [];
    const toRemove = (changes.remove || []).map(l => l.toLowerCase());

    if (this.shouldMock) {
      const existing = this.mockLabels.get(targetChatId) || [];
      const next = existing.filter(l => !toRemove.includes(l.toLowerCase()));
      for (const l of toAdd) if (!next.includes(l)) next.push(l);
      this.mockLabels.set(targetChatId, next);
      invalidateCachedLabels(targetChatId);
      for (const l of toAdd) await this.syncLabelColumn(targetChatId, l, true);
      for (const l of toRemove) await this.syncLabelColumn(targetChatId, l, false);
      console.log(`[MOCK WAHA OUTBOUND] batchUpdateLabels -> chatId: ${targetChatId} | add: ${JSON.stringify(toAdd)} | remove: ${JSON.stringify(toRemove)}`);
      return true;
    }

    return this.withLabelLock(targetChatId, () =>
      this.runSerialized(() =>
        this.withRetry('batchUpdateLabels', async () => {
          // 1. Ambil semua label yang ada di session
          const labelsListResponse = await axios.get(
            `${this.baseUrl}/api/${this.session}/labels`,
            { headers: this.headers, timeout: this.timeoutMs }
          );
          const sessionLabels = labelsListResponse.data?.value || labelsListResponse.data || [];

          // 2. Pastikan semua label yang mau ditambah sudah ada id-nya (buat jika belum ada)
          const addTargets: any[] = [];
          for (const name of toAdd) {
            let found = sessionLabels.find((l: any) => l.name.toLowerCase() === name.toLowerCase());
            if (!found) {
              const createResponse = await axios.post(
                `${this.baseUrl}/api/${this.session}/labels`,
                { name, color: 1 },
                { headers: this.headers, timeout: this.timeoutMs }
              );
              found = createResponse.data;
              sessionLabels.push(found);
            }
            if (found) addTargets.push(found);
          }

          // 3. Ambil label yang saat ini menempel di chat (SEKALI, bukan per-operasi)
          const currentLabelsResponse = await axios.get(
            `${this.baseUrl}/api/${this.session}/labels/chats/${targetChatId}`,
            { headers: this.headers, timeout: this.timeoutMs }
          );
          const currentLabels = currentLabelsResponse.data?.value || currentLabelsResponse.data || [];

          // 4. Hitung state akhir: buang yang di-remove, tambah yang di-add (dedupe by id)
          const afterRemove = currentLabels.filter((l: any) => !toRemove.includes(l.name.toLowerCase()));
          const finalMap = new Map<string, any>(afterRemove.map((l: any) => [l.id, l]));
          for (const t of addTargets) finalMap.set(t.id, t);
          const finalList = Array.from(finalMap.values()).map((l: any) => ({ id: l.id }));

          // 5. Satu kali PUT untuk semua perubahan
          await axios.put(
            `${this.baseUrl}/api/${this.session}/labels/chats/${targetChatId}`,
            { labels: finalList },
            { headers: this.headers, timeout: this.timeoutMs }
          );

          invalidateCachedLabels(targetChatId);
          for (const l of toAdd) await this.syncLabelColumn(targetChatId, l, true);
          for (const l of toRemove) await this.syncLabelColumn(targetChatId, l, false);
          console.log(`[WAHA LABEL] batchUpdateLabels OK for ${targetChatId} | add: ${JSON.stringify(toAdd)} | remove: ${JSON.stringify(toRemove)}`);
          return true;
        })
      )
    ).catch((error: any) => {
      console.error(`[WAHA API ERROR] batchUpdateLabels failed for ${targetChatId}:`, error?.response?.data || error.message);
      return false;
    });
  }

  /**
   * Mengambil daftar label yang ada pada chat menggunakan API WAHA baru.
   * Mengembalikan string[] jika sukses, atau null jika WAHA error/timeout/down.
   */
  public async getChatLabelsOrNull(chatId: string): Promise<string[] | null> {
    const targetChatId = await this.resolvePrimaryJid(chatId);

    const cached = getCachedLabels(targetChatId);
    if (cached) return cached;

    if (this.shouldMock) {
      return this.mockLabels.get(targetChatId) || [];
    }

    try {
      const response = await this.withRetry('getChatLabels', () =>
        axios.get(
          `${this.baseUrl}/api/${this.session}/labels/chats/${targetChatId}`,
          { headers: this.headers, timeout: this.timeoutMs }
        )
      );
      const chatLabels = response.data?.value || response.data || [];
      const names = chatLabels.map((l: any) => typeof l === 'string' ? l : l.name);
      setCachedLabels(targetChatId, names);
      return names;
    } catch (error: any) {
      console.warn(`[WAHA API ERROR] getChatLabelsOrNull failed for ${targetChatId}:`, error?.response?.data || error.message);
      return null;
    }
  }

  public async getChatLabels(chatId: string): Promise<string[]> {
    const res = await this.getChatLabelsOrNull(chatId);
    return res || [];
  }


  /**
   * Mengambil daftar chat dari WAHA (GET /api/chats)
   */
  public async getChats(): Promise<WahaChat[]> {
    if (this.shouldMock) {
      return this.mockChats;
    }

    try {
      const response = await axios.get(
        `${this.baseUrl}/api/${this.session}/chats`,
        {
          headers: this.headers,
          timeout: this.timeoutMs,
        }
      );
      return response.data?.value || response.data || [];
    } catch (error: any) {
      console.error('[WAHA API ERROR] getChats failed:', error?.response?.data || error.message);
      return [];
    }
  }

  /**
   * Mengambil histori pesan dari chat tertentu (GET /api/messages)
   */
  public async getMessages(chatId: string, limit = 100): Promise<WahaMessage[]> {
    const targetChatId = await this.resolveActiveJid(chatId);

    if (this.shouldMock) {
      const msgs = this.mockMessages.get(targetChatId) || [];
      return msgs.slice(0, limit);
    }

    try {
      const response = await axios.get(
        `${this.baseUrl}/api/messages`,
        {
          headers: this.headers,
          params: {
            chatId: targetChatId,
            limit,
            session: this.session,
          },
          timeout: this.timeoutMs,
        }
      );
      return response.data?.value || response.data || [];
    } catch (error: any) {
      console.error(`[WAHA API ERROR] getMessages failed for ${targetChatId}:`, error?.response?.data || error.message);
      return [];
    }
  }

  /**
   * Mengambil profil kontak (pushname) dari WAHA.
   * Endpoint: GET /api/{session}/contacts/{phone}.
   * Mengembalikan null bila gagal / kontak tidak ditemukan (best-effort).
   */
  public async getContact(phone: string): Promise<WahaContact | null> {
    if (this.shouldMock) return null;
    try {
      const response = await axios.get(
        `${this.baseUrl}/api/${this.session}/contacts/${encodeURIComponent(phone)}`,
        {
          headers: this.headers,
          timeout: this.timeoutMs,
        }
      );
      return response.data || null;
    } catch (error: any) {
      console.warn(`[WAHA API ERROR] getContact failed for ${phone}:`, error?.response?.data || error.message);
      return null;
    }
  }

  /**
   * Mengunduh media (gambar) pesan masuk dari WAHA.
   * Endpoint: GET /api/{session}/chats/{chatId}/messages/{messageId}/media.
   * Mengembalikan Buffer binary atau null bila gagal / tak tersedia.
   */
  public async downloadMedia(messageId: string, chatId: string): Promise<Buffer | null> {
    if (this.shouldMock) {
      // PNG 1x1 transparan sebagai deterministik mock agar alur inbound bisa diuji.
      return Buffer.from(MOCK_QR_BASE64, 'base64');
    }
    try {
      const encodedChat = encodeURIComponent(chatId);
      const encodedMsg = encodeURIComponent(messageId);
      const response = await axios.get(
        `${this.baseUrl}/api/${this.session}/chats/${encodedChat}/messages/${encodedMsg}/media`,
        {
          headers: {
            'X-Api-Key': this.apiKey || undefined,
          },
          responseType: 'arraybuffer',
          timeout: 15000,
        }
      );
      if (Buffer.isBuffer(response.data)) return response.data;
      if (response.data instanceof ArrayBuffer) return Buffer.from(response.data);
      if (response.data && typeof response.data === 'object') {
        return Buffer.from(JSON.stringify(response.data));
      }
      return Buffer.from(response.data as any);
    } catch (error: any) {
      console.warn(`[WAHA API ERROR] downloadMedia failed for ${chatId}/${messageId}:`, error?.response?.data || error.message);
      return null;
    }
  }

  /**
   * Mengecek status session WAHA saat ini.
   * Menerima parameter session opsional untuk mengecek session selain session default (per-tenant).
   * Mengembalikan string status session (e.g. "WORKING", "SCAN_QR_CODE", "FAILED", "STOPPED", etc.)
   * atau "DISCONNECTED" jika unreachable.
   */
  public async getSessionStatus(session?: string): Promise<string> {
    const sessionName = session || this.session;

    if (this.shouldMock) {
      return 'WORKING';
    }
    try {
      const response = await axios.get(
        `${this.baseUrl}/api/sessions/${sessionName}`,
        { headers: this.headers, timeout: 5000 }
      );
      return response.data?.status || 'UNKNOWN';
    } catch (err) {
      return 'DISCONNECTED';
    }
  }

  /**
   * Memulai session WAHA (POST /api/sessions/{name}/start).
   * Idempotent — aman dipanggil saat session sudah berjalan.
   */
  public async startSession(session?: string): Promise<string> {
    const sessionName = session || this.session;

    if (this.shouldMock) {
      return 'WORKING';
    }

    try {
      await axios.post(
        `${this.baseUrl}/api/sessions/${sessionName}/start`,
        {},
        { headers: this.headers, timeout: this.timeoutMs }
      );
      return 'STARTED';
    } catch (error: any) {
      console.warn(`[WAHA API ERROR] startSession failed for session ${sessionName}:`, error?.response?.data || error.message);
      return 'FAILED';
    }
  }

  /**
   * Menghentikan session WAHA (POST /api/sessions/{name}/stop atau logout).
   */
  public async stopSession(session?: string): Promise<boolean> {
    const sessionName = session || this.session;

    if (this.shouldMock) {
      return true;
    }

    try {
      await axios.post(
        `${this.baseUrl}/api/sessions/${sessionName}/stop`,
        {},
        { headers: this.headers, timeout: this.timeoutMs }
      );
      return true;
    } catch (error: any) {
      try {
        await axios.post(
          `${this.baseUrl}/api/sessions/${sessionName}/logout`,
          {},
          { headers: this.headers, timeout: this.timeoutMs }
        );
        return true;
      } catch (err) {
        return false;
      }
    }
  }

  /**
   * Mengambil objek session lengkap (termasuk config webhooks) dari WAHA.
   * Mengembalikan null jika session belum ada / tidak dapat dijangkau.
   */
  public async getSession(session?: string): Promise<any | null> {
    const sessionName = session || this.session;

    if (this.shouldMock) {
      return { name: sessionName, status: 'WORKING', config: {} };
    }

    try {
      const response = await axios.get(
        `${this.baseUrl}/api/sessions/${sessionName}`,
        { headers: this.headers, timeout: 5000 }
      );
      return response.data || null;
    } catch (err) {
      return null;
    }
  }

  /**
   * Menghapus session WAHA beserta kredensialnya (DELETE /api/sessions/{name}).
   * Dipakai untuk re-pair (logout total) saat session FAILED / korup.
   * Mengembalikan true jika session berhasil dihapus (atau sudah tidak ada).
   */
  public async deleteSession(session?: string): Promise<boolean> {
    const sessionName = session || this.session;

    if (this.shouldMock) {
      return true;
    }

    try {
      await axios.delete(
        `${this.baseUrl}/api/sessions/${sessionName}`,
        { headers: this.headers, timeout: this.timeoutMs }
      );
      return true;
    } catch (error: any) {
      // 404 = session tidak ada → dianggap sukses (tujuan akhir: bersih)
      const status = error?.response?.status || error?.response?.data?.status;
      if (status === 404) {
        return true;
      }
      console.warn(`[WAHA API ERROR] deleteSession failed for session ${sessionName}:`, error?.response?.data || error.message);
      return false;
    }
  }

  /**
   * Membuat session WAHA baru (POST /api/sessions) dengan config opsional
   * (mis. webhooks). Mempertahankan config lama penting saat re-pair agar
   * webhook bot tidak hilang. Mengembalikan 'CREATED'/'EXISTS'/'FAILED'.
   */
  public async createSession(session?: string, config?: any): Promise<string> {
    const sessionName = session || this.session;

    if (this.shouldMock) {
      return 'CREATED';
    }

    try {
      await axios.post(
        `${this.baseUrl}/api/sessions`,
        { name: sessionName, config: config || {} },
        { headers: this.headers, timeout: this.timeoutMs }
      );
      return 'CREATED';
    } catch (error: any) {
      const status = error?.response?.status || error?.response?.data?.status;
      if (status === 409) {
        return 'EXISTS';
      }
      console.warn(`[WAHA API ERROR] createSession failed for session ${sessionName}:`, error?.response?.data || error.message);
      return 'FAILED';
    }
  }

  /**
   * Mengambil QR code autentikasi session WAHA (GET /api/{session}/auth/qr).
   * Menerima parameter session opsional (per-tenant); default ke session env.
   * Mengembalikan base64 QR beserta mimetype, atau null jika QR tidak tersedia/session tidak dalam mode SCAN_QR_CODE.
   */
  public async getAuthQr(session?: string): Promise<WahaQr | null> {
    const sessionName = session || this.session;

    if (this.shouldMock) {
      return { mimetype: 'image/png', data: MOCK_QR_BASE64 };
    }

    try {
      const response = await axios.get(
        `${this.baseUrl}/api/${sessionName}/auth/qr`,
        {
          headers: { ...this.headers, Accept: 'application/json' },
          timeout: this.timeoutMs,
        }
      );
      if (response.data && typeof response.data.data === 'string' && response.data.data) {
        return {
          mimetype: response.data.mimetype || 'image/png',
          data: response.data.data,
        };
      }
      return null;
    } catch (error: any) {
      console.warn(`[WAHA API ERROR] getAuthQr failed for session ${sessionName}:`, error?.response?.data || error.message);
      return null;
    }
  }
}

export const wahaClient = new WahaClient();
