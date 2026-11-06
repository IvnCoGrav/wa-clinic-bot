import { describe, it, expect } from 'vitest';
import { buildConversationUpdatedPayload } from '../../src/services/conversation.service';

/**
 * Kontrak payload SSE `conversation.updated` (audit C-001/C-002):
 * badge LiveChat harus menerima sumber lokasi kanonik + flag sharelocNeeded,
 * agar tidak bergantung pada kolom `customers.location_source` yang bisa basi.
 */
describe('buildConversationUpdatedPayload — lokasi kanonik', () => {
  const base = {
    id: 'conv-1',
    current_state: 'HUMAN_HANDLING',
    customer_id: 'cust-1',
  };

  it('Bunda Hida: kolom estimated_area tapi preferences manual_staff → manual_staff + tidak butuh shareloc', () => {
    const payload = buildConversationUpdatedPayload({
      ...base,
      customer: {
        id: 'cust-hida',
        location_source: 'estimated_area',
        share_location_sent: false,
        lat: -7.3805925,
        lng: 112.6749883,
        kelurahan: 'Panjunan',
        preferences: {
          location_source: 'manual_staff',
          location_updated_by_staff_id: 'staff-1',
          location_updated_by_staff_name: 'Bidan Yusi F',
          location_accuracy_m: 14,
          house_photo_url: '/media/rumah.jpg',
          saved_addresses: [
            {
              id: 'addr-1',
              isPrimary: true,
              address: 'Perum Berlian Kencana Sari Blok T05. Panjunan',
              locationSource: 'estimated_area',
              lat: -7.3805925,
              lng: 112.6749883,
            },
          ],
          location_history: [
            { source: 'manual_staff', lat: -7.3805925, lng: 112.6749883, updatedAt: '2026-10-03T14:29:07.243Z' },
          ],
        },
      },
    } as any);

    expect(payload.effectiveLocationSource).toBe('manual_staff');
    expect(payload.locationAdequacy).toBe('staff_verified');
    expect(payload.sharelocNeeded).toBe(false);
  });

  it('Bunda Diana: manual_staff → tidak butuh shareloc', () => {
    const payload = buildConversationUpdatedPayload({
      ...base,
      customer: {
        id: 'cust-diana',
        location_source: 'manual_staff',
        share_location_sent: false,
        lat: -7.2148994,
        lng: 112.7723543,
        kelurahan: 'Tambakwedi',
        preferences: {
          location_source: 'manual_staff',
          location_updated_by_staff_id: 'staff-1',
          location_accuracy_m: 14,
          saved_addresses: [
            { id: 'addr-1', isPrimary: true, address: 'Tambak wedi baru 15 no 83', locationSource: 'estimated_area' },
          ],
        },
      },
    } as any);

    expect(payload.effectiveLocationSource).toBe('manual_staff');
    expect(payload.sharelocNeeded).toBe(false);
  });

  it('Bunda Lutfiah: gps_pin + share_location_sent → tidak butuh shareloc', () => {
    const payload = buildConversationUpdatedPayload({
      ...base,
      customer: {
        id: 'cust-lutfiah',
        location_source: 'gps_pin',
        share_location_sent: true,
        lat: -7.3276242,
        lng: 112.7677506,
        kelurahan: 'Kalirungkut',
        preferences: {
          saved_addresses: [{ id: 'addr-1', isPrimary: true, address: 'Rungkut kidul', locationSource: 'gps_pin' }],
        },
      },
    } as any);

    expect(payload.effectiveLocationSource).toBe('gps_pin');
    expect(payload.sharelocNeeded).toBe(false);
  });

  it('estimasi wilayah tanpa bukti lapangan → tetap butuh shareloc', () => {
    const payload = buildConversationUpdatedPayload({
      ...base,
      customer: {
        id: 'cust-new',
        location_source: 'estimated_area',
        share_location_sent: false,
        lat: -7.3,
        lng: 112.7,
        kelurahan: 'Rungkut',
        preferences: {
          saved_addresses: [{ id: 'addr-1', isPrimary: true, address: 'Jl. Baru', locationSource: 'estimated_area' }],
        },
      },
    } as any);

    expect(payload.effectiveLocationSource).toBe('estimated_area');
    expect(payload.sharelocNeeded).toBe(true);
  });
});
