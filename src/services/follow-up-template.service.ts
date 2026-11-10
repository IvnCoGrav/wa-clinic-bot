import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { FOLLOWUP_ROLLING_TEMPLATES } from '../config/followup-templates';
import { findForbiddenPlaceholders } from '../utils/followup-placeholder';

export interface FollowUpTemplateItem {
  id: string | null;
  type: string;
  variant: number;
  text: string;
  isDefault: boolean;
}

export class FollowUpTemplateService {
  /**
   * Mengambil semua template follow-up yang digabung antara DB dan default.
   */
  public async getAllTemplates(tenantId: string = DEFAULT_TENANT_ID): Promise<FollowUpTemplateItem[]> {
    try {
      const dbTemplates = await prisma.followUpTemplate.findMany({
        where: { tenant_id: tenantId },
        orderBy: [{ type: 'asc' }, { variant: 'asc' }],
      });

      const dbList = Array.isArray(dbTemplates) ? dbTemplates : [];
      // Merge dengan default
      const result: FollowUpTemplateItem[] = [];
      for (const [type, variants] of Object.entries(FOLLOWUP_ROLLING_TEMPLATES)) {
        variants.forEach((fn, idx) => {
          const db = dbList.find((t) => t.type === type && t.variant === idx + 1);
          result.push({
            id: db?.id || null,
            type,
            variant: idx + 1,
            text: db?.text || fn({ name: '{name}', time: '{time}', babyName: '{babyName}' }),
            isDefault: !db,
          });
        });
      }
      return result;
    } catch (err) {
      console.error('[FollowUp Template] Failed to load templates from DB, using defaults:', err);
      return Object.entries(FOLLOWUP_ROLLING_TEMPLATES).flatMap(([type, variants]) =>
        variants.map((fn, idx) => ({
          id: null,
          type,
          variant: idx + 1,
          text: fn({ name: '{name}', time: '{time}', babyName: '{babyName}' }),
          isDefault: true,
        }))
      );
    }
  }

  /**
   * Menyimpan template custom (upsert) untuk type + variant tertentu.
   */
  public async saveTemplate(
    type: string,
    variant: number,
    text: string,
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<void> {
    const forbidden = findForbiddenPlaceholders(type, text);
    if (forbidden.length > 0) {
      throw new Error(
        `Template ${type} tidak boleh memuat variabel ${forbidden.join(', ')} (kategori MOMS: narasi bayi dilarang).`
      );
    }
    try {
      await prisma.followUpTemplate.upsert({
        where: {
          tenant_id_type_variant: { tenant_id: tenantId, type, variant },
        },
        update: { text, updated_at: new Date() },
        create: { tenant_id: tenantId, type, variant, text },
      });
      console.log(`[FollowUp Template] Saved template ${type} variant ${variant}.`);
    } catch (err) {
      console.error('[FollowUp Template] Failed to save template:', err);
      throw err;
    }
  }

  /**
   * Menghapus template custom (kembali ke default hardcode).
   */
  public async resetTemplate(type: string, variant: number, tenantId: string = DEFAULT_TENANT_ID): Promise<void> {
    try {
      await prisma.followUpTemplate.deleteMany({
        where: { tenant_id: tenantId, type, variant },
      });
      console.log(`[FollowUp Template] Reset template ${type} variant ${variant} to default.`);
    } catch (err) {
      console.error('[FollowUp Template] Failed to reset template:', err);
    }
  }
}

export const followUpTemplateService = new FollowUpTemplateService();
