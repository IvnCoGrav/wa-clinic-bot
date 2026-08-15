// Single Source of Truth untuk RBAC (Role-Based Access Control)
export type AppRole = 'super_admin' | 'tenant_admin' | 'admin_cs' | 'advertiser' | 'therapist';

export const ROLE_LABELS: Record<AppRole, string> = {
  super_admin: 'Super Admin',
  tenant_admin: 'Admin Utama',
  admin_cs: 'Admin CS & Reservasi',
  advertiser: 'Advertiser / Media Buyer',
  therapist: 'Staff Terapis',
};

// Daftar path menu yang diizinkan per role
export const ROLE_MENU_ACCESS: Record<AppRole, string[]> = {
  super_admin: [
    '/admin/overview',
    '/admin/customers',
    '/admin/customer-service',
    '/admin/reservations',
    '/admin/staff-management',
    '/admin/services',
    '/admin/delivery',
    '/admin/follow-ups',
    '/admin/follow-up-templates',
    '/admin/knowledge-base',
    '/admin/sandbox',
    '/admin/live-chat',
    '/admin/persona',
    '/admin/landing',
    '/admin/meta-click-catcher',
    '/admin/meta-capi-queue',
    '/admin/settings',
    '/admin/ai-evaluations',
    '/admin/chat-export',
    '/admin/debug',
  ],
  tenant_admin: [
    '/admin/overview',
    '/admin/customers',
    '/admin/customer-service',
    '/admin/reservations',
    '/admin/staff-management',
    '/admin/services',
    '/admin/delivery',
    '/admin/follow-ups',
    '/admin/follow-up-templates',
    '/admin/knowledge-base',
    '/admin/sandbox',
    '/admin/live-chat',
    '/admin/persona',
    '/admin/landing',
    '/admin/meta-click-catcher',
    '/admin/meta-capi-queue',
    '/admin/settings',
    '/admin/ai-evaluations',
    '/admin/chat-export',
    '/admin/debug',
  ],
  admin_cs: [
    '/admin/overview',
    '/admin/customers',
    '/admin/customer-service',
    '/admin/reservations',
    '/admin/staff-management',
    '/admin/services',
    '/admin/delivery',
    '/admin/follow-ups',
    '/admin/follow-up-templates',
    '/admin/knowledge-base',
    '/admin/live-chat',
  ],
  advertiser: [
    '/admin/overview',
    '/admin/landing',
    '/admin/meta-click-catcher',
    '/admin/meta-capi-queue',
    '/admin/ai-evaluations',
  ],
  therapist: [], // Terapis menggunakan portal mobile-first khusus (/admin/staff/today)
};

/**
 * Cek apakah sebuah role memiliki izin mengakses path tertentu.
 */
export function hasAccess(role: string, path: string): boolean {
  if (role === 'super_admin' || role === 'tenant_admin') return true;
  const list = ROLE_MENU_ACCESS[role as AppRole];
  return list ? list.includes(path) : false;
}

/**
 * Mendapatkan URL redirect default setelah login berdasarkan role.
 */
export function getDefaultRedirect(role: string): string {
  if (role === 'therapist') return '/admin/staff/today';
  return '/admin/overview';
}
