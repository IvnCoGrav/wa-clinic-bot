import { describe, it, expect } from 'vitest';
import {
  pickAddressCard,
  resolveReservationAddress,
  isAddressFormLocked,
} from '../../packages/admin-dashboard/src/utils/reservationAddressSelection';

const cards = [
  { id: 'c1', address: 'Jl. Melati No. 1', landmark: 'Pagar hitam', ongkir: 10000, isPrimary: false },
  { id: 'c2', address: 'Jl. Mawar No. 2', landmark: 'Depan warung', ongkir: 15000, isPrimary: true },
  { id: 'c3', address: '', landmark: null, ongkir: null, isPrimary: false },
];

describe('reservationAddressSelection — kontrak kartu-first (KNOWN #338/#339)', () => {
  it('kartu terpilih menang atas teks fallback', () => {
    const out = resolveReservationAddress({
      cards: cards as any,
      selectedCardId: 'c1',
      fallbackText: 'Jl. Lama 99',
      fallbackLandmark: 'Landmark lama',
    });
    expect(out.card?.id).toBe('c1');
    expect(out.address).toBe('Jl. Melati No. 1');
    expect(out.landmark).toBe('Pagar hitam');
    expect(out.ongkir).toBe(10000);
  });

  it('tanpa pilihan eksplisit → kartu primary', () => {
    expect(pickAddressCard(cards as any, null)?.id).toBe('c2');
  });

  it('tanpa primary → kartu pertama', () => {
    const noPrimary = cards.map((c) => ({ ...c, isPrimary: false }));
    expect(pickAddressCard(noPrimary as any, null)?.id).toBe('c1');
  });

  it('id terpilih tidak ada di daftar (customer berganti) → jatuh ke primary, bukan kartu customer lama', () => {
    expect(pickAddressCard(cards as any, 'card-customer-lama')?.id).toBe('c2');
  });

  it('tanpa kartu → teks fallback dipakai dan form tidak terkunci', () => {
    const out = resolveReservationAddress({
      cards: [],
      selectedCardId: null,
      fallbackText: 'Jl. Baru 10',
      fallbackLandmark: 'Patokan',
    });
    expect(out.card).toBeNull();
    expect(out.address).toBe('Jl. Baru 10');
    expect(out.landmark).toBe('Patokan');
    expect(isAddressFormLocked([])).toBe(false);
  });

  it('kartu ada tetapi alamatnya kosong → fallback teks, ongkir tetap dari kartu', () => {
    const out = resolveReservationAddress({
      cards: [cards[2]] as any,
      selectedCardId: 'c3',
      fallbackText: 'Jl. Cadangan 5',
      fallbackLandmark: '',
    });
    expect(out.address).toBe('Jl. Cadangan 5');
    expect(out.ongkir).toBeNull();
    expect(isAddressFormLocked([cards[2]] as any)).toBe(true);
  });

  it('form terkunci (read-only) hanya bila ada kartu', () => {
    expect(isAddressFormLocked(cards as any)).toBe(true);
  });
});
