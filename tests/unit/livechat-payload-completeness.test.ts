import { describe, it, expect } from 'vitest';
import { liveChatService } from '../../src/services/live-chat.service';

const serialize = (c: any) => (liveChatService as any).serialize(c);

function conv(overrides: any = {}) {
  return {
    id: 'conv-1',
    customer_id: 'cust-1',
    current_state: 'INITIAL',
    updated_at: new Date('2026-10-03T08:00:00+07:00'),
    messages: [],
    customer: {
      id: 'cust-1',
      name: 'Bunda Syarifa',
      phone: '628993868131',
      kelurahan: 'Tebel',
      kecamatan: 'Gedangan',
      kota: 'Sidoarjo',
      ongkir: 20000,
      distance_km: 3.4,
      preferences: { address: 'Tebel Barat RT 1 RW 1', landmark: 'depan makam islam' },
      children: [{ id: 'ch-1', name: 'Nadira', raw_age_text: '8 bulan' }],
      reservations: [
        {
          id: 'res-1',
          status: 'confirmed',
          booking_date: new Date('2026-10-03T09:00:00+07:00'),
          treatment_category: 'BABY',
          treatment_detail: 'Kala Baby – Pijat Ceria',
          duration_minutes: 60,
          purchase_value: 120000,
          payment_method: 'TRANSFER',
          proof_url: '/media/proof.jpg',
          delivery_fee: 20000,
          needs_staff_verification: false,
          raw_text: 'Berikut reservasi\nAlamat & Shareloc : Tebel Barat RT 1 RW 1',
          assigned_staff_id: 'st-1',
          assigned_staff: { id: 'st-1', name: 'Bidan Rina' },
        },
      ],
    },
    ...overrides,
  };
}

describe('LiveChat banner payload completeness (F-A)', () => {
  it('reservasi aktif membawa raw_text, purchase_value, proof, prefs, children', () => {
    const out: any = serialize(conv());
    const r = out.activeConfirmedReservation;
    expect(r).toBeTruthy();
    expect(r.raw_text).toContain('Tebel Barat');
    expect(r.purchase_value).toBe(120000);
    expect(r.proof_url).toBe('/media/proof.jpg');
    expect(r.delivery_fee).toBe(20000);
    expect(r.duration_minutes).toBe(60);
    expect(r.customer.preferences.address).toBe('Tebel Barat RT 1 RW 1');
    expect(r.customer.preferences.landmark).toBe('depan makam islam');
    expect(r.customer.children).toHaveLength(1);
    expect(r.customer.distance_km).toBe(3.4);
  });

  it('adversarial: customer ramping (tanpa preferences) tetap punya raw_text untuk seam baca', () => {
    const c = conv();
    c.customer.preferences = undefined as any;
    const out: any = serialize(c);
    const r = out.activeConfirmedReservation;
    expect(r.customer.preferences).toEqual({ address: null, full_address: null, landmark: null, address_notes: null });
    expect(r.raw_text).toBeTruthy();
  });

  it('adversarial: customer tanpa children -> [] (tidak crash)', () => {
    const c = conv();
    c.customer.children = undefined as any;
    const out: any = serialize(c);
    expect(out.activeConfirmedReservation.customer.children).toEqual([]);
  });

  it('status hold valid -> activeHoldReservation ikut lengkap', () => {
    const c = conv();
    c.customer.reservations = [{
      id: 'h-1', status: 'hold',
      booking_date: new Date(Date.now() + 3600 * 1000),
      treatment_category: 'BABY', treatment_detail: '[HOLD]',
      raw_text: 'Alamat : Jl. Mawar 2',
    }];
    const out: any = serialize(c);
    expect(out.activeHoldReservation).toBeTruthy();
    expect(out.activeHoldReservation.raw_text).toContain('Jl. Mawar 2');
  });
});
