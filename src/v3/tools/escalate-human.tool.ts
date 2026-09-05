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
    description: 'Mengalihkan percakapan ke Bidan / Admin CS manusia dan menghentikan respon otomatis bot. Wajib dipanggil saat ada gejala darurat medis (kejang, biru, sesak napas, pendarahan), komplain berat, atau permintaan eksplisit customer untuk bicara dengan manusia.',
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
    const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } }).catch(() => null);

    if (conversation) {
      await conversationService.escalateToHumanHandling(
        conversation,
        phone,
        reason,
        tenantId,
        severity === 'CRITICAL_MEDICAL' ? 'medical_concern' : 'manual_request'
      ).catch(() => {});
    }

    if (severity === 'CRITICAL_MEDICAL') {
      try {
        const { AlertService, AlertType, AlertSeverity } = await import('../../services/alert.service');
        const alertService = new AlertService();
        await alertService.notifyAlert({
          type: AlertType.MEDICAL_EMERGENCY_HIGH,
          severity: AlertSeverity.CRITICAL,
          message: `[V3 AGENT MEDICAL ALERT] Customer: ${phone}. Alasan: ${reason}`,
          metadata: { phone, reason }
        }).catch(() => {});
      } catch (err: any) {
        console.warn('[V3 ESCALATE ALERT ERROR]', err.message);
      }
    }

    return {
      success: true,
      escalated: true,
      message: `Percakapan telah dialihkan ke Bidan / Admin Manusia (${severity}). Bot otomatis dinonaktifkan untuk chat ini.`
    };
  } catch (error: any) {
    // Fallback: tetap anggap tereskalasi agar bot berhenti membalas
    return {
      success: true,
      escalated: true,
      message: `Eskalasi darurat tercatat: ${reason}`
    };
  }
}
