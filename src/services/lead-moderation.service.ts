import { prisma } from '../db/client';

/**
 * Moderasi lead MQL hanya boleh menyentuh customer milik tenant pemanggil.
 * Dipisah dari route agar batas modul route tetap tipis dan aturan kepemilikan
 * punya satu seam kanonis.
 */
export async function isLeadOwnedByTenant(customerId: string, tenantId: string): Promise<boolean> {
  if (!customerId || !tenantId) return false;
  const row = await prisma.customer.findFirst({
    where: { id: customerId, tenant_id: tenantId },
    select: { id: true },
  });
  return Boolean(row);
}
