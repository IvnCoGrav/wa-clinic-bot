/**
 * Validator reservasi: satu fungsi murni yang mengembalikan SEMUA kesalahan
 * sekaligus, bukan satu per satu seperti pola toast berurutan sebelumnya.
 *
 * Alasan: modal reservasi punya 21 field; pengguna harus menekan Simpan
 * berulang kali untuk menemukan kesalahan berikutnya, dan pesan toast hilang
 * setelah 4 detik.
 */

export interface DraftItem {
  id: string;
  name?: string;
  isCustom?: boolean;
}

export interface DraftForValidation {
  customerId?: string | null;
  items: DraftItem[];
  bookingDate?: string | null;
  startTime?: string | null;
  addressMode?: 'existing' | 'new';
  newAddressText?: string | null;
}

export interface FieldIssue {
  field: string;
  message: string;
}

export function validateReservation(draft: DraftForValidation): FieldIssue[] {
  const issues: FieldIssue[] = [];

  if (!draft.customerId) {
    issues.push({ field: 'customerId', message: 'Pilih pasien terlebih dahulu.' });
  }

  if (!draft.items || draft.items.length === 0) {
    issues.push({ field: 'items', message: 'Pilih minimal satu layanan.' });
  } else {
    const customWithoutName = draft.items.find((item) => item.isCustom && !item.name?.trim());
    if (customWithoutName) {
      issues.push({
        field: `item.${customWithoutName.id}`,
        message: 'Nama layanan kustom wajib diisi.',
      });
    }
  }

  if (!draft.bookingDate) {
    issues.push({ field: 'bookingDate', message: 'Tentukan tanggal kunjungan.' });
  }

  if (!draft.startTime) {
    issues.push({ field: 'startTime', message: 'Tentukan jam mulai.' });
  }

  if (draft.addressMode === 'new' && !draft.newAddressText?.trim()) {
    issues.push({ field: 'newAddressText', message: 'Alamat baru wajib diisi.' });
  }

  return issues;
}
