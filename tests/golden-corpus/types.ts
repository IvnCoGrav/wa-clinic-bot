/**
 * Golden Regression Corpus — Kontrak Tipe & Skema Skenario
 * Satu sumber kebenaran untuk 50 skenario multi-turn terbobot empiris.
 * Bahasa komentar: Indonesia (sesuai AGENTS.md).
 */

export type GoldenCategory = 'clinical' | 'acknowledgement' | 'booking' | 'location' | 'pricing';

export interface GoldenSlateAssertion {
  /** Field CustomerSlate yang harus bernilai tertentu setelah turn ini */
  field: 'childAgeMonths' | 'childAgeCategory' | 'selectedTreatmentName' | 'isLocationConfirmed' | 'kelurahan' | 'symptoms' | 'preferredDate' | 'projectedState' | 'isHumanHandling';
  /** Nilai harapan — string/number/boolean/array. Untuk array: cek contains */
  expected: unknown;
  /** Jika true, cek negasi (field TIDAK boleh berisi expected) */
  negated?: boolean;
}

export interface GoldenTurn {
  /** Urutan turn (1-indexed) */
  turn: number;
  /** Input chat pelanggan (teks WhatsApp) */
  input: string;
  /** Intent yang diharapkan dari EntityExtractor (subset, bukan exact) */
  expectedIntents?: string[];
  /** Kata/frasa yang WAJIB ada di balasan bot (case-insensitive contains) */
  mustContain?: string[];
  /** Kata/frasa yang DILARANG ada di balasan bot */
  mustNotContain?: string[];
  /** Assertion mutasi CustomerSlate setelah turn ini diproses */
  slateAssertions?: GoldenSlateAssertion[];
  /** Jika true, bot DILARANG silent drop (harus shouldSendReply = true atau deterministicTemplateReply terisi) */
  noSilentDrop?: boolean;
  /** Jika true, bot DILARANG menanyakan ulang kelurahan yang sudah isLocationConfirmed */
  noUnjustifiedRsqr?: boolean;
}

export interface GoldenScenario {
  /** ID unik: CLIN-01, ACK-03, BOOK-07, LOC-02, PRIC-01 */
  id: string;
  category: GoldenCategory;
  /** Bobot empiris: proporsi kemunculan di log riil (jumlahkan 100%) */
  weight: number;
  /** Deskripsi singkat skenario (Indonesia) */
  description: string;
  /** Urutan turn (1..n) */
  turns: GoldenTurn[];
}

export interface GoldenTurnResult {
  turn: number;
  input: string;
  actualReply: string;
  action: string;
  passed: boolean;
  failures: string[];
  slateSnapshot: Record<string, unknown>;
}

export interface GoldenScenarioResult {
  id: string;
  category: GoldenCategory;
  description: string;
  passed: boolean;
  turnResults: GoldenTurnResult[];
  failures: string[];
}
