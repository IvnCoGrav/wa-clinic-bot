import { IWahaClient, MOCK_QR_BASE64 } from '../integrations/waha/client';

/**
 * Mock WAHA Client untuk CLI Chat Simulator.
 * Mensimulasikan output terminal real-time tanpa panggil HTTP API ke WAHA server.
 */
export class MockWAHAClient implements IWahaClient {
  /**
   * Tampilkan indikator centang dua biru / read receipt ([✓✓ read])
   */
  public async sendSeen(chatId: string, messageId?: string): Promise<boolean> {
    process.stdout.write('\x1b[90m[✓✓ read]\x1b[0m\n');
    return true;
  }

  /**
   * Tampilkan indikator status mengetik real-time di baris terminal yang sama
   */
  public async startTyping(chatId: string): Promise<boolean> {
    process.stdout.write('\x1b[90m[bot sedang mengetik...]\x1b[0m');
    return true;
  }

  /**
   * Bersihkan baris indikator status mengetik dari layar terminal
   */
  public async stopTyping(chatId: string): Promise<boolean> {
    process.stdout.write('\r\x1b[K');
    return true;
  }

  /**
   * Tampilkan pesan outbound dari bot dengan warna Cyan yang kontras dan jelas
   */
  public async sendText(chatId: string, text: string): Promise<boolean> {
    // Pastikan baris sisa indikator ngetik bersih lebih dulu
    process.stdout.write('\r\x1b[K');
    console.log(`\x1b[36m\x1b[1mBot:\x1b[0m \x1b[36m${text}\x1b[0m\n`);
    return true;
  }

  public async sendImage(chatId: string, fileUrl: string, caption?: string): Promise<boolean> {
    try {
      process.stdout.write('\r\x1b[K');
      console.log(`\x1b[36m\x1b[1mBot [🖼️ MEDIA GAMBAR TERKIRIM]:\x1b[0m \x1b[36m${fileUrl}\x1b[0m`);
      if (caption) {
        console.log(`\x1b[36mCaption: ${caption}\x1b[0m\n`);
      }
      return true;
    } catch (err: any) {
      console.error('\x1b[31m[CLI ERROR] sendImage gagal:\x1b[0m', err?.message || err);
      return false;
    }
  }

  public async downloadMedia(messageId: string, chatId: string): Promise<Buffer | null> {
    return Buffer.from(MOCK_QR_BASE64, 'base64');
  }

  public async deleteMessage(chatId: string, messageId: string, everyone = true): Promise<boolean> {
    process.stdout.write(`\x1b[90m[🗑️ Pesan ${messageId} ditarik untuk semua orang]\x1b[0m\n`);
    return true;
  }

  public async addLabel(chatId: string, labelId: string): Promise<boolean> {
    return true;
  }

  public async removeLabel(chatId: string, labelId: string): Promise<boolean> {
    return true;
  }

  public async getChatLabels(chatId: string): Promise<string[]> {
    return [];
  }

  public async getChatLabelsOrNull(chatId: string): Promise<string[] | null> {
    return [];
  }


  public async getSessionStatus(session?: string): Promise<string> {
    return 'WORKING';
  }

  public async startSession(session?: string): Promise<string> {
    return 'WORKING';
  }

  public async stopSession(session?: string): Promise<boolean> {
    return true;
  }

  public async getSession(session?: string): Promise<any | null> {
    return { name: session, status: 'WORKING', config: {} };
  }

  public async deleteSession(session?: string): Promise<boolean> {
    return true;
  }

  public async createSession(session?: string, config?: any): Promise<string> {
    return 'CREATED';
  }

  public async getAuthQr(session?: string): Promise<import('../integrations/waha/client').WahaQr | null> {
    return { mimetype: 'image/png', data: MOCK_QR_BASE64 };
  }

  public async getChats(): Promise<import('../integrations/waha/client').WahaChat[]> {
    return [];
  }

  public async getMessages(chatId: string, limit?: number): Promise<import('../integrations/waha/client').WahaMessage[]> {
    return [];
  }

  public async getContact(phone: string): Promise<import('../integrations/waha/client').WahaContact | null> {
    return null;
  }

  public async getProfilePicture(_phone: string, _session?: string): Promise<string | null> {
    return null;
  }
}
