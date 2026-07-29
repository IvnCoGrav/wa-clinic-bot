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
    try {
      const { apiKey, adminIdentity, action, targetId, payload, ipAddress, tenantId = DEFAULT_TENANT_ID } = params;
      const hashedKey = this.hashApiKey(apiKey);
      // Simpan hash parsial agar tetap unik dan aman di log/db
      const shortHashedKey = hashedKey.substring(0, 16);

      const payloadStr = payload ? JSON.stringify(payload) : null;

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
    } catch (err: any) {
      console.error('[Audit Service] Failed to log admin action:', err.message);
    }
  }
}

export const auditService = new AuditService();
