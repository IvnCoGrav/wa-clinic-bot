import { describe, it, expect } from 'vitest';
import { generateReservationInvoiceText } from '../../packages/admin-dashboard/src/utils/paymentInvoiceFormatter';

describe('A-008: Payment Invoice Address Card Priority (Fase 0)', () => {
  it('0.7: Invoice harus memprioritaskan kartu alamat tertaut pada reservasi daripada alamat profil root customer', () => {
    const text = generateReservationInvoiceText({
      reservation: {
        id: 'res-briella-card',
        booking_date: '2026-11-06T02:00:00.000Z', // 09:00 WIB
        treatment_detail: 'pijat bayi',
        treatment_category: 'BABY',
        purchase_value: 80000,
        raw_text: '',
        customer_address_id: 'card-gunung-anyar',
        customer_address: {
          id: 'card-gunung-anyar',
          label: 'Rumah Gunung Anyar',
          address: 'Jl. Gunung Anyar Lor No. 94',
          kelurahan: 'Gunung Anyar Lor',
          kecamatan: 'Gunung Anyar',
          kota: 'Surabaya',
          ongkir: 15000,
        },
      } as any,
      customer: {
        name: 'Bunda Briella',
        phone: '6283856165785',
        // Alamat di profil root (rumah utama lama) berbeda dengan kartu yang dipilih untuk reservasi ini
        address: 'Jl. Karangpoh No. 12',
        kelurahan: 'Karangpoh',
        kecamatan: 'Tandes',
        kota: 'Surabaya',
        distance_km: 19.8,
        ongkir: 15000,
      },
    });

    // Invoice harus memakai alamat dari kartu reservasi (Rumah Gunung Anyar Lor)
    expect(text).toContain('Alamat Lengkap & Patokan : Jl. Gunung Anyar Lor No. 94');
    expect(text).not.toContain('Jl. Karangpoh No. 12');
  });
});
