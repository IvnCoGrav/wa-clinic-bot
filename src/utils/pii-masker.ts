/**
 * src/utils/pii-masker.ts
 * Menyensor nomor telepon, nama anak, dan detail alamat pada log audit & console.
 */

export function maskPhoneNumber(phone?: string | null): string {
  if (!phone || typeof phone !== 'string') return '';
  const clean = phone.replace(/[^0-9]/g, '');
  if (clean.length <= 6) return '***';
  return `${clean.slice(0, 4)}****${clean.slice(-3)}`;
}

export function maskAddress(address?: string | null): string {
  if (!address || typeof address !== 'string') return '';
  // Sensor angka nomor rumah, blok, RT/RW
  return address
    .replace(/\b(no\.?\s*\d+|rt\s*\d+|rw\s*\d+|blok\s*[a-z0-9]+)\b/gi, '***')
    .replace(/\b(\d{1,4})\b/g, '***');
}

export function maskToolArgsForLogging(toolName: string, args: Record<string, any>): Record<string, any> {
  if (!args || typeof args !== 'object') return {};
  const masked = { ...args };

  if (masked.streetDetail) masked.streetDetail = maskAddress(masked.streetDetail);
  if (masked.locationText) masked.locationText = maskAddress(masked.locationText);
  if (masked.customerName) masked.customerName = `${String(masked.customerName).slice(0, 2)}***`;
  if (masked.childName) masked.childName = `${String(masked.childName).slice(0, 1)}***`;
  if (masked.phone) masked.phone = maskPhoneNumber(masked.phone);
  if (masked.notes) masked.notes = '[CATATAN DISENSOR]';
  if (masked.children && Array.isArray(masked.children)) {
    masked.children = masked.children.map((c: any) => ({
      ...c,
      name: c.name ? `${String(c.name).slice(0, 1)}***` : undefined,
    }));
  }

  return masked;
}
