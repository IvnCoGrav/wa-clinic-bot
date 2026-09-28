import { checkMedicalKeywords, EMERGENCY_SYMPTOM_PATTERNS, detectNeonatalFeverEmergency, detectPersistentCoughRashEmergency, detectDoseInquiryConcern } from '../config/medical-keywords';

export interface MedicalDetectionResult {
  isMedical: boolean;
  severity: 'HIGH' | 'MEDIUM' | 'NONE';
  detectedSymptoms: string[];
}

export class MedicalDetectionService {
  /**
   * Evaluates text for medical symptoms and urgent health concerns.
   * Returns severity level and detected symptom list.
   */
  static detectMedicalConcern(text: string, recentHistory?: string[]): MedicalDetectionResult {
    // Neonatus fever emergency check (highest priority, order-independent)
    const neonatal = detectNeonatalFeverEmergency(text);
    if (neonatal.isNeonatalFever) {
      return {
        isMedical: true,
        severity: 'HIGH',
        detectedSymptoms: neonatal.detectedSymptoms,
      };
    }

    // Red-flag komposit batuk-ruam-demam (RF-06) — sadar-riwayat lintas turn.
    // Severity HIGH: layak dievaluasi paling awal (sebelum base) karena butuh
    // gabungan lintas-turn yang tidak terlihat dari satu pesan.
    const composite = detectPersistentCoughRashEmergency([text, ...(recentHistory || [])]);
    if (composite.isEmergency) {
      return {
        isMedical: true,
        severity: 'HIGH',
        detectedSymptoms: composite.detectedSymptoms,
      };
    }

    // Severity dasar dari keyword & pola darurat. Dihitung SEBELUM detektor
    // tambahan agar detektor severity lebih rendah (MEDIUM) TIDAK PERNAH
    // menurunkan severity yang sudah lebih tinggi (anti-safety-downgrade).
    const base = checkMedicalKeywords(text);
    if (base.severity === 'HIGH') return base;
    // Lightweight regex classifier parafrase darurat — jika cocok, paksa HIGH
    for (const pattern of EMERGENCY_SYMPTOM_PATTERNS) {
      if (pattern.test(text)) {
        const matched = text.match(pattern)?.[0] || pattern.source;
        return {
          isMedical: true,
          severity: 'HIGH',
          detectedSymptoms: [...base.detectedSymptoms, matched.trim()],
        };
      }
    }
    if (base.severity === 'MEDIUM') return base;

    // Red-flag pertanyaan dosis obat/vitamin (RF-08) — komposit konteks-obat × dosis.
    // Hanya dipakai bila base NONE: penanda dosis WAJIB ada di pesan SAAT INI
    // (pertanyaan dosis bersifat pesan-berjalan), sementara konteks obat boleh
    // berasal dari riwayat. Mencegah "sticky concern" yang mengeskalasi setiap
    // turn lanjutan hanya karena kata "obat/dosis" pernah muncul sebelumnya.
    const dose = detectDoseInquiryConcern(text, recentHistory);
    if (dose.isConcern) {
      return {
        isMedical: true,
        severity: dose.severity,
        detectedSymptoms: dose.detectedSymptoms,
      };
    }

    return base;
  }
}
