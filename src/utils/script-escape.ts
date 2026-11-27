/**
 * Escaping nilai dinamis yang disisipkan ke dalam konteks <script>.
 *
 * JSON.stringify saja TIDAK cukup: urutan `</script>` tetap lolos dan menutup
 * blok script. Helper ini menetralkan karakter pemutus konteks lewat unicode
 * escape yang tetap valid di dalam string/JSON JavaScript.
 */
const SCRIPT_BREAKOUT = /[<>&\u2028\u2029]/g;

const SCRIPT_REPLACEMENTS: Record<string, string> = {
  '<': '\\u003c',
  '>': '\\u003e',
  '&': '\\u0026',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
};

export function escapeScriptText(value: string): string {
  return value.replace(SCRIPT_BREAKOUT, (ch) => SCRIPT_REPLACEMENTS[ch]);
}

/** String literal JavaScript yang aman disisipkan di dalam <script>. */
export function jsStringLiteral(value: string): string {
  return escapeScriptText(JSON.stringify(String(value)));
}

/** JSON literal yang aman disisipkan di dalam <script>. */
export function safeJsonForScript(value: unknown): string {
  return escapeScriptText(JSON.stringify(value));
}
