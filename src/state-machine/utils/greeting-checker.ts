import { getTenantCapiFormats } from '../../services/capi.service';

export interface GreetingCheckResult {
  isPureGreeting: boolean;
  extraText?: string;
  hasExtraQuestions: boolean;
}

/**
 * Normalisasi teks untuk perbandingan:
 * Lowercase, hapus tag tracking [CODE], ubah karakter non-alphanumeric jadi spasi, pangkas spasi ganda.
 */
function normalizeText(str: string): string {
  return (str || '')
    .toLowerCase()
    .replace(/(?:Promo|ID|Iklan|Diskon)?\s*\[\s*[\w\s]{1,10}?\s*\]/gi, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Daftar kata/frasa bawaan lead iklan WhatsApp
const STANDARD_LEAD_TOKENS = new Set([
  'halo', 'hola', 'hi', 'hei', 'p', 'assalamualaikum', 'salam',
  'pagi', 'siang', 'sore', 'malam', 'permisi',
  'bu', 'bidan', 'admin', 'kak', 'min', 'mbak', 'mas', 'bund', 'bunda',
  'saya', 'aku', 'mau', 'ingin', 'reservasi', 'booking', 'pesan',
  'home', 'service', 'sevice', 'homecare', 'care', 'treatment', 'hometreatment',
  'tertarik', 'dengan', 'layanan', 'info', 'lengkap', 'tanya', 'paket', 'spa', 'promo',
  'bagaimana', 'gimana', 'caranya', 'cara', 'bisa', 'kah', 'ya', 'terima', 'kasih', 'makasih'
]);

/**
 * Memeriksa apakah pesan pertama customer murni cocok dengan template sapaan pembuka (Greetings Text / Format Visit)
 * atau apakah customer menambahkan pertanyaan / catatan ekstra di luar template.
 */
export async function checkLeadGreetingText(
  incomingText: string,
  rawInboundText?: string,
  tenantId?: string
): Promise<GreetingCheckResult> {
  const combined = `${rawInboundText || ''} ${incomingText || ''}`;
  const normalizedMsg = normalizeText(combined);

  let formatVisit = 'Promo[%ID%]';
  let greetingsText = '';
  try {
    const formats = await getTenantCapiFormats(tenantId);
    formatVisit = formats.formatVisit || '';
    greetingsText = formats.greetingsText || '';
  } catch (_) {}

  // 1. Cek perbandingan persis dengan Greetings Text milik Tenant
  if (greetingsText) {
    const normalizedTemplate = normalizeText(greetingsText);
    if (normalizedTemplate && normalizedMsg === normalizedTemplate) {
      return {
        isPureGreeting: true,
        hasExtraQuestions: false,
      };
    }

    // Cek jika pesan diawali oleh Greetings Text dan ada teks ekstra di belakangnya
    if (normalizedTemplate && normalizedMsg.startsWith(normalizedTemplate)) {
      const extraPart = normalizedMsg.substring(normalizedTemplate.length).trim();
      if (extraPart.length > 0) {
        return {
          isPureGreeting: false,
          extraText: extraPart,
          hasExtraQuestions: true,
        };
      }
    }
  }

  // 2. Fallback: Hapus kata-kata bawaan lead standar
  const words = normalizedMsg.split(/\s+/).filter(Boolean);
  const extraWords = words.filter((w) => !STANDARD_LEAD_TOKENS.has(w));

  const hasExtra = extraWords.length > 0;
  return {
    isPureGreeting: !hasExtra,
    extraText: hasExtra ? extraWords.join(' ') : undefined,
    hasExtraQuestions: hasExtra,
  };
}
