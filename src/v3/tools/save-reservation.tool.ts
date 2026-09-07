import { upsertReservationForm } from '../../services/reservation-lifecycle.service';
import { BabyDetail } from '../../utils/reservation-text-parser';
import { DEFAULT_TENANT_ID } from '../../config/tenant';

export interface SaveReservationChild {
  name?: string;
  ageMonths?: number;
}

export interface SaveReservationInput {
  customerId: string;
  chatId: string;
  customerName?: string;
  treatmentName: string;
  /** Layanan tambahan untuk multi-treatment / multi-pasien (Mom+Baby, 2 anak). */
  additionalTreatments?: string[];
  bookingDate: string;
  bookingTime?: string;
  childName?: string;
  childAgeMonths?: number;
  /** Daftar anak untuk reservasi multi-pasien (otomatis jadi babies). */
  children?: SaveReservationChild[];
  notes?: string;
  tenantId?: string;
}

export interface SaveReservationOutput {
  success: boolean;
  reservationId?: string;
  summary: string;
  message: string;
}

export const SAVE_RESERVATION_TOOL_SCHEMA = {
  type: 'function',
  function: {
    name: 'save_reservation',
    description: 'Mencatat jadwal booking/reservasi treatment homecare yang telah disepakati bersama customer ke database klinik. Mendukung multi-treatment & multi-pasien (Mom+Baby, 2 anak): isi additionalTreatments dan children bila ada lebih dari 1 layanan/pasien — kategori otomatis BUNDLE.',
    parameters: {
      type: 'object',
      properties: {
        customerName: {
          type: 'string',
          description: 'Nama orang tua / customer (misal: "Bunda Rina", "Bapak Naufal").'
        },
        treatmentName: {
          type: 'string',
          description: 'Nama paket treatment utama yang dipilih (misal: "Pijat Bayi Pulih Ceria", "Pijat Bayi Ceria").'
        },
        additionalTreatments: {
          type: 'array',
          items: { type: 'string' },
          description: 'Daftar layanan tambahan untuk multi-treatment/multi-pasien (misal: ["Oksitosin Massage Fullbody", "Cukur Rambut Bayi"]). Otomatis menjadikan kategori BUNDLE.'
        },
        children: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Nama anak (opsional).' },
              ageMonths: { type: 'number', description: 'Usia anak dalam bulan (opsional).' }
            }
          },
          description: 'Daftar anak untuk reservasi multi-pasien (misal: Adik 2 bulan + Kakak 36 bulan). Masing-masing tersimpan ke tabel children.'
        },
        bookingDate: {
          type: 'string',
          description: 'Tanggal atau hari kunjungan yang diinginkan (misal: "Sabtu, 5 September 2026", "Besok pagi").'
        },
        bookingTime: {
          type: 'string',
          description: 'Jam kunjungan yang diinginkan (misal: "10.00 WIB", "09.00", "Sore jam 14.00").'
        },
        childName: {
          type: 'string',
          description: 'Nama si kecil / bayi (opsional).'
        },
        childAgeMonths: {
          type: 'number',
          description: 'Usia si kecil dalam bulan (opsional).'
        },
        notes: {
          type: 'string',
          description: 'Catatan tambahan seperti keluhan khusus, patokan rumah, dll. (opsional).'
        }
      },
      required: ['treatmentName', 'bookingDate']
    }
  }
};

export async function executeSaveReservation(input: SaveReservationInput): Promise<SaveReservationOutput> {
  const {
    customerId,
    chatId,
    customerName,
    treatmentName,
    additionalTreatments = [],
    bookingDate,
    bookingTime,
    childName,
    childAgeMonths,
    children = [],
    notes,
    tenantId = DEFAULT_TENANT_ID
  } = input;

  try {
    // Multi-treatment / multi-pasien: gabung semua layanan; kategori otomatis BUNDLE.
    const extraClean = (additionalTreatments || []).map((t) => String(t || '').trim()).filter(Boolean);
    const allTreatments = [treatmentName, ...extraClean.filter((t) => t.toLowerCase() !== treatmentName.toLowerCase())];
    const isMulti = allTreatments.length > 1 || children.length > 1;
    const treatmentDetail = allTreatments.join(' + ');
    // Heuristic kategori: MOMS bila ada layanan ibu, BUNDLE bila multi, else BABY.
    const momsCue = /oksitosin|laktasi|nifas|hamil|menyusui|moms|perineum|yoga/i.test(treatmentDetail);
    const treatmentCategory = isMulti ? 'BOTH' : (momsCue ? 'MOMS' : 'BABY');

    const childLabel = children.length > 0
      ? children.map((c, i) => `${c.name || `Anak ${i + 1}`}${c.ageMonths != null ? ` (${c.ageMonths} bln)` : ''}`).join(', ')
      : `${childName || '-'} (${childAgeMonths ? childAgeMonths + ' bln' : '-'})`;
    const rawFormText = `[V3 RESERVATION]\nNama: ${customerName || '-]'.replace(']', '')}\nTreatment: ${treatmentDetail}\nJadwal: ${bookingDate} ${bookingTime || ''}\nAnak: ${childLabel}\nCatatan: ${notes || '-'}`;

    const babies: BabyDetail[] = children.length > 0
      ? children.map((c, i) => ({ name: c.name || `Anak ${i + 1}`, age: c.ageMonths != null ? `${c.ageMonths} bulan` : '0 bulan' }))
      : (childName
        ? [{ name: childName, age: childAgeMonths ? `${childAgeMonths} bulan` : '0 bulan' }]
        : []);

    const parsedDate = !isNaN(Date.parse(bookingDate)) ? new Date(bookingDate) : new Date();

    const result = await upsertReservationForm({
      tenantId,
      customerId,
      chatId,
      treatmentCategory: treatmentCategory as any,
      treatmentDetail,
      bookingDate: parsedDate,
      rawText: rawFormText,
      babies,
      customerName,
      source: 'V3_NATIVE_AGENT_TOOL'
    });

    const summary = `Reservasi ${treatmentDetail} untuk ${customerName || 'Bunda'} pada ${bookingDate}${bookingTime ? ' pukul ' + bookingTime : ''} berhasil dicatat.`;

    return {
      success: true,
      reservationId: result.reservation?.id,
      summary,
      message: `${summary} Jadwal akan dikoordinasikan dengan Bidan yang bertugas.`
    };
  } catch (error: any) {
    console.error('[V3 TOOL RESERVATION ERROR]', error);
    return {
      success: false,
      summary: 'Gagal mencatat reservasi',
      message: `Error mencatat reservasi: ${error.message}`
    };
  }
}
