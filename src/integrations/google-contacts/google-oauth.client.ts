import { google, Auth } from 'googleapis';
import { prisma } from '../../db/client';
import { DEFAULT_TENANT_ID } from '../../config/tenant';

const GOOGLE_CONTACTS_SCOPES = [
  'https://www.googleapis.com/auth/contacts',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/drive.file',
];

export interface GoogleOAuthTokens {
  accessToken: string | null;
  refreshToken: string | null;
  expiryDate: number | null;
  email: string | null;
}

export class GoogleOAuthClientManager {
  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;

  constructor() {
    this.clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || '';
    this.clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || '';
    this.redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI || '';
  }

  /**
   * Cek apakah platform credentials (Client ID & Secret) sudah terkonfigurasi di server
   */
  public isPlatformConfigured(): boolean {
    return Boolean(this.clientId && this.clientSecret && this.redirectUri);
  }

  /**
   * Buat instance OAuth2Client dasar
   */
  public createOAuth2Client(): any {
    return new google.auth.OAuth2(
      this.clientId,
      this.clientSecret,
      this.redirectUri
    );
  }

  /**
   * Generate URL Login Google OAuth untuk tenant tertentu
   */
  public generateAuthUrl(tenantId: string = DEFAULT_TENANT_ID): string {
    if (!this.isPlatformConfigured()) {
      throw new Error(
        'Google OAuth platform credentials belum dikonfigurasi di environment (GOOGLE_OAUTH_CLIENT_ID / SECRET / REDIRECT_URI)'
      );
    }

    const oauth2Client = this.createOAuth2Client();
    const statePayload = Buffer.from(
      JSON.stringify({ tenantId, timestamp: Date.now() })
    ).toString('base64');

    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent', // Memastikan selalu mendapatkan refresh_token
      scope: GOOGLE_CONTACTS_SCOPES,
      state: statePayload,
    });
  }

  /**
   * Verifikasi & ekstrak state tenant dari callback
   */
  public parseState(stateString?: string): { tenantId: string } {
    if (!stateString) {
      return { tenantId: DEFAULT_TENANT_ID };
    }
    try {
      const decoded = Buffer.from(stateString, 'base64').toString('utf-8');
      const parsed = JSON.parse(decoded);
      return { tenantId: parsed.tenantId || DEFAULT_TENANT_ID };
    } catch {
      return { tenantId: DEFAULT_TENANT_ID };
    }
  }

  /**
   * Tukar Authorization Code dengan Access & Refresh Tokens
   */
  public async exchangeCodeForTokens(code: string): Promise<GoogleOAuthTokens> {
    const oauth2Client = this.createOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Ambil info email akun yang terhubung
    let email: string | null = null;
    try {
      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client as any });
      const userInfo = await oauth2.userinfo.get();
      email = userInfo.data.email || null;
    } catch (err: any) {
      console.warn('[GoogleOAuth] Gagal mengambil email pengguna:', err?.message);
    }

    return {
      accessToken: tokens.access_token || null,
      refreshToken: tokens.refresh_token || null,
      expiryDate: tokens.expiry_date || null,
      email,
    };
  }

  /**
   * Dapatkan authenticated OAuth2Client untuk tenant tertentu dari database
   */
  public async getAuthenticatedClient(
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<any | null> {
    if (!this.isPlatformConfigured()) {
      return null;
    }

    let integration;
    try {
      integration = await prisma.tenantGoogleIntegration.findUnique({
        where: { tenant_id: tenantId },
      });
    } catch (err: any) {
      console.warn(`[GoogleOAuth] Gagal query DB untuk tenant ${tenantId}:`, err?.message);
      return null;
    }

    if (!integration || !integration.refresh_token) {
      return null;
    }

    const oauth2Client = this.createOAuth2Client();
    oauth2Client.setCredentials({
      refresh_token: integration.refresh_token,
      access_token: integration.access_token || undefined,
      expiry_date: integration.token_expiry ? integration.token_expiry.getTime() : undefined,
    });

    // Event listener saat token di-refresh otomatis oleh Google Auth Library
    oauth2Client.on('tokens', async (newTokens: any) => {
      try {
        await prisma.tenantGoogleIntegration.update({
          where: { tenant_id: tenantId },
          data: {
            access_token: newTokens.access_token || undefined,
            refresh_token: newTokens.refresh_token || undefined,
            token_expiry: newTokens.expiry_date ? new Date(newTokens.expiry_date) : undefined,
          },
        });
      } catch (err: any) {
        console.error(`[GoogleOAuth] Gagal update token otomatis ke DB:`, err?.message);
      }
    });

    return oauth2Client;
  }

  /**
   * Revoke token dan putus integrasi
   */
  public async revokeAndDisconnect(
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<boolean> {
    const integration = await prisma.tenantGoogleIntegration.findUnique({
      where: { tenant_id: tenantId },
    });

    if (!integration) return true;

    if (integration.access_token || integration.refresh_token) {
      try {
        const oauth2Client = this.createOAuth2Client();
        const tokenToRevoke = integration.access_token || integration.refresh_token;
        if (tokenToRevoke) {
          await oauth2Client.revokeToken(tokenToRevoke);
        }
      } catch (err: any) {
        console.warn(`[GoogleOAuth] Revoke token warning (non-fatal):`, err?.message);
      }
    }

    await prisma.tenantGoogleIntegration.update({
      where: { tenant_id: tenantId },
      data: {
        is_enabled: false,
        connected_email: null,
        refresh_token: null,
        access_token: null,
        token_expiry: null,
      },
    });

    return true;
  }
}

export const googleOAuthClientManager = new GoogleOAuthClientManager();
