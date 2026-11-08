import { prisma } from '../../db/client';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { FOLLOWUP_ROLLING_TEMPLATES } from '../../config/followup-templates';
import { findForbiddenPlaceholders } from '../../utils/followup-placeholder';

/**
 * Mengambil semua template follow-up dari database (dengan fallback ke hardcode default).
 * Jika DB tidak punya record untuk (type, variant), pakai template default.
 */
export async function getAllTemplates(tenantId: string = DEFAULT_TENANT_ID): Promise<Array<{
  id: string | null;
  type: string;
  variant: number;
  text: string;
  isDefault: boolean;
}>> {
  try {
    const dbTemplates = await prisma.followUpTemplate.findMany({
      where: { tenant_id: tenantId },
      orderBy: [{ type: 'asc' }, { variant: 'asc' }],
    });

    const result: Array<{ id: string | null; type: string; variant: number; text: string; isDefault: boolean }> = [];
    for (const [type, variants] of Object.entries(FOLLOWUP_ROLLING_TEMPLATES)) {
      variants.forEach((fn, idx) => {
        const db = dbTemplates.find((t) => t.type === type && t.variant === idx + 1);
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
    console.error('[FollowUp Service] Failed to load templates from DB, using defaults:', err);
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
export async function saveTemplate(
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
    console.log(`[FollowUp Service] Saved template ${type} variant ${variant}.`);
  } catch (err) {
    console.error('[FollowUp Service] Failed to save template:', err);
    throw err;
  }
}

/**
 * Menghapus template custom (kembali ke default hardcode).
 */
export async function resetTemplate(type: string, variant: number, tenantId: string = DEFAULT_TENANT_ID): Promise<void> {
  try {
    await prisma.followUpTemplate.deleteMany({
      where: { tenant_id: tenantId, type, variant },
    });
    console.log(`[FollowUp Service] Reset template ${type} variant ${variant} to default.`);
  } catch (err) {
    console.error('[FollowUp Service] Failed to reset template:', err);
  }
}
