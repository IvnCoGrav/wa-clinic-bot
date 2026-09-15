import { prisma } from '../db/client';

/**
 * Daftar nama label bawaan sistem yang esensial untuk operasi bot dan klinis.
 */
export const SYSTEM_LABEL_NAMES = new Set<string>([
  'hold',
  'admin (cs)',
  'admin cs',
  'skip',
  'pending payment',
  'repeat order',
  'new customer',
  'medical emergency',
  'unresolved faq',
  'mql (hot lead)',
]);

/**
 * Memeriksa apakah suatu nama label merupakan label bawaan sistem yang dilindungi dari penghapusan.
 */
export function isSystemLabelName(name: string): boolean {
  if (!name) return false;
  const clean = name.toLowerCase().trim();
  if (SYSTEM_LABEL_NAMES.has(clean)) return true;
  // Format variasi seperti "Admin CS" vs "Admin (CS)"
  const normalized = clean.replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
  return (
    normalized === 'admin cs' ||
    normalized === 'admin' ||
    normalized === 'hold' ||
    normalized === 'skip' ||
    normalized === 'mql hot lead' ||
    normalized === 'pending payment' ||
    normalized === 'repeat order' ||
    normalized === 'new customer' ||
    normalized === 'medical emergency' ||
    normalized === 'unresolved faq'
  );
}

/**
 * Memeriksa apakah nama label merupakan label bypass non-customer (Skip atau Admin CS).
 * Kontak dengan label ini mem-bypass seluruh mekanisme bot:
 * - Tidak ada auto-reply bot / AI pipeline
 * - Tidak ada antrian follow-up otomatis (dan follow-up aktif dibatalkan)
 * - Tidak ada event Meta Pixel / CAPI yang dikirimkan
 * - Tidak ada penghitungan / evaluasi MQL
 */
export function isBypassLabelName(labelName: string): boolean {
  if (!labelName) return false;
  const clean = labelName.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return false;

  // Match "skip" (kata mandiri atau awalan/akhiran)
  if (clean === 'skip' || clean.startsWith('skip ') || clean.endsWith(' skip')) {
    return true;
  }

  // Match "admin cs", "admin (cs)", "admin-cs", "admin_cs", atau kata "admin"
  if (clean === 'admin' || clean === 'admin cs' || clean === 'cs admin' || (clean.includes('admin') && clean.includes('cs'))) {
    return true;
  }

  return false;
}

/**
 * Memeriksa apakah objek customer in-memory memiliki label bypass.
 * Mendukung berbagai format customer Prisma atau DTO:
 * - customer.is_admin_labeled === true
 * - customer.labels: array of CustomerLabel ({ label: { name: string } }) atau Label ({ name: string }) atau string[]
 */
export function hasBypassLabel(customerOrLabels: any): boolean {
  if (!customerOrLabels) return false;

  // Jika input berupa array label langsung
  if (Array.isArray(customerOrLabels)) {
    return customerOrLabels.some((item) => {
      const name = typeof item === 'string' ? item : item?.label?.name || item?.name;
      return typeof name === 'string' && isBypassLabelName(name);
    });
  }

  // Jika input berupa objek customer
  if (customerOrLabels.is_admin_labeled === true) {
    return true;
  }

  if (Array.isArray(customerOrLabels.labels)) {
    return customerOrLabels.labels.some((item: any) => {
      const name = typeof item === 'string' ? item : item?.label?.name || item?.name;
      return typeof name === 'string' && isBypassLabelName(name);
    });
  }

  return false;
}

/**
 * Pengecekan asinkron apakah customer memiliki label bypass di database / memory fallback.
 * Digunakan pada titik-titik krusial (misal CAPI, pembuatan follow-up, webhook) jika
 * objek customer belum memuat relasi labels secara lengkap.
 */
export async function checkCustomerBypass(params: {
  customerId?: string;
  phone?: string;
  tenantId?: string;
}): Promise<boolean> {
  const { customerId, phone, tenantId = 'default-tenant' } = params;
  if (!customerId && !phone) return false;

  // 1. Cek database via Prisma
  try {
    const customer = await prisma.customer.findFirst({
      where: {
        ...(customerId ? { id: customerId } : {}),
        ...(phone ? { phone } : {}),
        tenant_id: tenantId,
      },
      select: {
        id: true,
        phone: true,
        is_admin_labeled: true,
        labels: {
          select: {
            label: {
              select: { name: true },
            },
          },
        },
      },
    });

    if (customer) {
      if (customer.is_admin_labeled === true) return true;
      if (Array.isArray(customer.labels)) {
        return customer.labels.some((cl: any) => isBypassLabelName(cl.label?.name));
      }
      return false;
    }
  } catch (err: any) {
    // DB offline, lanjut ke memory fallback
  }

  // 2. Memory fallback (DB offline / mock testing)
  if (phone) {
    try {
      const { customerService } = await import('../services/customer.service');
      const memCust = customerService.getMemoryCustomers()?.get(phone);
      if (memCust?.is_admin_labeled === true || hasBypassLabel(memCust)) {
        return true;
      }
    } catch {}
  }

  return false;
}
