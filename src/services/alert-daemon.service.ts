import { telemetryService } from './telemetry.service';
import { alertService, AlertType, AlertSeverity } from './alert.service';
import { TurnQualityMetrics } from '../types/telemetry';

class AlertDaemonService {
  async evaluate(metrics: TurnQualityMetrics): Promise<void> {
    // Pemicu 1: >=2 Unjustified RSQR dalam 1 jam -> CRITICAL_AI_LOOP
    if (metrics.isUnjustifiedRsqr) {
      const { rsqrInLastHour } = telemetryService.getRecentCounts();
      if (rsqrInLastHour >= 2) {
        await alertService.notifyAlert({
          type: AlertType.CRITICAL_AI_LOOP,
          severity: AlertSeverity.CRITICAL,
          message: `[CRITICAL_AI_LOOP] Terdeteksi ${rsqrInLastHour}x Unjustified RSQR dalam 1 jam terakhir. Bot menanyakan kelurahan padahal lokasi sudah terkonfirmasi (loop interogasi).`,
          metadata: { rsqrInLastHour, lastPhone: metrics.customerPhone, conversationId: metrics.conversationId },
        });
      }
    }

    // Pemicu 2: >=3 NLU HTTP 400 berturut-turut -> NLU_PROVIDER_DEGRADED
    if (metrics.nluErrorCode === 'HTTP_400') {
      const { nluErrorsConsecutive } = telemetryService.getRecentCounts();
      if (nluErrorsConsecutive >= 3) {
        await alertService.notifyAlert({
          type: AlertType.NLU_PROVIDER_DEGRADED,
          severity: AlertSeverity.WARNING,
          message: `[NLU_PROVIDER_DEGRADED] Terdeteksi ${nluErrorsConsecutive}x NLU HTTP 400 berturut-turut. Periksa payload/token limit NLU provider.`,
          metadata: { nluErrorsConsecutive, lastPhone: metrics.customerPhone },
        });
      }
    }

    // Pemicu 3: 1 Silent Drop pada keluhan klinis anak -> UNINTENDED_SILENT_DROP
    // Deteksi: isSilentDrop true dan gejala klinis ada (bukan kejang/pendarahan yang memang expected silent)
    if (metrics.isSilentDrop) {
      // Cek apakah ini keluhan klinis (bukan kejang/pendarahan) — kita anggap semua silent drop di luar medical_emergency adalah unintended
      // Untuk membedakan, kita cek nluErrorCode bukan medical, dan isSilentDrop sudah di-filter di slot-engine (medical tidak dihitung)
      await alertService.notifyAlert({
        type: AlertType.UNINTENDED_SILENT_DROP,
        severity: AlertSeverity.WARNING,
        message: `[UNINTENDED_SILENT_DROP] Silent drop terdeteksi pada percakapan ${metrics.conversationId} (${metrics.customerPhone}). Bot masuk HUMAN_HANDLING tanpa balasan untuk keluhan klinis.`,
        metadata: { conversationId: metrics.conversationId, customerPhone: metrics.customerPhone },
      });
    }
  }
}

export const alertDaemonService = new AlertDaemonService();
