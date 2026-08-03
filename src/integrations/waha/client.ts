import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

export interface WahaChat {
  id: string;
  name?: string;
  unreadCount?: number;
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
  getSessionStatus(session?: string): Promise<string>;
  startSession(session?: string): Promise<string>;
  getAuthQr(session?: string): Promise<WahaQr | null>;
  getSession(session?: string): Promise<any | null>;
  deleteSession(session?: string): Promise<boolean>;
  createSession(session?: string, config?: any): Promise<string>;
  getChats(): Promise<WahaChat[]>;
  getMessages(chatId: string, limit?: number): Promise<WahaMessage[]>;
}

/**
 * Client Service untuk berkomunikasi dengan WAHA (WhatsApp HTTP API Self-Hosted)
 * Dokumentasi WAHA: https://waha.devlike.pro
 */
export class WahaClient implements IWahaClient {
  private baseUrl: string;
  private apiKey: string;
  private session: string;

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

  private get shouldMock(): boolean {
    return (
      process.env.NODE_ENV === 'test' ||
      process.env.WAHA_MOCK === 'true'
    );
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
      const response = await axios.get(
        `${this.baseUrl}/api/${this.session}/lids/pn/${encodedPn}`,
        { headers: this.headers, timeout: this.timeoutMs }
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
   * Mengonversi JID LID (misal: 79903991054369@lid) kembali ke nomor HP asli (misal: 6285794210526)
   */
  public async getPhoneNumberFromLid(lid: string): Promise<string> {
    if (!lid.includes('@lid')) {
      return lid.replace(/@.*$/, '');
    }

    if (this.shouldMock) {
      return lid.replace(/@.*$/, '');
    }

    try {
      const encodedLid = encodeURIComponent(lid);
      const response = await axios.get(
        `${this.baseUrl}/api/${this.session}/lids/${encodedLid}`,
        { headers: this.headers, timeout: this.timeoutMs }
      );
      const pn = response.data?.pn;
      if (pn) {
        return pn.replace(/@.*$/, '');
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
      await axios.post(
        `${this.baseUrl}/api/sendSeen`,
        {
          chatId: targetChatId,
          messageId: messageId || undefined,
          session: this.session,
        },
        { headers: this.headers, timeout: this.timeoutMs }
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
      await axios.post(
        `${this.baseUrl}/api/startTyping`,
        {
          chatId: targetChatId,
          session: this.session,
        },
        { headers: this.headers, timeout: this.timeoutMs }
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
      await axios.post(
        `${this.baseUrl}/api/stopTyping`,
        {
          chatId: targetChatId,
          session: this.session,
        },
        { headers: this.headers, timeout: this.timeoutMs }
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

    if (this.shouldMock) {
      console.log(`[MOCK WAHA OUTBOUND] sendText -> chatId: ${targetChatId} | text: "${text}"`);
      return true;
    }

    try {
      const response = await axios.post(
        `${this.baseUrl}/api/sendText`,
        {
          chatId: targetChatId,
          text,
          session: this.session,
        },
        { headers: this.headers, timeout: this.timeoutMs }
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
        const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 8000 });
        base64Data = Buffer.from(response.data, 'binary').toString('base64');
        mimetype = String(response.headers['content-type'] || 'image/jpeg');


        const urlPathname = new URL(url).pathname;
        const lastSegment = urlPathname.substring(urlPathname.lastIndexOf('/') + 1);
        if (lastSegment) filename = lastSegment;
      } else {
        // Baca file lokal
        const fs = await import('fs/promises');
        const path = await import('path');
        const resolvedPath = path.resolve(url);
        const fileBuffer = await fs.readFile(resolvedPath);
        base64Data = fileBuffer.toString('base64');

        const ext = path.extname(resolvedPath).toLowerCase();
        if (ext === '.png') mimetype = 'image/png';
        else if (ext === '.gif') mimetype = 'image/gif';
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
        { headers: this.headers, timeout: this.timeoutMs }
      );
      return response.status === 200 || response.status === 201;
    } catch (error: any) {
      console.error(`[WAHA API ERROR] sendImage failed for ${targetChatId}:`, error?.response?.data || error.message);
      return false;
    }
  }

  /**
   * Menambahkan label ke chat menggunakan API WAHA baru (PUT /api/{session}/labels/chats/{chatId})
   */
  public async addLabel(chatId: string, labelName: string): Promise<boolean> {
    const targetChatId = await this.resolveActiveJid(chatId);

    if (this.shouldMock) {
      console.log(`[MOCK WAHA OUTBOUND] addLabel -> chatId: ${targetChatId} | label: "${labelName}"`);
      const existing = this.mockLabels.get(targetChatId) || [];
      if (!existing.includes(labelName)) {
        existing.push(labelName);
      }
      this.mockLabels.set(targetChatId, existing);
      return true;
    }

    try {
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

      if (!targetLabel) return false;

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
      return true;
    } catch (error: any) {
      console.error(`[WAHA API ERROR] addLabel failed for ${targetChatId}:`, error?.response?.data || error.message);
      return false;
    }
  }

  /**
   * Menghapus label dari chat menggunakan API WAHA baru (PUT /api/{session}/labels/chats/{chatId})
   */
  public async removeLabel(chatId: string, labelName: string): Promise<boolean> {
    const targetChatId = await this.resolveActiveJid(chatId);

    if (this.shouldMock) {
      console.log(`[MOCK WAHA OUTBOUND] removeLabel -> chatId: ${targetChatId} | label: "${labelName}"`);
      const existing = this.mockLabels.get(targetChatId) || [];
      const filtered = existing.filter(l => l !== labelName);
      this.mockLabels.set(targetChatId, filtered);
      return true;
    }

    try {
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
      return true;
    } catch (error: any) {
      console.error(`[WAHA API ERROR] removeLabel failed for ${targetChatId}:`, error?.response?.data || error.message);
      return false;
    }
  }

  /**
   * Mengambil daftar label yang ada pada chat menggunakan API WAHA baru (GET /api/{session}/labels/chats/{chatId})
   */
  public async getChatLabels(chatId: string): Promise<string[]> {
    const targetChatId = await this.resolveActiveJid(chatId);

    if (this.shouldMock) {
      return this.mockLabels.get(targetChatId) || [];
    }

    try {
      const response = await axios.get(
        `${this.baseUrl}/api/${this.session}/labels/chats/${targetChatId}`,
        { headers: this.headers, timeout: this.timeoutMs }
      );
      const chatLabels = response.data?.value || response.data || [];
      return chatLabels.map((l: any) => typeof l === 'string' ? l : l.name);
    } catch (error: any) {
      console.warn(`[WAHA API ERROR] getChatLabels failed for ${targetChatId}:`, error?.response?.data || error.message);
      return [];
    }
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
