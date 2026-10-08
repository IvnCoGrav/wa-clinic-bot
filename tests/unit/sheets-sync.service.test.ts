import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SheetsSyncService,
  PrismaSheetsSyncStore,
  SheetsSyncStore,
  SheetsConfigRow,
  ReservationForSheets,
  OutboxRow,
  SHEETS_YEAR_NOT_CONFIGURED,
  SHEETS_SKIP_NON_COMPLETED,
} from '../../src/services/sheets/sheets-sync.service';
import { prisma } from '../../src/db/client';
import {
  SheetsGateway,
  EnsureMonthlyTabParams,
  EnsureMonthlyTabResult,
  AppendRowParams,
  AppendRowResult,
  UpdateCellsParams,
} from '../../src/services/sheets/sheets-client';

/** Fake gateway: merekam panggilan, tanpa jaringan. */
class FakeGateway implements SheetsGateway {
  public tabs: EnsureMonthlyTabParams[] = [];
  public appended: AppendRowParams[] = [];
  public updated: UpdateCellsParams[] = [];
  private existingTabs = new Set<string>();
  private nextRow = 2;

  async ensureMonthlyTab(p: EnsureMonthlyTabParams): Promise<EnsureMonthlyTabResult> {
    this.tabs.push(p);
    const key = `${p.spreadsheetId}!${p.tabName.toLowerCase()}`;
    if (this.existingTabs.has(key)) return { tabName: p.tabName, created: false };
    this.existingTabs.add(key);
    return { tabName: p.tabName, created: true };
  }
  async appendRow(p: AppendRowParams): Promise<AppendRowResult> {
    this.appended.push(p);
    return { rowIndex: this.nextRow++ };
  }
  async updateCells(p: UpdateCellsParams): Promise<void> {
    this.updated.push(p);
  }
}

/** Store in-memory: tanpa Prisma. */
class MemoryStore implements SheetsSyncStore {
  public config: SheetsConfigRow | null = null;
  public reservations = new Map<string, ReservationForSheets>();
  public outbox = new Map<string, OutboxRow & { status: string; nextRetryAt: Date | null; lastError?: string; attempts: number }>();
  public savedRefs: Array<{ reservationId: string; ref: any }> = [];

  async getConfig(): Promise<SheetsConfigRow | null> {
    return this.config;
  }
  async getReservation(id: string): Promise<ReservationForSheets | null> {
    return this.reservations.get(id) ?? null;
  }
  async saveRowRef(reservationId: string, _t: string, ref: any): Promise<void> {
    this.savedRefs.push({ reservationId, ref });
    const r = this.reservations.get(reservationId);
    if (r) {
      r.sheets_spreadsheet_id = ref.spreadsheetId;
      r.sheets_tab_name = ref.tabName;
      r.sheets_row_index = ref.rowIndex;
    }
  }
  async upsertOutbox(tenantId: string, reservationId: string): Promise<void> {
    const key = `${tenantId}:${reservationId}`;
    const ex = this.outbox.get(key);
    if (ex) {
      if (ex.status !== 'processing') ex.status = 'pending';
      return;
    }
    this.outbox.set(key, { id: key, tenant_id: tenantId, reservation_id: reservationId, attempts: 0, status: 'pending', nextRetryAt: null });
  }
  async listPending(tenantId: string, now: Date): Promise<OutboxRow[]> {
    return [...this.outbox.values()]
      .filter((o) => o.tenant_id === tenantId)
      .filter((o) => o.status === 'pending' || o.status === 'processing')
      .filter((o) => !o.nextRetryAt || o.nextRetryAt.getTime() <= now.getTime())
      .map((o) => ({ id: o.id, tenant_id: o.tenant_id, reservation_id: o.reservation_id, attempts: o.attempts }));
  }
  async markDone(id: string): Promise<void> {
    const o = this.outbox.get(id);
    if (o) o.status = 'done';
  }
  async markFailed(id: string, error: string): Promise<void> {
    const o = this.outbox.get(id);
    if (o) {
      o.status = 'failed';
      o.lastError = error;
    }
  }
  async reschedule(id: string, next: Date, error: string): Promise<void> {
    const o = this.outbox.get(id);
    if (o) {
      o.status = 'pending';
      o.nextRetryAt = next;
      o.lastError = error;
    }
  }
  async incrementAttempt(id: string, next: Date, error: string): Promise<void> {
    const o = this.outbox.get(id);
    if (o) {
      o.status = 'pending';
      o.nextRetryAt = next;
      o.attempts += 1;
      o.lastError = error;
    }
  }
}

const TENANT = 'default-tenant';
const YEAR_ID = 'sheet-2026';

function makeConfig(over: Partial<SheetsConfigRow> = {}): SheetsConfigRow {
  return {
    tenant_id: TENANT,
    is_enabled: true,
    file_base_name: 'Rekapan Pasien',
    master_spreadsheet_id: YEAR_ID,
    yearly_file_ids: { '2026': YEAR_ID },
    month_tab_names: ['Jan', 'Feb', 'Mar', 'April', 'Mei', 'Juni', 'Juli', 'Aug', 'Sept', 'okt', 'Nov', 'Des'],
    template_sheet_name: '_TEMPLATE',
    ...over,
  };
}

function makeReservation(over: Partial<ReservationForSheets> = {}): ReservationForSheets {
  return {
    id: 'res-1',
    tenant_id: TENANT,
    booking_date: new Date('2026-10-01T03:00:00Z'),
    treatment_detail: 'Pijat Pulih Ceria',
    treatment_category: 'BABY',
    purchase_value: 135000,
    delivery_fee: 15000,
    discount_amount: 0,
    payment_method: null,
    is_repeat_order: false,
    status: 'completed',
    raw_text: 'Batuk pilek',
    sheets_spreadsheet_id: null,
    sheets_tab_name: null,
    sheets_row_index: null,
    customer: { name: 'Bunda Tere', kelurahan: 'tenggilis', kecamatan: 'tenggilis', kota: 'surabaya', ongkir: 15000 },
    children: [{ name: 'An. Keysha', raw_age_text: '10 bulan', age_months_at_registration: 10 }],
    assigned_staff: null,
    ...over,
  };
}

describe('SheetsSyncService — append/update idempoten', () => {
  let svc: SheetsSyncService;
  let gw: FakeGateway;
  let store: MemoryStore;

  beforeEach(() => {
    svc = new SheetsSyncService();
    gw = new FakeGateway();
    store = new MemoryStore();
    store.config = makeConfig();
    svc.setGateway(gw);
    svc.setStore(store);
  });

  it('booking pertama: buat tab bulan, append baris, simpan row ref', async () => {
    store.reservations.set('res-1', makeReservation());
    await svc.syncReservation('res-1', TENANT);

    expect(gw.tabs).toHaveLength(1);
    expect(gw.tabs[0].tabName).toBe('okt');
    expect(gw.appended).toHaveLength(1);
    expect(gw.appended[0].row).toHaveLength(16);
    expect(store.savedRefs[0].ref).toEqual({ spreadsheetId: YEAR_ID, tabName: 'okt', rowIndex: 2 });
    expect(gw.updated).toHaveLength(0);
  });

  it('IDEMPOTENSI: sync kedua → UPDATE baris yang sama, bukan append ganda', async () => {
    store.reservations.set('res-1', makeReservation());
    await svc.syncReservation('res-1', TENANT);
    await svc.syncReservation('res-1', TENANT);

    expect(gw.appended).toHaveLength(1); // tetap 1 baris
    expect(gw.updated).toHaveLength(1);   // kedua kali = update
    expect(gw.updated[0].rowIndex).toBe(2);
  });

  it('WRITE-ONCE HARGA & PROTEKSI MANUAL: update TIDAK menyentuh kolom H/I/J/K dan N/O/P', async () => {
    store.reservations.set('res-1', makeReservation());
    await svc.syncReservation('res-1', TENANT);
    await svc.syncReservation('res-1', TENANT);

    const cols = gw.updated[0].cells.map((c) => c.col);
    // Kolom 1-based: H=8, I=9, J=10, K=11 serta N=14, O=15, P=16 HARAM ditulis saat update.
    for (const protectedCol of [8, 9, 10, 11, 14, 15, 16]) {
      expect(cols).not.toContain(protectedCol);
    }
    // Kolom non-protected (mis. L Metode Bayar=12, M Bidan=13) tetap diperbarui.
    expect(cols).toContain(12);
    expect(cols).toContain(13);
  });

  it('GERBANG COMPLETED-ONLY: status non-completed melempar SHEETS_SKIP_NON_COMPLETED', async () => {
    for (const nonCompleted of ['confirmed', 'pending', 'cancelled', 'hold', 'en_route']) {
      store.reservations.set('res-non', makeReservation({ status: nonCompleted }));
      await expect(svc.syncReservation('res-non', TENANT)).rejects.toThrow(SHEETS_SKIP_NON_COMPLETED);
    }
    expect(gw.appended).toHaveLength(0);
  });

  it('EDGE ganti tahun belum dipetakan → SHEETS_YEAR_NOT_CONFIGURED (tunda, bukan tulis ke file salah)', async () => {
    store.reservations.set('res-1', makeReservation({ booking_date: new Date('2027-01-02T03:00:00Z') }));
    await expect(svc.syncReservation('res-1', TENANT)).rejects.toThrow(SHEETS_YEAR_NOT_CONFIGURED);
    expect(gw.appended).toHaveLength(0);
  });

  it('ADVERSARIAL: tanggal kosong → throw INVALID_BOOKING_DATE (tidak menulis tab salah)', async () => {
    store.reservations.set('res-1', makeReservation({ booking_date: null }));
    await expect(svc.syncReservation('res-1', TENANT)).rejects.toThrow('INVALID_BOOKING_DATE');
    expect(gw.appended).toHaveLength(0);
  });

  it('config nonaktif → enqueue tidak menambah outbox', async () => {
    store.config = makeConfig({ is_enabled: false });
    await svc.enqueue('res-1', TENANT);
    expect(store.outbox.size).toBe(0);
  });

  it('config aktif → enqueue menambah outbox sekali (anti-duplikat)', async () => {
    await svc.enqueue('res-1', TENANT);
    await svc.enqueue('res-1', TENANT);
    expect(store.outbox.size).toBe(1);
  });

  it('testConnection: menyiapkan tab bulan berjalan tanpa menulis baris', async () => {
    const result = await svc.testConnection(TENANT);
    expect(gw.tabs).toHaveLength(1);
    expect(gw.appended).toHaveLength(0); // tes koneksi TIDAK menulis baris data
    expect(result.created).toBe(true);
    expect(result.tabName).toBe(gw.tabs[0].tabName);
  });

  it('testConnection: tahun berjalan belum dipetakan → throw SHEETS_YEAR_NOT_CONFIGURED', async () => {
    store.config = makeConfig({ yearly_file_ids: {} });
    await expect(svc.testConnection(TENANT)).rejects.toThrow(SHEETS_YEAR_NOT_CONFIGURED);
  });
});

describe('PrismaSheetsSyncStore.getReservation — ordinal riwayat kanonis (kontrak query)', () => {
  const CREATED = new Date('2026-10-02T03:00:00.000Z');

  beforeEach(() => {
    (prisma as any).reservation.findFirst = vi.fn().mockResolvedValue({
      id: 'res-1',
      tenant_id: TENANT,
      customer_id: 'cust-1',
      created_at: CREATED,
      is_repeat_order: true, // flag DB terkontaminasi (bug follow-up lama)
      customer: null,
      children: [],
      assigned_staff: null,
    });
  });

  it('order #1 (0 riwayat lebih awal, flag DB bohong true) → prior=0, flag dipaksa false', async () => {
    (prisma as any).reservation.count = vi.fn().mockResolvedValue(0);
    const store = new PrismaSheetsSyncStore();

    const r = await store.getReservation('res-1', TENANT);

    expect(r?.prior_reservations_count).toBe(0);
    expect(r?.is_repeat_order).toBe(false);
    // Kontrak query kanonis: status confirmed/en_route/completed + created_at LT.
    expect((prisma as any).reservation.count).toHaveBeenCalledWith({
      where: {
        customer_id: 'cust-1',
        tenant_id: TENANT,
        status: { in: ['confirmed', 'en_route', 'completed'] },
        created_at: { lt: CREATED },
      },
    });
  });

  it('order #2+ (2 riwayat lebih awal, flag DB stale false) → prior=2, flag dipaksa true', async () => {
    (prisma as any).reservation.count = vi.fn().mockResolvedValue(2);
    const store = new PrismaSheetsSyncStore();

    const r = await store.getReservation('res-1', TENANT);

    expect(r?.prior_reservations_count).toBe(2);
    expect(r?.is_repeat_order).toBe(true);
  });

  it('ADVERSARIAL: DB offline saat count → fail-safe prior=0 (New), tidak melempar', async () => {
    (prisma as any).reservation.count = vi.fn().mockRejectedValue(new Error('Database offline'));
    const store = new PrismaSheetsSyncStore();

    const r = await store.getReservation('res-1', TENANT);

    expect(r).not.toBeNull();
    expect(r?.prior_reservations_count).toBe(0);
    expect(r?.is_repeat_order).toBe(false);
  });

  it('reservasi tidak ditemukan → null', async () => {
    (prisma as any).reservation.findFirst = vi.fn().mockResolvedValue(null);
    const store = new PrismaSheetsSyncStore();

    const r = await store.getReservation('missing', TENANT);

    expect(r).toBeNull();
  });
});

describe('SheetsSyncService — processOutbox retry/backoff', () => {
  let svc: SheetsSyncService;
  let gw: FakeGateway;
  let store: MemoryStore;

  beforeEach(() => {
    svc = new SheetsSyncService();
    gw = new FakeGateway();
    store = new MemoryStore();
    store.config = makeConfig();
    svc.setGateway(gw);
    svc.setStore(store);
    store.reservations.set('res-1', makeReservation());
  });

  it('sukses → status done, tidak ada sisa pending', async () => {
    await svc.enqueue('res-1', TENANT);
    const res = await svc.processOutbox(TENANT);
    expect(res.succeeded).toBe(1);
    expect([...store.outbox.values()][0].status).toBe('done');
    expect(gw.appended).toHaveLength(1);
  });

  it('Google belum connect (SHEETS_NOT_CONNECTED) → ditunda, attempts TIDAK habis', async () => {
    // Gateway yang selalu melempar NOT_CONNECTED.
    const throwing: SheetsGateway = {
      ensureMonthlyTab: async () => { throw new Error('SHEETS_NOT_CONNECTED'); },
      appendRow: async () => { throw new Error('SHEETS_NOT_CONNECTED'); },
      updateCells: async () => { throw new Error('SHEETS_NOT_CONNECTED'); },
    };
    svc.setGateway(throwing);
    await svc.enqueue('res-1', TENANT);
    const res = await svc.processOutbox(TENANT);
    expect(res.deferred).toBe(1);
    const o = [...store.outbox.values()][0];
    expect(o.status).toBe('pending');
    expect(o.attempts).toBe(0);
  });

  it('error keras berulang → attempts naik; sampai batas → status failed (retry tidak abadi)', async () => {
    const throwing: SheetsGateway = {
      ensureMonthlyTab: async () => { throw new Error('RANDOM_GOOGLE_500'); },
      appendRow: async () => { throw new Error('RANDOM_GOOGLE_500'); },
      updateCells: async () => { throw new Error('RANDOM_GOOGLE_500'); },
    };
    svc.setGateway(throwing);
    await svc.enqueue('res-1', TENANT);

    // Paksa nextRetryAt ke masa lalu tiap iterasi agar langsung diproses lagi.
    for (let i = 0; i < 10; i++) {
      const o = [...store.outbox.values()][0];
      if (o.nextRetryAt) o.nextRetryAt = new Date(Date.now() - 1000);
      await svc.processOutbox(TENANT);
    }
    const finalRow = [...store.outbox.values()][0];
    expect(finalRow.status).toBe('failed');
    expect(finalRow.attempts).toBeGreaterThanOrEqual(9);
  });

  it('outbox item dengan status non-completed → dilewati (skipped: 1, outbox markDone)', async () => {
    store.reservations.set('res-1', makeReservation({ status: 'confirmed' }));
    await svc.enqueue('res-1', TENANT);
    const res = await svc.processOutbox(TENANT);
    expect(res.skipped).toBe(1);
    expect(res.succeeded).toBe(0);
    expect([...store.outbox.values()][0].status).toBe('done');
    expect(gw.appended).toHaveLength(0);
  });

  it('anti-infinite-defer: INVALID_BOOKING_DATE setelah MAX_ATTEMPTS → markFailed', async () => {
    store.reservations.set('res-1', makeReservation({ booking_date: null }));
    await svc.enqueue('res-1', TENANT);

    for (let i = 0; i < 10; i++) {
      const o = [...store.outbox.values()][0];
      if (o.nextRetryAt) o.nextRetryAt = new Date(Date.now() - 1000);
      await svc.processOutbox(TENANT);
    }
    const finalRow = [...store.outbox.values()][0];
    expect(finalRow.status).toBe('failed');
    expect(finalRow.lastError).toContain('EXCEEDED_MAX_DEFERRALS');
  });
});
