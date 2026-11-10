import { prisma } from '../db/client';
import type { Customer } from '@prisma/client';
import { normalizePhoneID } from '../utils/phone-normalizer';

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
  name_source?: string | null;
  whatsapp_push_name?: string | null;
  is_sandbox_test?: boolean;
  is_internal_staff?: boolean;
}

export interface CustomerRepository {
  findByPhone(phone: string, tenantId: string): Promise<Customer | null>;
  findById(id: string, tenantId: string): Promise<Customer | null>;
  create(data: CustomerCreateData): Promise<Customer>;
  update(id: string, patch: Record<string, unknown>, tenantId: string): Promise<Customer>;
  /**
   * Update SEMUA record dalam SATU tenant dengan nomor ini (tenant-scoped).
   * Semantik setLabelFlags kini per-tenant (skema: @@unique([tenant_id, phone])).
   */
  updateManyByPhoneTenant(phone: string, tenantId: string, patch: Record<string, unknown>): Promise<number>;
}

/** Adapter produksi: fail-closed — error DB dilempar, tanpa objek fiktif. */
export class PostgresCustomerRepository implements CustomerRepository {
  async findByPhone(phone: string, tenantId: string): Promise<Customer | null> {
    // D-08: Normalisasi nomor HP ke format kanonik E.164 (62xx)
    const targetPhone = normalizePhoneID(phone) || phone;
    const customer = await prisma.customer.findFirst({
      where: { phone: targetPhone, tenant_id: tenantId },
    });
    if (customer) return customer as Customer;
    if (targetPhone !== phone) {
      const rawCustomer = await prisma.customer.findFirst({
        where: { phone, tenant_id: tenantId },
      });
      if (rawCustomer) return rawCustomer as Customer;
    }
    return null;
  }

  async findById(id: string, tenantId: string): Promise<Customer | null> {
    // D-10: Cek via findUnique primary key + isolasi tenant ketat
    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) return null;
    if (tenantId && (customer as any).tenant_id && (customer as any).tenant_id !== tenantId) return null;
    return customer as Customer;
  }

  async create(data: CustomerCreateData): Promise<Customer> {
    const created = await prisma.customer.create({
      data: {
        tenant_id: data.tenant_id,
        phone: normalizePhoneID(data.phone) || data.phone,
        name: data.name ?? null,
        name_source: data.name_source ?? null,
        whatsapp_push_name: data.whatsapp_push_name ?? null,
        labels_synced_at: new Date(),
        is_sandbox_test: data.is_sandbox_test ?? false,
        is_internal_staff: data.is_internal_staff ?? false, // D-09
      },
    });
    if (!created) throw new Error('Database create returned null/undefined');
    return created as Customer;
  }

  async update(id: string, patch: Record<string, unknown>, tenantId: string): Promise<Customer> {
    const existing = await prisma.customer.findUnique({ where: { id } });
    if (!existing) throw new Error(`Customer ${id} not found`);
    if ((existing as any).tenant_id && (existing as any).tenant_id !== tenantId) {
      throw new Error(`Customer ${id} bukan milik tenant ${tenantId}`);
    }
    const res = await prisma.customer.updateMany({
      where: { id, tenant_id: tenantId },
      data: patch as any,
    });
    if (res.count === 0) throw new Error(`Customer ${id} not found for tenant ${tenantId}`);
    return (await prisma.customer.findUnique({ where: { id } })) as Customer;
  }

  async updateManyByPhoneTenant(phone: string, tenantId: string, patch: Record<string, unknown>): Promise<number> {
    // D-08: Normalisasi nomor HP ke format kanonik E.164
    const targetPhone = normalizePhoneID(phone) || phone;
    const res = await prisma.customer.updateMany({
      where: { phone: targetPhone, tenant_id: tenantId },
      data: patch as any,
    });
    return res?.count ?? 0;
  }
}

/** Test double eksplisit: penyimpanan memori tanpa I/O. HANYA untuk test. */
export class InMemoryCustomerRepository implements CustomerRepository {
  private store = new Map<string, any>();

  async findByPhone(phone: string, tenantId: string): Promise<Customer | null> {
    const norm = normalizePhoneID(phone);
    for (const c of this.store.values()) {
      const matchPhone = c?.phone === phone || (norm && normalizePhoneID(c?.phone) === norm);
      if (matchPhone && (!tenantId || c?.tenant_id === tenantId)) return c;
    }
    return null;
  }

  async findById(id: string, tenantId: string): Promise<Customer | null> {
    const c = this.store.get(id);
    if (!c) return null;
    if (tenantId && c.tenant_id && c.tenant_id !== tenantId) return null;
    return c;
  }

  async create(data: CustomerCreateData): Promise<Customer> {
    const row = {
      id: `cust_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      tenant_id: data.tenant_id,
      phone: data.phone,
      name: data.name ?? null,
      name_source: data.name_source ?? null,
      whatsapp_push_name: data.whatsapp_push_name ?? null,
      kelurahan: null, kecamatan: null, kota: null,
      lat: null, lng: null, distance_km: null, ongkir: null,
      is_out_of_coverage: false,
      status: 'active',
      is_sandbox_test: data.is_sandbox_test ?? false,
      is_internal_staff: data.is_internal_staff ?? false, // D-09
      is_admin_labeled: false, is_hold_labeled: false,
      labels_synced_at: new Date(),
      created_at: new Date(), updated_at: new Date(),
    };
    this.store.set(row.id, row);
    return row as unknown as Customer;
  }

  async update(id: string, patch: Record<string, unknown>, tenantId: string): Promise<Customer> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`InMemoryCustomerRepository: customer ${id} not found`);
    if (existing.tenant_id && existing.tenant_id !== tenantId) {
      throw new Error(`Customer ${id} bukan milik tenant ${tenantId}`);
    }
    const updated = { ...existing, ...patch, updated_at: new Date() };
    this.store.set(id, updated);
    return updated as unknown as Customer;
  }

  async updateManyByPhoneTenant(phone: string, tenantId: string, patch: Record<string, unknown>): Promise<number> {
    const norm = normalizePhoneID(phone);
    let count = 0;
    for (const [id, c] of this.store.entries()) {
      const matchPhone = c?.phone === phone || (norm && normalizePhoneID(c?.phone) === norm);
      if (matchPhone && (!tenantId || c?.tenant_id === tenantId)) {
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

  /** Untuk test: seed / simpan record langsung. */
  seed(customer: any): void {
    if (customer?.id) {
      this.store.set(customer.id, customer);
    }
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
