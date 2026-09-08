import { PrismaClient, TreatmentCategory } from '@prisma/client';

export interface RawExportItem {
  contact_id: string;
  customer_name: string;
  phone_number: string;
  order_index: number;
  order_date_chat: string;
  booking_date: string;
  booking_time: string;
  patient_type: string;
  patient_name: string;
  treatments: string[];
  address_info: string;
  pricing_details: {
    treatment_fee: number;
    delivery_fee: number;
    total_price: number;
  };
  order_status: string;
  notes: string;
  meta_matching_fields: {
    city: string | null;
    state: string | null;
    zip: string | null;
    country: string | null;
  };
}

export function normalizePhone(raw: string): string {
  let cleaned = raw.replace(/\D/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '62' + cleaned.slice(1);
  } else if (!cleaned.startsWith('62')) {
    cleaned = '62' + cleaned;
  }
  return cleaned;
}

export function cleanCustomerName(raw: string): string {
  if (!raw) return '';
  let name = raw.trim();
  // Remove parenthetical details like (Bunda Fatma)
  if (name.includes('(') && name.includes(')')) {
    const pMatch = name.match(/\(([^)]+)\)/);
    if (pMatch && pMatch[1]) {
      const inside = pMatch[1].replace(/^(?:bunda|mrs|ny|ny\.)\s*/i, '').trim();
      if (inside) return inside;
    }
  }
  // Remove trailing location like ", Jambangan", ", Wiyung Apart CBD", etc.
  name = name.split(',')[0].trim();
  // Remove prefix like "Bunda ", "~", "Suami Bunda ", "Momm"
  name = name.replace(/^(?:suami\s+bunda|bunda|mrs|ny|ny\.|momm|moms|~)\s*/i, '').trim();

  // Strip common trailing district names if present at the end of the string
  const districts = [
    'jambangan', 'bubutan', 'petikan', 'petiken', 'karang pilang', 'karangpilang', 'ngagel',
    'kalijudan', 'buduran', 'simomulyo', 'candi', 'sedati', 'gresik', 'kemayoran', 'manukan',
    'siwalankerto', 'tambaksari', 'tambak sari sby', 'sidotopo wetan', 'sekawan nyaman',
    'banyuurip', 'banyu urip', 'kodam', 'rungkut', 'sedati', 'pepelegi', 'taman', 'mulyorejo',
    'tenggilis', 'tanggulangin', 'kandangan', 'dukuh pakis', 'sukomanunggal', 'lidah kulon',
    'gedangan', 'bungurasih', 'wonocolo', 'tegalsari', 'bratang', 'bulusidokare', 'citraland wiyung',
    'citraland', 'damarsih', 'kenjeran', 'klampis', 'sambikerep', 'gunungsari', 'sawotratap',
    'simokerto', 'tambak oso', 'kutisari', 'kertajaya', 'wonosari', 'sukodono', 'pabean',
    'gunung anyar', 'tambak wedi', 'semolowaru', 'pakuwon city', 'jojoran', 'waru', 'krian',
    'medokan ayu', 'grogol sby', 'grogol', 'babatan', 'kepuh'
  ];

  for (const d of districts) {
    const re = new RegExp(`\\s+${d}$`, 'i');
    if (re.test(name)) {
      name = name.replace(re, '').trim();
      break;
    }
  }

  return name || raw.trim();
}

export function parsePatientAgeAndName(patientName: string): { name: string; ageText?: string; ageMonths?: number }[] {
  if (!patientName) return [];
  const results: { name: string; ageText?: string; ageMonths?: number }[] = [];
  
  // Split multiple patients like "Owen (2 bulan) & Briell (3 tahun)" or "Chelsea (2 tahun 7 bulan) & Radeva (1 tahun)"
  const parts = patientName.split(/&|,|\band\b/i).map(s => s.trim()).filter(Boolean);
  
  for (const part of parts) {
    const match = part.match(/^([^(]+)(?:\(([^)]+)\))?$/);
    if (match) {
      const name = match[1].trim().replace(/^(?:bayi|adek|anak|bunda)\s+/i, '').trim();
      const ageText = match[2]?.trim();
      let ageMonths: number | undefined;
      if (ageText) {
        const yearMatch = ageText.match(/(\d+(?:[.,]\d+)?)\s*(?:th|tahun|thn)/i);
        const monthMatch = ageText.match(/(\d+(?:[.,]\d+)?)\s*(?:bln|bulan|mo|month)/i);
        const dayMatch = ageText.match(/(\d+)\s*(?:hari|hr|day)/i);
        
        let m = 0;
        if (yearMatch) m += parseFloat(yearMatch[1].replace(',', '.')) * 12;
        if (monthMatch) m += parseFloat(monthMatch[1].replace(',', '.'));
        if (dayMatch && !monthMatch && !yearMatch) m += Math.round(parseInt(dayMatch[1], 10) / 30);
        if (m > 0) ageMonths = Math.round(m);
      }
      if (name && !['bunda', 'moms', 'ayah', 'suami'].includes(name.toLowerCase())) {
        results.push({ name, ageText, ageMonths });
      }
    } else {
      results.push({ name: part.trim() });
    }
  }
  return results;
}

export function parseBookingDateTime(bookingDate: string, orderDateChat: string): Date {
  // Try to parse DD/MM/YYYY or YYYY-MM-DD or Indonesian date
  if (bookingDate && /\d{4}-\d{2}-\d{2}/.test(bookingDate)) {
    const d = new Date(bookingDate);
    if (!isNaN(d.getTime())) return d;
  }
  
  const dmyMatch = bookingDate.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmyMatch) {
    const d = new Date(`${dmyMatch[3]}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}T12:00:00Z`);
    if (!isNaN(d.getTime())) return d;
  }

  const indoMatch = bookingDate.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (indoMatch) {
    const months: Record<string, string> = {
      januari: '01', februari: '02', maret: '03', april: '04', mei: '05', juni: '06',
      juli: '07', agustus: '08', september: '09', oktober: '10', november: '11', desember: '12'
    };
    const m = months[indoMatch[2].toLowerCase()];
    if (m) {
      const d = new Date(`${indoMatch[3]}-${m}-${indoMatch[1].padStart(2, '0')}T12:00:00Z`);
      if (!isNaN(d.getTime())) return d;
    }
  }

  // Fallback to orderDateChat
  if (orderDateChat && /\d{4}-\d{2}-\d{2}/.test(orderDateChat)) {
    const d = new Date(`${orderDateChat}T12:00:00Z`);
    if (!isNaN(d.getTime())) return d;
  }

  return new Date();
}

export function mapPatientTypeToCategory(patientType: string, treatments: string[]): TreatmentCategory {
  const tLower = treatments.join(' ').toLowerCase();
  const pLower = (patientType || '').toLowerCase();
  if (pLower.includes('combination') || (tLower.includes('moms') && tLower.includes('baby')) || (tLower.includes('laktasi') && tLower.includes('bayi'))) {
    return TreatmentCategory.BOTH;
  }
  if (pLower.includes('moms') || tLower.includes('laktasi') || tLower.includes('oksitosin') || tLower.includes('hamil') || tLower.includes('perineum')) {
    return TreatmentCategory.MOMS;
  }
  return TreatmentCategory.BABY;
}
