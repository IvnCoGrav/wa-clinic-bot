import { IWahaClient } from '../integrations/waha/client';

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
    process.stdout.write('\r\x1b[K');
    console.log(`\x1b[36m\x1b[1mBot [IMAGE]:\x1b[0m \x1b[36m${caption || fileUrl}\x1b[0m\n`);
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

  public async getSessionStatus(): Promise<string> {
    return 'WORKING';
  }

  public async getChats(): Promise<import('../integrations/waha/client').WahaChat[]> {
    return [];
  }

  public async getMessages(chatId: string, limit?: number): Promise<import('../integrations/waha/client').WahaMessage[]> {
    return [];
  }
}
