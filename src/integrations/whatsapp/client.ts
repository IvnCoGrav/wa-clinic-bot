import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

/**
 * Service untuk mengirim pesan balasan otomatis ke customer via Meta WhatsApp Cloud API.
 */
export class WhatsAppClient {
  private token: string;
  private phoneNumberId: string;
  private baseUrl: string;

  constructor() {
    this.token = process.env.WHATSAPP_TOKEN || '';
    this.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
    this.baseUrl = `https://graph.facebook.com/v20.0/${this.phoneNumberId}/messages`;
  }

  /**
   * Kirim pesan teks ke nomor WhatsApp customer.
   * 
   * @param to Nomor HP tujuan (format internasional: 628123456789)
   * @param messageText Isi pesan yang akan dikirim
   */
  public async sendTextMessage(to: string, messageText: string): Promise<boolean> {
    // Jika token mock / testing mode, cukup log pengiriman ke console
    if (!this.token || this.token === 'mock_token') {
      console.log(`[MOCK WA OUTBOUND] To: ${to} | Message: "${messageText}"`);
      return true;
    }

    try {
      const response = await axios.post(
        this.baseUrl,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'text',
          text: {
            preview_url: true,
            body: messageText,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return response.status === 200 || response.status === 201;
    } catch (error: any) {
      console.error(`Error sending WA message to ${to}:`, error?.response?.data || error.message);
      return false;
    }
  }
}

export const whatsAppClient = new WhatsAppClient();
