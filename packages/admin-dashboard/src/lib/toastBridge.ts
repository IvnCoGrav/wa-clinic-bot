type ToastFn = (text: string, type?: 'success' | 'error' | 'info') => void;

let impl: ToastFn | null = null;

/** Dipasang sekali oleh UiFeedbackProvider agar kode non-React bisa memunculkan toast. */
export function bindToast(fn: ToastFn) {
  impl = fn;
}

export function toast(text: string, type: 'success' | 'error' | 'info' = 'info') {
  if (impl) impl(text, type);
  else console.warn('[toast belum terpasang]', text);
}
