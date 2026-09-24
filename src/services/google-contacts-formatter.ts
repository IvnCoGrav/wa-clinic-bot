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
  const subdistrict = customer.kelurahan?.trim() || '';

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

  // Smart Location Fallback: jika {{kelurahan}} diminta tapi kosong, gunakan kecamatan
  // HANYA bila template tidak memuat {{kecamatan}} sendiri (anti-duplikat "Gedangan, Gedangan").
  const templateHasDistrict = /{{\s*kecamatan\s*}}/i.test(template);
  const effectiveSubdistrict = subdistrict || (templateHasDistrict ? '' : district);
  if (effectiveSubdistrict) {
    formatted = formatted.replace(/{{\s*kelurahan\s*}}/gi, effectiveSubdistrict);
  } else {
    formatted = formatted
      .replace(/-\s*{{\s*kelurahan\s*}}/gi, '')
      .replace(/{{\s*kelurahan\s*}}\s*-/gi, '')
      .replace(/{{\s*kelurahan\s*}}/gi, '');
  }

  if (district) {
    formatted = formatted.replace(/{{\s*kecamatan\s*}}/gi, district);
  } else {
    formatted = formatted
      .replace(/-\s*{{\s*kecamatan\s*}}/gi, '')
      .replace(/{{\s*kecamatan\s*}}\s*-/gi, '')
      .replace(/{{\s*kecamatan\s*}}/gi, '');
  }

  formatted = formatted
    .replace(/{{\s*phone\s*}}/gi, phone)
    .replace(/{{\s*(kota|city)\s*}}/gi, city);

  // Bersihkan tanda koma, kurung kosong (), minus gantung di awal/akhir/tengah, dan multiple spaces
  let displayName = formatted
    .replace(/\(\s*,\s*/g, '(')
    .replace(/\s*,\s*\)/g, ')')
    .replace(/\(\s*\)/g, '')
    .replace(/,\s*,+/g, ',')
    .replace(/\s+,/g, ',')
    .replace(/\s+-\s*$/g, '')
    .replace(/^\s*-\s+/g, '')
    .replace(/^[\s,–—\-]+|[\s,–—\-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!displayName) {
    displayName = customerName || `Pelanggan ${phone.slice(-4)}`;
  }

  // Pemecahan terstruktur anti-hyphen untuk Google People API:
  // Jika displayName memuat pemisah " - ", pisahkan nama murni dan penanda wilayah
  // agar familyName tidak menempel tanda minus ("- Bulakbanteng, Desy" di locale family-first).
  let givenName = '';
  let familyName = '';
  if (displayName.includes(' - ')) {
    const parts = displayName.split(' - ');
    givenName = parts[0]?.trim() || 'Pelanggan';
    familyName = parts.slice(1).join(' - ').trim();
  } else {
    const nameParts = displayName.split(' ');
    givenName = nameParts[0] || 'Pelanggan';
    familyName = nameParts.slice(1).join(' ').trim();
  }

  return {
    displayName,
    givenName,
    familyName,
  };
}

/**
 * Belah nama komposit hasil impor Google ("Nama - Wilayah") menjadi nama bersih
 * dan tag wilayah. Murni (pure) agar unit-testable; klasifikasi tag dilakukan
 * terpisah via gazetteer (data-driven, bukan hafalan).
 */
export function splitImportedContactName(compositeName: string): {
  cleanName: string;
  areaTag: string | null;
} {
  const raw = (compositeName || '').trim();
  if (!raw) return { cleanName: '', areaTag: null };
  const idx = raw.indexOf(' - ');
  if (idx < 0) return { cleanName: raw, areaTag: null };
  const cleanName = raw.slice(0, idx).trim();
  const areaTag = raw.slice(idx + 3).trim();
  return { cleanName: cleanName || raw, areaTag: areaTag || null };
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

/**
 * Ekstrak nama, nomor HP, dan catatan dari objek person Google People API
 */
export function extractContactPhoneAndName(person: any): {
  resourceName: string;
  etag: string;
  phone: string;
  name: string;
  notes?: string;
} | null {
  if (!person) return null;

  const resourceName = person.resourceName || '';
  const etag = person.etag || '';

  // 1. Ekstrak nomor telepon utama
  const phoneNumbers = person.phoneNumbers || [];
  let phone = '';
  for (const p of phoneNumbers) {
    const rawVal = p.value || '';
    const norm = normalizePhoneForGoogle(rawVal);
    if (norm) {
      phone = norm;
      break;
    }
  }

  if (!phone) {
    return null; // Lewati kontak yang tidak memiliki nomor telepon
  }

  // 2. Ekstrak nama
  const names = person.names || [];
  const primaryName = names.find((n: any) => n.metadata?.primary) || names[0];
  let name = primaryName?.displayName || `${primaryName?.givenName || ''} ${primaryName?.familyName || ''}`.trim();

  if (!name) {
    name = `Kontak Google (${phone.slice(-4)})`;
  }

  // 3. Ekstrak catatan / bios
  const biographies = person.biographies || [];
  const notes = biographies.map((b: any) => b.value).filter(Boolean).join('\n') || undefined;

  return {
    resourceName,
    etag,
    phone,
    name,
    notes,
  };
}

