import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import crypto from 'crypto';

export class AuditService {
  /**
   * Mengubah API Key menjadi hash SHA-256 yang aman untuk disimpan (tidak bisa dibalik)
   */
  private hashApiKey(apiKey: string): string {
    return crypto.createHash('sha256').update(apiKey).digest('hex');
  }

  /**
   * Mencatat riwayat tindakan admin ke tabel audit_logs
   */
  public async logAdminAction(params: {
    apiKey?: string;
    adminIdentity?: string;
    action: string;
    targetId?: string;
    payload?: any;
    ipAddress?: string;
    tenantId?: string;
  }): Promise<void> {
    const { apiKey, adminIdentity, action, targetId, payload, ipAddress, tenantId } = params;

    // Task 3.2 (A-015b): tenantId wajib diberikan untuk isolasi multi-tenant yang ketat
    if (!tenantId) {
      throw new Error(`[Audit Service] tenantId wajib diberikan untuk action '${action}'.`);
    }

    const { sanitizeAuditPayload } = await import('./audit-payload-sanitizer');
    const sanitizedPayload = payload ? sanitizeAuditPayload(action, payload) : null;
    const payloadStr = sanitizedPayload ? JSON.stringify(sanitizedPayload) : null;

    const effectiveApiKey = apiKey || 'system-audit-key';
    const hashedKey = this.hashApiKey(effectiveApiKey);
    const shortHashedKey = hashedKey.substring(0, 16);

    // Cfg-009: retry 1x agar kegagalan sesaat tidak menghilangkan jejak audit.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await prisma.auditLog.create({
          data: {
            tenant_id: tenantId,
            admin_key: shortHashedKey,
            admin_identity: adminIdentity || 'Unknown Admin',
            action,
            target_id: targetId || null,
            payload: payloadStr,
            ip_address: ipAddress || null,
          },
        });
        console.log(`[Audit Service] Action '${action}' by '${adminIdentity || 'Unknown'}' logged successfully.`);
        return;
      } catch (err: any) {
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 100));
          continue;
        }
        console.error('[Audit Service] Failed to log admin action after retry:', err.message);
      }
    }
  }
}

export const auditService = new AuditService();
