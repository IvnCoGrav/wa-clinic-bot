import { describe, it, expect, vi } from 'vitest';
import {
  isCustomerMatch,
  resolvePaymentMethodCell,
  formatReservationToRow,
  EMPTY_CELL,
} from '../../src/services/sheets/row-formatter';
import {
  SheetsSyncService,
  ReservationForSheets,
  SheetsConfigRow,
} from '../../src/services/sheets/sheets-sync.service';
import {
  SheetsGateway,
  GoogleSheetsGateway,
} from '../../src/services/sheets/sheets-client';

describe('isCustomerMatch — pencocokan nama defensif toleran prefix & variasi', () => {
  it('mencocokkan nama dengan prefix Bunda vs tanpa prefix', () => {
    expect(isCustomerMatch('Bunda Riska Elia', 'Riska Elia')).toBe(true);
    expect(isCustomerMatch('Riska Elia', 'Bunda Riska Elia')).toBe(true);
    expect(isCustomerMatch('bunda riska elia', 'RISKA ELIA')).toBe(true);
  });

  it('mencocokkan nama dengan variasi tanda baca / spasi', () => {
    expect(isCustomerMatch('Bunda PAW (Mia)', 'Mia')).toBe(true);
    expect(isCustomerMatch('Bunda Devia / Arka', 'Devia')).toBe(true);
  });

  it('menolak nama yang berbeda', () => {
    expect(isCustomerMatch('Bunda Binti', 'Riska Elia')).toBe(false);
    expect(isCustomerMatch('Bunda Devia', 'Bunda Mery')).toBe(false);
  });

  it('ADVERSARIAL: nilai null, undefined, atau string kosong tidak match', () => {
    expect(isCustomerMatch(null, 'Riska Elia')).toBe(false);
    expect(isCustomerMatch('Bunda Mia', undefined)).toBe(false);
    expect(isCustomerMatch('', '')).toBe(false);
  });
});

describe('resolvePaymentMethodCell — format hyperlink bukti bayar', () => {
  it('tanpa bukti bayar: mengembalikan teks metode bayar polos', () => {
    const cell = resolvePaymentMethodCell({
      id: 'res-1',
      booking_date: new Date('2026-10-12T03:00:00Z'),
      payment_method: 'Transfer BCA',
      proof_url: null,
    });
    expect(cell).toBe('Transfer BCA');
  });

  it('dengan bukti bayar & id: menghasilkan formula =HYPERLINK dengan titik-koma', () => {
    const cell = resolvePaymentMethodCell(
      {
        id: '02541103-fb9a-4064-9f42-c525b570be12',
        booking_date: new Date('2026-10-12T03:00:00Z'),
        payment_method: 'QRIS',
        proof_url: '/uploads/payment-proofs/proof-123.jpg',
      },
      'https://app.kalababyspa.online'
    );
    expect(cell).toBe(
      '=HYPERLINK("https://app.kalababyspa.online/proof/02541103-fb9a-4064-9f42-c525b570be12"; "QRIS")'
    );
  });

  it('dengan bukti bayar tapi payment_method kosong: fallback ke label "Bukti Bayar"', () => {
    const cell = resolvePaymentMethodCell(
      {
        id: 'res-abc',
        booking_date: new Date('2026-10-12T03:00:00Z'),
        payment_method: null,
        proof_url: '/uploads/proof.jpg',
      },
      'https://app.kalababyspa.online'
    );
    expect(cell).toBe(
      '=HYPERLINK("https://app.kalababyspa.online/proof/res-abc"; "Bukti Bayar")'
    );
  });

  it('menangani tanda kutip ganda di label secara aman (escaped "")', () => {
    const cell = resolvePaymentMethodCell(
      {
        id: 'res-quote',
        booking_date: new Date('2026-10-12T03:00:00Z'),
        payment_method: 'Transfer "BCA" Syariah',
        proof_url: '/uploads/proof.jpg',
      },
      'https://app.kalababyspa.online'
    );
    expect(cell).toBe(
      '=HYPERLINK("https://app.kalababyspa.online/proof/res-quote"; "Transfer ""BCA"" Syariah")'
    );
  });
});

describe('Dynamic Row Reconciliation Guard — proteksi pergeseran baris di sheets-sync', () => {
  const dummyConfig: SheetsConfigRow = {
    tenant_id: 'default-tenant',
    is_enabled: true,
    file_base_name: 'Rekapan Pasien',
    master_spreadsheet_id: 'sheet-123',
    yearly_file_ids: { '2026': 'sheet-2026' },
    month_tab_names: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Agu', 'Sep', 'okt', 'Nov', 'Des'],
    template_sheet_name: '_TEMPLATE',
  };

  const dummyReservation: ReservationForSheets = {
    id: 'res-riska',
    tenant_id: 'default-tenant',
    booking_date: new Date('2026-10-12T03:00:00Z'),
    treatment_detail: 'Pijat Lahap Juara',
    treatment_category: 'BABY',
    purchase_value: 90000,
    delivery_fee: 0,
    discount_amount: 0,
    payment_method: 'QRIS',
    proof_url: '/uploads/proof-riska.jpg',
    is_repeat_order: false,
    status: 'completed',
    raw_text: null,
    sheets_spreadsheet_id: 'sheet-2026',
    sheets_tab_name: 'okt',
    sheets_row_index: 53, // Tergeser di DB: tercatat 53 padahal riilnya di row 52!
    customer: {
      name: 'Bunda Riska Elia',
      kelurahan: 'sukolilo',
      kecamatan: 'sukolilo',
      kota: 'surabaya',
      ongkir: 0,
    },
    children: [],
    assigned_staff: { name: 'Bidan Nita' },
  };

  it('otomatis mendeteksi pergeseran baris dan mengupdate ke baris riil yang benar', async () => {
    const updatedCellsHistory: any[] = [];
    let savedRowIndex: number | null = null;

    const mockGateway: SheetsGateway = {
      ensureMonthlyTab: vi.fn().mockResolvedValue({ tabName: 'okt', created: false }),
      appendRow: vi.fn(),
      updateCells: vi.fn().mockImplementation(async (params) => {
        updatedCellsHistory.push(params);
      }),
      reconcileRowIndex: vi.fn().mockImplementation(async ({ expectedRowIndex, customerName }) => {
        // Simulasi: expected 53, tapi deteksi di sheet menunjukkan baris riil 52!
        if (expectedRowIndex === 53 && customerName === 'Bunda Riska Elia') {
          return 52;
        }
        return expectedRowIndex;
      }),
    };

    const mockStore = {
      getConfig: vi.fn().mockResolvedValue(dummyConfig),
      getReservation: vi.fn().mockResolvedValue(dummyReservation),
      saveRowRef: vi.fn().mockImplementation(async (_id, _tenant, ref) => {
        savedRowIndex = ref.rowIndex;
      }),
      upsertOutbox: vi.fn(),
      listPending: vi.fn(),
      markDone: vi.fn(),
      markFailed: vi.fn(),
    };

    const service = new SheetsSyncService();
    service.setGateway(mockGateway);
    service.setStore(mockStore as any);

    await service.syncReservation('res-riska', 'default-tenant');

    // 1. reconcileRowIndex dipanggil
    expect(mockGateway.reconcileRowIndex).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRowIndex: 53,
        customerName: 'Bunda Riska Elia',
      })
    );

    // 2. updateCells menulis ke baris 52 (bukan 53!)
    expect(updatedCellsHistory).toHaveLength(1);
    expect(updatedCellsHistory[0].rowIndex).toBe(52);

    // 3. saveRowRef memperbarui DB menjadi baris 52
    expect(savedRowIndex).toBe(52);
  });

  it('GoogleSheetsGateway.reconcileRowIndex memindai sheet dan mengembalikan baris yang bergeser', async () => {
    const gateway = new GoogleSheetsGateway();

    (gateway as any).getSheets = vi.fn().mockResolvedValue({
      spreadsheets: {
        values: {
          get: vi.fn().mockImplementation(async ({ range }: { range: string }) => {
            // Parse startRow and endRow from range, e.g. "okt!A38:C68"
            const match = range.match(/!A(\d+):C(\d+)/);
            const reqStart = match ? parseInt(match[1], 10) : 37;
            const reqEnd = match ? parseInt(match[2], 10) : 67;

            const values: any[][] = [];
            for (let r = reqStart; r <= reqEnd; r++) {
              if (r === 51) {
                values.push(['2026-10-12', 'Senin', 'Bunda Mery']);
              } else if (r === 52) {
                values.push(['2026-10-12', 'Senin', 'Bunda Riska Elia']);
              } else if (r === 53) {
                values.push(['2026-10-12', 'Senin', 'Bunda Binti']);
              } else {
                values.push(['2026-10-12', 'Senin', `Customer ${r}`]);
              }
            }
            return { data: { values } };
          }),
        },
      },
    });

    // Test 1: Expected 52 untuk Bunda Riska Elia (posisi pas, tidak bergeser)
    const exact = await gateway.reconcileRowIndex({
      tenantId: 'default-tenant',
      spreadsheetId: 'sheet-123',
      tabName: 'okt',
      expectedRowIndex: 52,
      customerName: 'Bunda Riska Elia',
    });
    expect(exact).toBe(52);

    // Test 2: Expected 53 untuk Bunda Riska Elia (di DB tercatat 53, tapi di sheet ada di 52)
    const shifted = await gateway.reconcileRowIndex({
      tenantId: 'default-tenant',
      spreadsheetId: 'sheet-123',
      tabName: 'okt',
      expectedRowIndex: 53,
      customerName: 'Bunda Riska Elia',
    });
    expect(shifted).toBe(52);

    // Test 3: Customer tidak ada di sheet -> fallback ke expectedRowIndex
    const notFound = await gateway.reconcileRowIndex({
      tenantId: 'default-tenant',
      spreadsheetId: 'sheet-123',
      tabName: 'okt',
      expectedRowIndex: 99,
      customerName: 'Bunda Tidak Ada',
    });
    expect(notFound).toBe(99);
  });
});

