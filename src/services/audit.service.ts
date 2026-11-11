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
    apiKey: string;
    adminIdentity?: string;
    action: string;
    targetId?: string;
    payload?: any;
    ipAddress?: string;
    tenantId?: string;
  }): Promise<void> {
    const { apiKey, adminIdentity, action, targetId, payload, ipAddress, tenantId } = params;
    // Cfg-009: tenant audit yang tidak eksplisit adalah sumber salah catat.
    if (!tenantId) {
      console.warn(`[Audit Service] tenantId tidak diberikan untuk action '${action}' — memakai default-tenant.`);
    }
    const effectiveTenant = tenantId || DEFAULT_TENANT_ID;
    const hashedKey = this.hashApiKey(apiKey);
    const shortHashedKey = hashedKey.substring(0, 16);
    const payloadStr = payload ? JSON.stringify(payload) : null;

    // Cfg-009: retry 1x agar kegagalan sesaat tidak menghilangkan jejak audit.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await prisma.auditLog.create({
          data: {
            tenant_id: effectiveTenant,
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
