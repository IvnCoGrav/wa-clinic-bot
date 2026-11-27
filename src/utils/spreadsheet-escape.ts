/**
 * Netralisasi formula injection untuk spreadsheet (CSV & Google Sheets).
 *
 * Nilai yang diawali `= + - @ TAB CR` dieksekusi sebagai formula oleh
 * spreadsheet. Prefix apostrof memaksa sel diperlakukan sebagai teks.
 */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function neutralizeFormula(value: string): string {
  return FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

/** Sel CSV: netralkan formula lalu bungkus kutip ganda dengan escape standar. */
export function escapeCsvCell(value: unknown): string {
  let s = neutralizeFormula(String(value ?? ''));
  s = s.replace(/"/g, '""');
  return `"${s}"`;
}

/**
 * Sel Google Sheets dengan valueInputOption=USER_ENTERED.
 * Tidak membungkus kutip — API Sheets menerima nilai mentah.
 */
export function escapeSheetCell(value: unknown): string {
  return neutralizeFormula(String(value ?? ''));
}
