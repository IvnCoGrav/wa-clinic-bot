import { prisma } from '../db/client';

/**
 * customer.repository.ts — Seam persistensi customer (PLAN 8 FASE 5a).
 *
 * Masalah: `customer.service.ts` menangkap SEMUA error DB lalu mengembalikan
 * objek mock (`cust_<ts>`) sebagai "sukses" — data hilang saat restart tanpa jejak.
 *
 * Solusi (Keputusan #1A bertahap + #2A throw+eskalasi):
 *  - `CustomerRepository`: kontrak persistensi murni (tanpa logika bisnis).
 *  - `PostgresCustomerRepository`: adapter produksi — error DB DILEMPAR (fail-closed),
 *    tidak pernah membuat objek fiktif.
 *  - `InMemoryCustomerRepository`: test double eksplisit — HANYA dipakai bila
 *    di-inject via `setCustomerRepository` (test). Tidak pernah dipakai implisit.
 *  - Wiring: module-level setter dengan default produksi (menghindari refactor
 *    159 call site sekaligus; konsisten dengan pola singleton service yang ada).
 *
 * Cakupan 5a: metode identitas + tulis (getOrCreate, getById, getByPhone, update).
 * Metode baca agregat (list, stats) tetap di service dengan fallback eksplisit
 * (ditandai TODO_REPOSITORY) — bukan jalur integritas percakapan.
 */

export interface CustomerCreateData {
  tenant_id: string;
  phone: string;
  name?: string | null;
  is_sandbox_test?: boolean;
}

export interface CustomerRepository {
  findByPhone(phone: string, tenantId: string): Promise<any | null>;
  /**
   * Cari berdasarkan nomor saja lintas tenant.
   * Diperlukan selama skema masih `phone @unique` global (SAAS_READINESS P1 #11):
   * mencegah create duplikat yang pasti gagal unique-violation di produksi.
   * Setelah migrasi ke `@@unique([tenant_id, phone])`, metode ini tidak dipakai lagi.
   */
  findByPhoneGlobal(phone: string): Promise<any | null>;
  findById(id: string, tenantId: string): Promise<any | null>;
  create(data: CustomerCreateData): Promise<any>;
  update(id: string, patch: Record<string, unknown>): Promise<any>;
  /**
   * Update SEMUA record dengan nomor ini lintas tenant (semantik setLabelFlags:
   * flag hold/admin bersifat phone-global). Mengembalikan jumlah terupdate.
   */
  updateManyByPhone(phone: string, patch: Record<string, unknown>): Promise<number>;
}

/** Adapter produksi: fail-closed — error DB dilempar, tanpa objek fiktif. */
export class PostgresCustomerRepository implements CustomerRepository {
  async findByPhone(phone: string, tenantId: string): Promise<any | null> {
    const customer = await prisma.customer.findFirst({ where: { phone, tenant_id: tenantId } });
    return customer ?? null;
  }

  async findByPhoneGlobal(phone: string): Promise<any | null> {
    const customer = await prisma.customer.findFirst({ where: { phone } });
    return customer ?? null;
  }

  async findById(id: string, tenantId: string): Promise<any | null> {
    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) return null;
    if (tenantId && (customer as any).tenant_id && (customer as any).tenant_id !== tenantId) return null;
    return customer;
  }

  async create(data: CustomerCreateData): Promise<any> {
    const created = await prisma.customer.create({
      data: {
        tenant_id: data.tenant_id,
        phone: data.phone,
        name: data.name ?? null,
        labels_synced_at: new Date(),
        is_sandbox_test: data.is_sandbox_test ?? false,
      },
    });
    if (!created) throw new Error('Database create returned null/undefined');
    return created;
  }

  async update(id: string, patch: Record<string, unknown>): Promise<any> {
    return await prisma.customer.update({ where: { id }, data: patch as any });
  }

  async updateManyByPhone(phone: string, patch: Record<string, unknown>): Promise<number> {
    const res = await prisma.customer.updateMany({ where: { phone }, data: patch as any });
    return res?.count ?? 0;
  }
}

/** Test double eksplisit: penyimpanan memori tanpa I/O. HANYA untuk test. */
export class InMemoryCustomerRepository implements CustomerRepository {
  private store = new Map<string, any>();

  async findByPhone(phone: string, tenantId: string): Promise<any | null> {
    for (const c of this.store.values()) {
      if (c?.phone === phone && (!tenantId || c?.tenant_id === tenantId)) return c;
    }
    return null;
  }

  async findByPhoneGlobal(phone: string): Promise<any | null> {
    for (const c of this.store.values()) {
      if (c?.phone === phone) return c;
    }
    return null;
  }

  async findById(id: string, tenantId: string): Promise<any | null> {
    const c = this.store.get(id);
    if (!c) return null;
    if (tenantId && c.tenant_id && c.tenant_id !== tenantId) return null;
    return c;
  }

  async create(data: CustomerCreateData): Promise<any> {
    const row = {
      id: `cust_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      tenant_id: data.tenant_id,
      phone: data.phone,
      name: data.name ?? null,
      kelurahan: null, kecamatan: null, kota: null,
      lat: null, lng: null, distance_km: null, ongkir: null,
      is_out_of_coverage: false,
      status: 'active',
      is_sandbox_test: data.is_sandbox_test ?? false,
      is_admin_labeled: false, is_hold_labeled: false,
      labels_synced_at: new Date(),
      created_at: new Date(), updated_at: new Date(),
    };
    this.store.set(row.id, row);
    return row;
  }

  async update(id: string, patch: Record<string, unknown>): Promise<any> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`InMemoryCustomerRepository: customer ${id} not found`);
    const updated = { ...existing, ...patch, updated_at: new Date() };
    this.store.set(id, updated);
    return updated;
  }

  async updateManyByPhone(phone: string, patch: Record<string, unknown>): Promise<number> {
    let count = 0;
    for (const [id, c] of this.store.entries()) {
      if (c?.phone === phone) {
        this.store.set(id, { ...c, ...patch, updated_at: new Date() });
        count++;
      }
    }
    return count;
  }

  /** Untuk test: kosongkan store antar-test. */
  clear(): void {
    this.store.clear();
  }
}

let activeRepo: CustomerRepository = new PostgresCustomerRepository();

/** Adapter aktif (default: Postgres produksi). */
export function getCustomerRepository(): CustomerRepository {
  return activeRepo;
}

/** HANYA untuk test — inject adapter in-memory. */
export function setCustomerRepository(next: CustomerRepository): void {
  activeRepo = next;
}

/** HANYA untuk test — kembalikan ke adapter produksi. */
export function resetCustomerRepository(): void {
  activeRepo = new PostgresCustomerRepository();
}
