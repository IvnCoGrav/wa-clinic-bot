import { google, Auth } from 'googleapis';
import crypto from 'crypto';
import { prisma } from '../../db/client';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { safeCompare } from '../../utils/auth';
import { decryptSecretCompat, encryptSecretIfPossible } from '../../utils/encryption';

const GOOGLE_CONTACTS_SCOPES = [
  'https://www.googleapis.com/auth/contacts',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/drive.file',
];

// SEC-AUDIT-10: umur maksimum state OAuth (batas jendela replay Login CSRF).
const STATE_TTL_MS = 15 * 60 * 1000;

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
   * Secret penandatangan state OAuth (anti-CSRF / anti-tamper).
   * Deterministik dari env, tanpa dependency baru.
   */
  private stateSecret(): string {
    return process.env.GOOGLE_OAUTH_STATE_SECRET || process.env.ADMIN_API_KEY || '';
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
    const secret = this.stateSecret();
    if (!secret) {
      throw new Error(
        'Google OAuth state secret belum dikonfigurasi (GOOGLE_OAUTH_STATE_SECRET / ADMIN_API_KEY)'
      );
    }

    const oauth2Client = this.createOAuth2Client();
    // SEC-AUDIT-10: state = payload.base64url + HMAC-SHA256 (nonce anti-replay).
    // Tanpa signature, penyerang bisa memalsukan tenantId (Login CSRF lintas-tenant).
    const payload = {
      tenantId,
      timestamp: Date.now(),
      nonce: crypto.randomBytes(8).toString('hex'),
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(encoded).digest('hex');
    const statePayload = `${encoded}.${sig}`;

    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent', // Memastikan selalu mendapatkan refresh_token
      scope: GOOGLE_CONTACTS_SCOPES,
      state: statePayload,
    });
  }

  /**
   * Verifikasi & ekstrak state tenant dari callback — fail-closed.
   * State tak bertanda tangan / kadaluarsa / rusak → throw (caller redirect error).
   */
  public parseState(stateString?: string): { tenantId: string } {
    if (!stateString) {
      throw new Error('Missing OAuth state');
    }
    const secret = this.stateSecret();
    if (!secret) {
      throw new Error('OAuth state secret not configured');
    }
    const dot = stateString.lastIndexOf('.');
    if (dot <= 0) {
      throw new Error('Invalid OAuth state format');
    }
    const encoded = stateString.slice(0, dot);
    const sig = stateString.slice(dot + 1);
    const expected = crypto.createHmac('sha256', secret).update(encoded).digest('hex');
    if (!sig || !safeCompare(sig, expected)) {
      throw new Error('Invalid OAuth state signature');
    }
    let parsed: any;
    try {
      parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8'));
    } catch {
      throw new Error('Invalid OAuth state payload');
    }
    if (
      !parsed ||
      typeof parsed.tenantId !== 'string' ||
      !parsed.tenantId ||
      typeof parsed.timestamp !== 'number' ||
      Date.now() - parsed.timestamp > STATE_TTL_MS
    ) {
      throw new Error('Expired or invalid OAuth state');
    }
    return { tenantId: parsed.tenantId };
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
    // SEC-AUDIT-11: dual-read — decrypt bila terenkripsi, fallback plaintext legacy.
    oauth2Client.setCredentials({
      refresh_token: decryptSecretCompat(integration.refresh_token) || undefined,
      access_token: decryptSecretCompat(integration.access_token) || undefined,
      expiry_date: integration.token_expiry ? integration.token_expiry.getTime() : undefined,
    });

    // Event listener saat token di-refresh otomatis oleh Google Auth Library
    oauth2Client.on('tokens', async (newTokens: any) => {
      try {
        await prisma.tenantGoogleIntegration.update({
          where: { tenant_id: tenantId },
          data: {
            access_token: newTokens.access_token ? encryptSecretIfPossible(newTokens.access_token) : undefined,
            refresh_token: newTokens.refresh_token ? encryptSecretIfPossible(newTokens.refresh_token) : undefined,
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
        // SEC-AUDIT-11: revoke memakai token plaintext hasil decrypt.
        const tokenToRevoke = decryptSecretCompat(integration.access_token) || decryptSecretCompat(integration.refresh_token);
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
