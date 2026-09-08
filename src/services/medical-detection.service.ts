import { checkMedicalKeywords, EMERGENCY_SYMPTOM_PATTERNS } from '../config/medical-keywords';

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
  static detectMedicalConcern(text: string): MedicalDetectionResult {
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
    return base;
  }
}
