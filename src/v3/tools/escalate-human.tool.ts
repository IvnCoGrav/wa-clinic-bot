import { conversationService } from '../../services/conversation.service';
import { DEFAULT_TENANT_ID } from '../../config/tenant';

export interface EscalateHumanInput {
  conversationId: string;
  phone: string;
  reason: string;
  severity: 'CRITICAL_MEDICAL' | 'CUSTOMER_REQUEST' | 'MANUAL_HANDLING';
  tenantId?: string;
}

export interface EscalateHumanOutput {
  success: boolean;
  escalated: boolean;
  message: string;
}

export const ESCALATE_HUMAN_TOOL_SCHEMA = {
  type: 'function',
  function: {
    name: 'escalate_to_human',
    description: 'Mengalihkan percakapan ke tim Bidan kami (manusia) dan menghentikan respon otomatis bot. Wajib dipanggil saat ada gejala darurat medis, komplain berat, permintaan eksplisit customer untuk bicara dengan manusia, atau topik di luar layanan klinik yang tidak ter-grounding ke katalog layanan, knowledge base, maupun kebijakan klinik.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Alasan rinci pengalihan ke manusia (misal: "Gejala darurat medis: bayi kejang", "Customer minta bicara langsung dengan admin").'
        },
        severity: {
          type: 'string',
          enum: ['CRITICAL_MEDICAL', 'CUSTOMER_REQUEST', 'MANUAL_HANDLING'],
          description: 'Tingkat urgensi pengalihan.'
        },
        commitment: {
          type: 'string',
          enum: ['EXPLORING', 'CONSIDERING', 'COMMITTED'],
          description: 'Penilaian SEMANTIK atas seluruh percakapan: EXPLORING (bertanya/menjelajah), CONSIDERING (menimbang/minat), COMMITTED (sudah memutuskan mengambil layanan). Berdasarkan makna & konteks.'
        }
      },
      required: ['reason', 'severity']
    }
  }
};

export async function executeEscalateHuman(input: EscalateHumanInput): Promise<EscalateHumanOutput> {
  const { conversationId, phone, reason, severity, tenantId = DEFAULT_TENANT_ID } = input;

  try {
    const { prisma } = await import('../../db/client');
    // Tenant-scoped lookup (RC-01): DILARANG mengambil conversation lintas tenant.
    const conversation = await prisma.conversation
      .findFirst({ where: { id: conversationId, tenant_id: tenantId } });

    // Stage 5 Fase 4 (RC-04): DILARANG melaporkan sukses tanpa handoff durable.
    // Bila conversation tidak ditemukan → kembalikan GAGAL (bukan false success).
    if (!conversation) {
      return {
        success: false,
        escalated: false,
        message: `Eskalasi gagal: conversation ${conversationId} tidak ditemukan untuk tenant ini.`,
      };
    }

    await conversationService.escalateToHumanHandling(
      conversation,
      phone,
      reason,
      tenantId,
      severity === 'CRITICAL_MEDICAL' ? 'medical_concern' : 'manual_request'
    );

    if (severity === 'CRITICAL_MEDICAL') {
      try {
        const { AlertService, AlertType, AlertSeverity } = await import('../../services/alert.service');
        const alertService = new AlertService();
        await alertService.notifyAlert({
          type: AlertType.MEDICAL_EMERGENCY_HIGH,
          severity: AlertSeverity.CRITICAL,
          message: `[V3 AGENT MEDICAL ALERT] Customer: ${phone}. Alasan: ${reason}`,
          metadata: { phone, reason }
        });
      } catch (err: any) {
        console.warn(JSON.stringify({ event: 'V3_ESCALATE_ALERT_ERROR', tenantId, conversationId, error: err.message, timestamp: new Date().toISOString() }));
      }
    }

    return {
      success: true,
      escalated: true,
      message: `Percakapan telah dialihkan ke Bidan / Admin Manusia (${severity}). Bot otomatis dinonaktifkan untuk chat ini.`
    };
  } catch (error: any) {
    // Stage 5 Fase 4: JANGAN lapor sukses palsu. Persist gagal = eskalasi gagal.
    console.error(JSON.stringify({ event: 'V3_ESCALATE_PERSIST_FAILED', tenantId, conversationId, error: error?.message, timestamp: new Date().toISOString() }));
    return {
      success: false,
      escalated: false,
      message: `Eskalasi gagal dicatat (${error?.message || 'error'}). Tim tetap diberi tahu via jalur eskalasi mesin.`,
    };
  }
}
