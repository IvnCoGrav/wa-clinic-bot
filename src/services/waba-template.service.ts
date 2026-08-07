import { prisma } from '../db/client';
import { TemplateComponent, TemplateParam } from '../integrations/whatsapp/gateway.types';

export type WabaTemplateCategory = 'UTILITY' | 'MARKETING';
export type WabaTemplateStatus = 'APPROVED' | 'PENDING' | 'REJECTED' | 'PAUSED';

export interface WabaTemplateMapping {
  templateName: string;
  category: WabaTemplateCategory;
  languageCode: string;
  status: WabaTemplateStatus;
  isActive: boolean;
}

export interface WabaTemplateParams {
  name?: string;
  time?: string;
  babyName?: string;
  treatmentName?: string;
}

export interface WabaTemplateMeta {
  templateName: string;
  category: WabaTemplateCategory;
}

const DEFAULT_TEMPLATE_NAMES: Record<string, WabaTemplateMeta> = {
  REMINDER_H0: { templateName: 'reminder_treatment', category: 'UTILITY' },
  REVIEW_H1_BABY: { templateName: 'review_h1_baby', category: 'UTILITY' },
  REVIEW_H1_MOMS: { templateName: 'review_h1_moms', category: 'UTILITY' },
  NO_PURCHASE_1: { templateName: 'followup_no_purchase_1', category: 'MARKETING' },
  NO_PURCHASE_2: { templateName: 'followup_no_purchase_2', category: 'MARKETING' },
  NO_PURCHASE_3: { templateName: 'followup_no_purchase_3', category: 'MARKETING' },
  NEXT_TREATMENT_1: { templateName: 'followup_next_treatment_1', category: 'MARKETING' },
  NEXT_TREATMENT_2: { templateName: 'followup_next_treatment_2', category: 'MARKETING' },
  NEXT_TREATMENT_3: { templateName: 'followup_next_treatment_3', category: 'MARKETING' },
  MILESTONE_3M: { templateName: 'milestone_3m', category: 'MARKETING' },
  MILESTONE_6M: { templateName: 'milestone_6m', category: 'MARKETING' },
  MILESTONE_9M: { templateName: 'milestone_9m', category: 'MARKETING' },
  MILESTONE_12M: { templateName: 'milestone_12m', category: 'MARKETING' },
};

export class WabaTemplateService {
  /**
   * Resolve mapping HSM template per tenant dari DB (tabel waba_templates).
   * Fallback ke DEFAULT_TEMPLATE_NAMES (safety net) hanya saat DB tidak punya
   * record untuk (type, variant). Sumber kebenaran tetap DB per tenant.
   */
  public async getTemplateMapping(
    tenantId: string,
    type: string,
    variant: number
  ): Promise<WabaTemplateMapping> {
    const defaultMeta = DEFAULT_TEMPLATE_NAMES[type];

    try {
      const row = await prisma.wabaTemplate.findUnique({
        where: { tenant_id_type_variant: { tenant_id: tenantId, type, variant } },
      });

      if (row) {
        return {
          templateName: row.template_name,
          category: (row.category as WabaTemplateCategory) || defaultMeta?.category || 'UTILITY',
          languageCode: row.language_code || 'id',
          status: (row.status as WabaTemplateStatus) || 'APPROVED',
          isActive: row.is_active,
        };
      }
    } catch (err) {
      console.error('[WabaTemplate Service] DB lookup failed, using default mapping:', err);
    }

    return {
      templateName: defaultMeta?.templateName || `followup_${type.toLowerCase()}`,
      category: defaultMeta?.category || 'UTILITY',
      languageCode: 'id',
      status: 'APPROVED',
      isActive: true,
    };
  }

  /**
   * Menyimpan/update mapping HSM template per tenant (upsert).
   */
  public async saveTemplateMapping(
    tenantId: string,
    type: string,
    variant: number,
    mapping: { templateName: string; category: WabaTemplateCategory; languageCode?: string; status?: WabaTemplateStatus; isActive?: boolean }
  ): Promise<void> {
    await prisma.wabaTemplate.upsert({
      where: { tenant_id_type_variant: { tenant_id: tenantId, type, variant } },
      update: {
        template_name: mapping.templateName,
        category: mapping.category,
        language_code: mapping.languageCode || 'id',
        status: mapping.status || 'APPROVED',
        is_active: mapping.isActive ?? true,
        updated_at: new Date(),
      },
      create: {
        tenant_id: tenantId,
        type,
        variant,
        template_name: mapping.templateName,
        category: mapping.category,
        language_code: mapping.languageCode || 'id',
        status: mapping.status || 'APPROVED',
        is_active: mapping.isActive ?? true,
      },
    });
  }

  /**
   * Mengambil seluruh mapping HSM (9 stage follow-up) untuk tenant tertentu,
   * menggabungkan record DB dengan default (DB menang, default cadangan).
   * Dipakai dashboard untuk status indicator template.
   */
  public async getAllTemplateMappings(tenantId: string): Promise<Array<{ type: string; variant: number; templateName: string; category: WabaTemplateCategory; status: WabaTemplateStatus; isActive: boolean; isDefault: boolean }>> {
    const rows = await prisma.wabaTemplate.findMany({
      where: { tenant_id: tenantId },
    }).catch((err) => {
      console.error('[WabaTemplate Service] getAllTemplateMappings DB failed, using defaults:', err);
      return [];
    });

    return Object.keys(DEFAULT_TEMPLATE_NAMES).map((type) => {
      const variant = 1;
      const row = rows.find((r) => r.type === type && r.variant === variant);
      const def = DEFAULT_TEMPLATE_NAMES[type];
      if (row) {
        return {
          type,
          variant,
          templateName: row.template_name,
          category: (row.category as WabaTemplateCategory) || def.category,
          status: (row.status as WabaTemplateStatus) || 'APPROVED',
          isActive: row.is_active,
          isDefault: false,
        };
      }
      return {
        type,
        variant,
        templateName: def.templateName,
        category: def.category,
        status: 'APPROVED' as WabaTemplateStatus,
        isActive: true,
        isDefault: true,
      };
    });
  }

  /**
   * Template layak dikirim hanya jika status APPROVED dan is_active.
   */
  public isUsable(mapping: WabaTemplateMapping): boolean {
    return mapping.isActive && mapping.status === 'APPROVED';
  }

  /**
   * Membangun komponen body HSM dari parameter pesan. Urutan sesuai placeholder
   * {{1}}, {{2}}, {{3}} di template Meta. Nilai falsy dilewati agar parameter
   * komponen tidak mengirim placeholder kosong.
   */
  public buildBodyComponents(params: WabaTemplateParams): TemplateComponent[] {
    const bodyParams: TemplateParam[] = [];
    if (params.name) bodyParams.push({ type: 'text', value: params.name });
    if (params.time) bodyParams.push({ type: 'text', value: params.time });
    if (params.treatmentName) bodyParams.push({ type: 'text', value: params.treatmentName });
    if (params.babyName) bodyParams.push({ type: 'text', value: params.babyName });

    if (bodyParams.length === 0) return [];
    return [{ type: 'body', parameters: bodyParams }];
  }
}

export const wabaTemplateService = new WabaTemplateService();
