import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

export interface IWahaClient {
  sendSeen(chatId: string, messageId?: string): Promise<boolean>;
  startTyping(chatId: string): Promise<boolean>;
  stopTyping(chatId: string): Promise<boolean>;
  sendText(chatId: string, text: string): Promise<boolean>;
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

  /**
   * Mengirim sinyal pesan telah dibaca (sendSeen).
   * Termasuk parameter messageId dan timeout guard.
   */
  public async sendSeen(chatId: string, messageId?: string): Promise<boolean> {
    if (this.baseUrl.includes('localhost') && (!this.apiKey || this.apiKey === 'my_waha_api_key_secret')) {
      console.log(`[MOCK WAHA] sendSeen -> chatId: ${chatId}, messageId: ${messageId}`);
      return true;
    }

    try {
      await axios.post(
        `${this.baseUrl}/api/sendSeen`,
        {
          chatId,
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
    if (this.baseUrl.includes('localhost') && (!this.apiKey || this.apiKey === 'my_waha_api_key_secret')) {
      console.log(`[MOCK WAHA] startTyping -> chatId: ${chatId}`);
      return true;
    }

    try {
      await axios.post(
        `${this.baseUrl}/api/startTyping`,
        {
          chatId,
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
    if (this.baseUrl.includes('localhost') && (!this.apiKey || this.apiKey === 'my_waha_api_key_secret')) {
      console.log(`[MOCK WAHA] stopTyping -> chatId: ${chatId}`);
      return true;
    }

    try {
      await axios.post(
        `${this.baseUrl}/api/stopTyping`,
        {
          chatId,
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
    if (this.baseUrl.includes('localhost') && (!this.apiKey || this.apiKey === 'my_waha_api_key_secret')) {
      console.log(`[MOCK WAHA OUTBOUND] sendText -> chatId: ${chatId} | text: "${text}"`);
      return true;
    }

    try {
      const response = await axios.post(
        `${this.baseUrl}/api/sendText`,
        {
          chatId,
          text,
          session: this.session,
        },
        { headers: this.headers, timeout: this.timeoutMs }
      );
      return response.status === 200 || response.status === 201;
    } catch (error: any) {
      console.error(`[WAHA API ERROR] sendText failed for ${chatId}:`, error?.response?.data || error.message);
      return false;
    }
  }
}

export const wahaClient = new WahaClient();
