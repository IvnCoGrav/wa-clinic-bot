import { checkMedicalKeywords } from '../config/medical-keywords';

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
    return checkMedicalKeywords(text);
  }
}
