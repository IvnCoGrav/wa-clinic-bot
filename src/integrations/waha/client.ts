import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

export interface IWahaClient {
  sendSeen(chatId: string, messageId?: string): Promise<boolean>;
  startTyping(chatId: string): Promise<boolean>;
  stopTyping(chatId: string): Promise<boolean>;
  sendText(chatId: string, text: string): Promise<boolean>;
  sendImage(chatId: string, url: string, caption?: string): Promise<boolean>;
  addLabel(chatId: string, labelName: string): Promise<boolean>;
  removeLabel(chatId: string, labelName: string): Promise<boolean>;
  getChatLabels(chatId: string): Promise<string[]>;
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
      (this.baseUrl.includes('localhost') && (!this.apiKey || this.apiKey === 'my_waha_api_key_secret'))
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
        mimetype = response.headers['content-type'] || 'image/jpeg';

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
}

export const wahaClient = new WahaClient();
