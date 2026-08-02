import axios from 'axios';
import { getBrandIdentity } from '../config/brand';

class GoogleContactsService {
  private get clientId() {
    return process.env.GOOGLE_CLIENT_ID || '';
  }

  private get clientSecret() {
    return process.env.GOOGLE_CLIENT_SECRET || '';
  }

  private get refreshToken() {
    return process.env.GOOGLE_REFRESH_TOKEN || '';
  }

  private get isConfigured(): boolean {
    return !!(this.clientId && this.clientSecret && this.refreshToken);
  }

  private async getAccessToken(): Promise<string | null> {
    try {
      const response = await axios.post(
        'https://oauth2.googleapis.com/token',
        new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          refresh_token: this.refreshToken,
          grant_type: 'refresh_token',
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );
      return response.data?.access_token || null;
    } catch (error: any) {
      console.error('[GOOGLE CONTACTS ERROR] Failed to fetch access token:', error?.response?.data || error.message);
      return null;
    }
  }

  /**
   * Menyimpan kontak baru ke Google Contacts menggunakan Google People REST API.
   * Dijalankan secara asinkron tanpa menahan laju webhook.
   */
  public async createContact(phone: string, notifyName?: string): Promise<boolean> {
    if (!this.isConfigured) {
      // Lewati diam-diam jika kredensial Google OAuth belum disetel
      return false;
    }

    try {
      const accessToken = await this.getAccessToken();
      if (!accessToken) return false;

      // Bersihkan dan format nomor HP ke standar e.164 (misal: +6285794210526)
      const cleanPhone = phone.replace(/\D/g, '');
      const formattedPhone = cleanPhone.startsWith('62') ? `+${cleanPhone}` : cleanPhone;

      // Tentukan nama kontak: Gunakan notifyName dari WA jika ada, jika tidak, gunakan default
      const displayName = notifyName ? `${notifyName} (${getBrandIdentity().businessName})` : `Bunda ${cleanPhone} (${getBrandIdentity().businessName})`;

      console.log(`[GOOGLE CONTACTS] Mendaftarkan kontak ke Google: "${displayName}" (${formattedPhone})...`);

      await axios.post(
        'https://people.googleapis.com/v1/people:createContact',
        {
          names: [
            {
              givenName: displayName,
            },
          ],
          phoneNumbers: [
            {
              value: formattedPhone,
              type: 'mobile',
            },
          ],
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      console.log(`[GOOGLE CONTACTS SUCCESS] Berhasil menyimpan "${displayName}" ke Google Contacts.`);
      return true;
    } catch (error: any) {
      console.error('[GOOGLE CONTACTS ERROR] Gagal mendaftarkan kontak ke Google Contacts:', error?.response?.data || error.message);
      return false;
    }
  }
}

export const googleContactsService = new GoogleContactsService();
