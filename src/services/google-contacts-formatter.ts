export interface CustomerContactContext {
  id?: string;
  name?: string | null;
  phone: string;
  kota?: string | null;
  kecamatan?: string | null;
  kelurahan?: string | null;
  children?: Array<{ name: string; birth_date?: Date | string | null }>;
  latestReservation?: { service_name?: string; date?: Date | string | null };
}

/**
 * Normalisasi nomor telepon menjadi format standar internasional E.164 (+62...)
 */
export function normalizePhoneForGoogle(phone: string): string {
  if (!phone) return '';
  // Bersihkan karakter non-digit dan sufiks WA
  let clean = phone.replace(/@.*$/, '').replace(/[^0-9]/g, '');

  if (clean.startsWith('08')) {
    clean = '62' + clean.slice(1);
  } else if (clean.startsWith('8')) {
    clean = '62' + clean;
  }

  return clean ? `+${clean}` : '';
}

/**
 * Format nama kontak Google berdasarkan template yang dikonfigurasi tenant
 */
export function formatContactName(
  customer: CustomerContactContext,
  childName?: string | null,
  template: string = '{{name}} - {{child_name}}'
): { displayName: string; givenName: string; familyName: string } {
  const customerName = customer.name?.trim() || '';
  const child = childName?.trim() || (customer.children && customer.children.length > 0 ? customer.children[0].name.trim() : '');
  const phone = normalizePhoneForGoogle(customer.phone);
  const city = customer.kota?.trim() || '';
  const district = customer.kecamatan?.trim() || '';

  let formatted = template;

  if (customerName) {
    formatted = formatted.replace(/{{\s*name\s*}}/gi, customerName);
  } else {
    formatted = formatted.replace(/{{\s*name\s*}}/gi, `Pelanggan ${phone.slice(-4)}`);
  }

  if (child) {
    formatted = formatted.replace(/{{\s*child_name\s*}}/gi, child);
  } else {
    // Jika tidak ada data anak, hapus placeholder beserta delimiter terdekat
    formatted = formatted
      .replace(/-\s*{{\s*child_name\s*}}/gi, '')
      .replace(/{{\s*child_name\s*}}\s*-/gi, '')
      .replace(/{{\s*child_name\s*}}/gi, '');
  }

  formatted = formatted
    .replace(/{{\s*phone\s*}}/gi, phone)
    .replace(/{{\s*(kota|city)\s*}}/gi, city)
    .replace(/{{\s*kecamatan\s*}}/gi, district);

  // Bersihkan spasi dan tanda minus gantung
  let displayName = formatted.replace(/\s+/g, ' ').replace(/^[\s\-–—]+|[\s\-–—]+$/g, '').trim();

  if (!displayName) {
    displayName = customerName || `Pelanggan ${phone}`;
  }

  // Pisahkan givenName dan familyName untuk Google People API
  const nameParts = displayName.split(' ');
  const givenName = nameParts[0] || 'Pelanggan';
  const familyName = nameParts.slice(1).join(' ') || '';

  return {
    displayName,
    givenName,
    familyName,
  };
}

/**
 * Buat catatan terstruktur untuk field Biographical/Notes di Google Contacts
 */
export function buildContactNotes(customer: CustomerContactContext): string {
  const lines: string[] = [];

  lines.push(`[Data Bot Klinik]`);
  if (customer.id) lines.push(`ID: ${customer.id}`);
  lines.push(`WhatsApp: ${normalizePhoneForGoogle(customer.phone)}`);

  if (customer.children && customer.children.length > 0) {
    const childList = customer.children
      .map((c) => {
        if (c.birth_date) {
          const d = new Date(c.birth_date);
          const dateStr = !isNaN(d.getTime()) ? d.toISOString().split('T')[0] : '';
          return `${c.name} (${dateStr ? 'Lahir: ' + dateStr : ''})`.trim();
        }
        return c.name;
      })
      .join(', ');
    lines.push(`Data Anak: ${childList}`);
  }

  const addressParts = [customer.kelurahan, customer.kecamatan, customer.kota].filter(Boolean);
  if (addressParts.length > 0) {
    lines.push(`Alamat: ${addressParts.join(', ')}`);
  }

  if (customer.latestReservation?.service_name) {
    lines.push(`Reservasi Terakhir: ${customer.latestReservation.service_name}`);
  }

  return lines.join('\n');
}
