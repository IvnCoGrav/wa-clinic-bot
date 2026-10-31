import { describe, it, expect } from 'vitest';
import { clusterAddressesWithPass4 } from '../../src/scripts/heal-customer-addresses-split-brain';

describe('Heal Customer Address Split-Brain — Pass 4 Unit Tests', () => {
  it('Bunda Haniyyah scenario: ghost card tanpa identitas digabung ke sibling pemenang beridentitas se-kota', () => {
    const siblings = [
      {
        id: '19bb3366-ghost',
        customer_id: 'cust-1',
        label: 'Rumah pacar Keling, Tambaksari',
        address: '',
        kelurahan: null,
        kecamatan: 'pacar Keling, Tambaksari',
        kota: 'Kota Surabaya',
        lat: null,
        lng: null,
        is_primary: false,
        last_used_at: new Date('2026-10-30T12:59:00Z'),
      },
      {
        id: '17e5b6cb-winner',
        customer_id: 'cust-1',
        label: 'Rumah Tambaksari',
        address: 'jl.gersikan VI no 8',
        kelurahan: 'Pacarkembang',
        kecamatan: 'Tambaksari',
        kota: 'Kota Surabaya',
        lat: -7.2556424,
        lng: 112.7640328,
        location_source: 'gps_pin',
        is_primary: true,
        last_used_at: new Date('2026-10-30T13:03:00Z'),
      },
    ];

    const clusters = clusterAddressesWithPass4(siblings);
    expect(clusters.length).toBe(1);
    expect(clusters[0].map((c) => c.id)).toContain('17e5b6cb-winner');
    expect(clusters[0].map((c) => c.id)).toContain('19bb3366-ghost');
  });

  it('Anti-overmerge: dua rumah sah dengan jalan berbeda di kota yang sama TIDAK boleh diklaster', () => {
    const siblings = [
      {
        id: 'h1',
        customer_id: 'cust-multi',
        address: 'Jl. Rungkut Asri No. 10',
        kelurahan: 'Rungkut Kidul',
        kecamatan: 'Rungkut',
        kota: 'Kota Surabaya',
        lat: -7.32,
        lng: 112.77,
      },
      {
        id: 'h2',
        customer_id: 'cust-multi',
        address: 'Jl. Dharmahusada Indah No. 5',
        kelurahan: 'Mulyorejo',
        kecamatan: 'Mulyorejo',
        kota: 'Kota Surabaya',
        lat: -7.27,
        lng: 112.78,
      },
    ];

    const clusters = clusterAddressesWithPass4(siblings);
    expect(clusters.length).toBe(0);
  });

  it('Kartu hantu sendirian (single card): tidak ada sibling beridentitas → tidak diklaster (REPORT_ONLY)', () => {
    const siblings = [
      {
        id: 'ghost-alone',
        customer_id: 'cust-alone',
        address: '',
        kelurahan: null,
        kecamatan: 'Waru',
        kota: 'Kabupaten Sidoarjo',
        lat: null,
        lng: null,
      },
    ];

    const clusters = clusterAddressesWithPass4(siblings);
    expect(clusters.length).toBe(0);
  });

  it('Beda kota: kartu hantu di Malang tidak boleh digabung ke kartu Surabaya', () => {
    const siblings = [
      {
        id: 'ghost-malang',
        customer_id: 'cust-diff-city',
        address: '',
        kelurahan: null,
        kecamatan: 'Klojen',
        kota: 'Kota Malang',
        lat: null,
        lng: null,
      },
      {
        id: 'winner-sby',
        customer_id: 'cust-diff-city',
        address: 'Jl. Pemuda No. 1',
        kelurahan: 'Embong Kaliasin',
        kecamatan: 'Genteng',
        kota: 'Kota Surabaya',
        lat: -7.26,
        lng: 112.74,
      },
    ];

    const clusters = clusterAddressesWithPass4(siblings);
    expect(clusters.length).toBe(0);
  });
});
