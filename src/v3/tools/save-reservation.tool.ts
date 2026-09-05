import { upsertReservationForm } from '../../services/reservation-lifecycle.service';
import { BabyDetail } from '../../utils/reservation-text-parser';
import { DEFAULT_TENANT_ID } from '../../config/tenant';

export interface SaveReservationInput {
  customerId: string;
  chatId: string;
  customerName?: string;
  treatmentName: string;
  bookingDate: string;
  bookingTime?: string;
  childName?: string;
  childAgeMonths?: number;
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
    description: 'Mencatat jadwal booking/reservasi treatment homecare yang telah disepakati bersama customer ke database klinik.',
    parameters: {
      type: 'object',
      properties: {
        customerName: {
          type: 'string',
          description: 'Nama orang tua / customer (misal: "Bunda Rina", "Bapak Naufal").'
        },
        treatmentName: {
          type: 'string',
          description: 'Nama paket treatment yang dipilih (misal: "Pijat Bayi Pulih Ceria", "Pijat Bayi Ceria").'
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
    bookingDate,
    bookingTime,
    childName,
    childAgeMonths,
    notes,
    tenantId = DEFAULT_TENANT_ID
  } = input;

  try {
    const rawFormText = `[V3 RESERVATION]\nNama: ${customerName || '-'}\nTreatment: ${treatmentName}\nJadwal: ${bookingDate} ${bookingTime || ''}\nAnak: ${childName || '-'} (${childAgeMonths ? childAgeMonths + ' bln' : '-'})\nCatatan: ${notes || '-'}`;

    const babies: BabyDetail[] = childName
      ? [{ name: childName, age: childAgeMonths ? `${childAgeMonths} bulan` : '0 bulan' }]
      : [];

    const parsedDate = !isNaN(Date.parse(bookingDate)) ? new Date(bookingDate) : new Date();

    const result = await upsertReservationForm({
      tenantId,
      customerId,
      chatId,
      treatmentCategory: 'BABY',
      treatmentDetail: treatmentName,
      bookingDate: parsedDate,
      rawText: rawFormText,
      babies,
      customerName,
      source: 'V3_NATIVE_AGENT_TOOL'
    });

    const summary = `Reservasi ${treatmentName} untuk ${customerName || 'Bunda'} pada ${bookingDate}${bookingTime ? ' pukul ' + bookingTime : ''} berhasil dicatat.`;

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
