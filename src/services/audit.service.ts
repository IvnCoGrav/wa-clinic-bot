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
    tenantId: string;
  }): Promise<void> {
    // Fail-soft total (A-002): audit adalah efek samping non-kritis pasca-aksi operasional (kirim WA / DB write),
    // sehingga seluruh badan method tidak boleh pernah melempar exception yang menjatuhkan HTTP response jadi 500.
    try {
      const { apiKey, adminIdentity, action, targetId, payload, ipAddress, tenantId } = params;

      // Task 3.2 (A-015b) + P0-1 Hotfix: tenantId wajib secara kontrak TypeScript.
      // Di runtime, bila caller untyped/legacy tetap mengirim kosong, fail-soft ke DEFAULT_TENANT_ID
      // + console.error keras agar aksi operasional (DB write / WA reply) tidak pernah berakhir HTTP 500.
      const cleanTenant = typeof tenantId === 'string' ? tenantId.trim() : '';
      if (!cleanTenant) {
        console.error(
          `[AUDIT_FAILURE] [Audit Service] CRITICAL: tenantId kosong untuk action '${action}' — fallback ke '${DEFAULT_TENANT_ID}' (fail-soft agar route tidak 500).`
        );
      }
      const effectiveTenant = cleanTenant || DEFAULT_TENANT_ID;

      let payloadStr: string | null = null;
      if (payload !== undefined && payload !== null) {
        try {
          const { sanitizeAuditPayload } = await import('./audit-payload-sanitizer');
          const sanitizedPayload = sanitizeAuditPayload(action, payload);
          payloadStr = JSON.stringify(sanitizedPayload, (_key, val) =>
            typeof val === 'bigint' ? val.toString() : val
          );
        } catch (serializeErr: unknown) {
          const errMsg = serializeErr instanceof Error ? serializeErr.message : String(serializeErr);
          console.error(
            `[AUDIT_FAILURE] [Audit Service] Gagal sanitasi/serialisasi payload untuk action '${action}':`,
            errMsg
          );
          payloadStr = JSON.stringify({ _auditSerializationError: true, action });
        }
      }

      const effectiveApiKey =
        typeof apiKey === 'string' && apiKey.trim().length > 0
          ? apiKey
          : 'system-audit-key';
      const hashedKey = this.hashApiKey(effectiveApiKey);
      const shortHashedKey = hashedKey.substring(0, 16);

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
        } catch (err: unknown) {
          if (attempt === 0) {
            await new Promise((r) => setTimeout(r, 100));
            continue;
          }
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error('[AUDIT_FAILURE] [Audit Service] Failed to log admin action after retry:', errMsg);
        }
      }
    } catch (fatalErr: unknown) {
      const errMsg = fatalErr instanceof Error ? fatalErr.message : String(fatalErr);
      console.error('[AUDIT_FAILURE] [Audit Service] Unexpected fatal error (fail-soft):', errMsg);
    }
  }
}

// Penjaga compile-time (A-007): tsc wajib gagal bila tenantId pernah diubah kembali menjadi opsional.
type _AssertAuditTenantRequired = undefined extends Parameters<AuditService['logAdminAction']>[0]['tenantId']
  ? never
  : true;
const _assertAuditTenantRequired: _AssertAuditTenantRequired = true;
void _assertAuditTenantRequired;

export const auditService = new AuditService();
