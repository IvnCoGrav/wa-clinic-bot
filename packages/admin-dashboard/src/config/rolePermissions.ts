// Single Source of Truth untuk RBAC (Role-Based Access Control)
export type AppRole = 'super_admin' | 'tenant_admin' | 'admin_cs' | 'advertiser' | 'therapist' | string;

export interface ModuleDefinition {
  id: string;
  path: string;
  name: string;
  category: 'DASHBOARD & PELANGGAN' | 'OPERASIONAL & JADWAL' | 'CRM & KOMUNIKASI' | 'MARKETING & ADS' | 'AI ENGINE & SISTEM';
  description: string;
}

export interface RoleConfig {
  key: string;
  label: string;
  description: string;
  isSystem: boolean;
  allowedPaths: string[];
  defaultRedirect: string;
}

export const ALL_MODULES: ModuleDefinition[] = [
  // 1. Dashboard & Pelanggan
  {
    id: 'overview',
    path: '/admin/overview',
    name: 'Dashboard Overview',
    category: 'DASHBOARD & PELANGGAN',
    description: 'Ringkasan metrik statistik, omset, grafik performa, dan lead',
  },
  {
    id: 'customers',
    path: '/admin/customers',
    name: 'Customer Database',
    category: 'DASHBOARD & PELANGGAN',
    description: 'Basis data profil pasien, riwayat alamat, dan rekaman chat',
  },
  {
    id: 'labels',
    path: '/admin/labels',
    name: 'Customer Labels',
    category: 'DASHBOARD & PELANGGAN',
    description: 'Kelola master label dan penandaan kategori pasien',
  },
  {
    id: 'customer-service',
    path: '/admin/customer-service',
    name: 'Customer Service & CTA',
    category: 'DASHBOARD & PELANGGAN',
    description: 'Konfigurasi nomor WhatsApp CS, nama CS, dan tombol CTA',
  },

  // 2. Operasional & Jadwal
  {
    id: 'reservations',
    path: '/admin/reservations',
    name: 'Kalender & Reservasi',
    category: 'OPERASIONAL & JADWAL',
    description: 'Kalender janji temu modern (Bulan/Minggu/Hari) dan buat reservasi',
  },
  {
    id: 'staff-management',
    path: '/admin/staff-management',
    name: 'Staff & Akun Pengguna',
    category: 'OPERASIONAL & JADWAL',
    description: 'Kelola akun pengguna klinik, terapis, dan hak akses peran',
  },
  {
    id: 'services',
    path: '/admin/services',
    name: 'Katalog Layanan & Harga',
    category: 'OPERASIONAL & JADWAL',
    description: 'Daftar treatment spa ibu/anak, durasi, harga, dan kategori',
  },
  {
    id: 'delivery',
    path: '/admin/delivery',
    name: 'Tarif Jarak & Ongkir',
    category: 'OPERASIONAL & JADWAL',
    description: 'Pengaturan tier jarak pengiriman dan tarif ongkos kirim terapis',
  },

  // 3. CRM & Komunikasi
  {
    id: 'follow-ups',
    path: '/admin/follow-ups',
    name: 'Follow-Up Queue',
    category: 'CRM & KOMUNIKASI',
    description: 'Antrean pesan pengingat & penawaran otomatis ke pasien',
  },
  {
    id: 'follow-up-templates',
    path: '/admin/follow-up-templates',
    name: 'Template Pesan Follow-Up',
    category: 'CRM & KOMUNIKASI',
    description: 'Template pesan tindak lanjut otomatis WhatsApp per tenant',
  },
  {
    id: 'live-chat',
    path: '/admin/live-chat',
    name: 'Live Chat WhatsApp',
    category: 'CRM & KOMUNIKASI',
    description: 'Monitor percakapan WhatsApp real-time dan intervensi manual',
  },
  {
    id: 'knowledge-base',
    path: '/admin/knowledge-base',
    name: 'Knowledge Base FAQ',
    category: 'CRM & KOMUNIKASI',
    description: 'Basis data pengetahuan dan artikel Tanya Jawab untuk bot AI',
  },

  // 4. Marketing & Ads
  {
    id: 'landing',
    path: '/admin/landing',
    name: 'Landing Page Builder',
    category: 'MARKETING & ADS',
    description: 'Struktur promo, headline iklan, dan visual landing page click-to-WA',
  },
  {
    id: 'meta-click-catcher',
    path: '/admin/meta-click-catcher',
    name: 'Meta Click Catcher',
    category: 'MARKETING & ADS',
    description: 'Tracking atribusi pengunjung iklan Meta Ads (fbclid/utm)',
  },
  {
    id: 'meta-capi-queue',
    path: '/admin/meta-capi-queue',
    name: 'Meta CAPI Queue',
    category: 'MARKETING & ADS',
    description: 'Antrean pengiriman event konversi Contact & Purchase ke Meta',
  },

  // 5. AI Engine & Sistem
  {
    id: 'sandbox',
    path: '/admin/sandbox',
    name: 'AI Sandbox Simulator',
    category: 'AI ENGINE & SISTEM',
    description: 'Simulator obrolan interaktif untuk menguji respon bot AI',
  },
  {
    id: 'persona',
    path: '/admin/persona',
    name: 'Konfigurasi AI Persona',
    category: 'AI ENGINE & SISTEM',
    description: 'Pengaturan gaya bahasa, karakter, nama asisten, dan sapaan bot',
  },
  {
    id: 'ai-evaluations',
    path: '/admin/ai-evaluations',
    name: 'Evaluasi Kualitas AI',
    category: 'AI ENGINE & SISTEM',
    description: 'Audit shadow evaluation akurasi respon dan routing AI',
  },
  {
    id: 'settings',
    path: '/admin/settings',
    name: 'Pengaturan Operasional',
    category: 'AI ENGINE & SISTEM',
    description: 'Konfigurasi jam operasional, batas kuota, dan sistem umum',
  },
  {
    id: 'chat-export',
    path: '/admin/chat-export',
    name: 'Daily Chat Export',
    category: 'AI ENGINE & SISTEM',
    description: 'Ekspor berkas percakapan harian untuk analisis data & training',
  },
  {
    id: 'debug',
    path: '/admin/debug',
    name: 'System Debug & Diagnostics',
    category: 'AI ENGINE & SISTEM',
    description: 'Diagnostik server, cache redis, log error, dan gateway status',
  },
];

export const ALL_PATHS = ALL_MODULES.map((m) => m.path);

export const DEFAULT_ROLE_CONFIGS: Record<string, RoleConfig> = {
  super_admin: {
    key: 'super_admin',
    label: 'Super Admin',
    description: 'Akses penuh tanpa batas ke seluruh modul sistem, pengaturan, dan diagnostik.',
    isSystem: true,
    allowedPaths: [...ALL_PATHS],
    defaultRedirect: '/admin/overview',
  },
  tenant_admin: {
    key: 'tenant_admin',
    label: 'Admin Utama',
    description: 'Akses penuh ke seluruh operasional, konfigurasi tenant, dan manajemen staf klinik.',
    isSystem: true,
    allowedPaths: [...ALL_PATHS],
    defaultRedirect: '/admin/overview',
  },
  admin_cs: {
    key: 'admin_cs',
    label: 'Admin CS & Reservasi',
    description: 'Akses operasional harian: kalender reservasi, database pasien, katalog layanan, follow-up, dan live chat.',
    isSystem: false,
    allowedPaths: [
      '/admin/overview',
      '/admin/customers',
      '/admin/labels',
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
    defaultRedirect: '/admin/overview',
  },
  advertiser: {
    key: 'advertiser',
    label: 'Advertiser / Media Buyer',
    description: 'Akses modul periklanan: overview analitik, landing page, tracking Meta Click, antrean CAPI, dan evaluasi AI.',
    isSystem: false,
    allowedPaths: [
      '/admin/overview',
      '/admin/landing',
      '/admin/meta-click-catcher',
      '/admin/meta-capi-queue',
      '/admin/ai-evaluations',
    ],
    defaultRedirect: '/admin/overview',
  },
  therapist: {
    key: 'therapist',
    label: 'Staff Terapis',
    description: 'Akses portal penugasan mobile-first harian, navigasi Google Maps rute berantai, dan live chat pasien hari ini.',
    isSystem: true,
    allowedPaths: ['/admin/staff/today'],
    defaultRedirect: '/admin/staff/today',
  },
};

const STORAGE_KEY = 'kala_custom_roles_v1';

export function getCustomRoles(): Record<string, RoleConfig> {
  if (typeof window === 'undefined') return DEFAULT_ROLE_CONFIGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_ROLE_CONFIGS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_ROLE_CONFIGS, ...parsed };
  } catch {
    return DEFAULT_ROLE_CONFIGS;
  }
}

export function saveRoleConfig(role: RoleConfig): void {
  if (typeof window === 'undefined') return;
  try {
    const current = getCustomRoles();
    current[role.key] = role;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    window.dispatchEvent(new Event('roles-updated'));
  } catch (err) {
    console.error('Failed to save custom role:', err);
  }
}

export function deleteCustomRole(roleKey: string): boolean {
  if (typeof window === 'undefined') return false;
  if (DEFAULT_ROLE_CONFIGS[roleKey]?.isSystem) return false;
  try {
    const current = getCustomRoles();
    delete current[roleKey];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    window.dispatchEvent(new Event('roles-updated'));
    return true;
  } catch (err) {
    console.error('Failed to delete custom role:', err);
    return false;
  }
}

export const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  tenant_admin: 'Admin Utama',
  admin_cs: 'Admin CS & Reservasi',
  advertiser: 'Advertiser / Media Buyer',
  therapist: 'Staff Terapis',
};

// Fallback lookup
export const ROLE_MENU_ACCESS: Record<string, string[]> = {
  super_admin: [...ALL_PATHS],
  tenant_admin: [...ALL_PATHS],
  admin_cs: DEFAULT_ROLE_CONFIGS.admin_cs.allowedPaths,
  advertiser: DEFAULT_ROLE_CONFIGS.advertiser.allowedPaths,
  therapist: DEFAULT_ROLE_CONFIGS.therapist.allowedPaths,
};

/**
 * Cek apakah sebuah role memiliki izin mengakses path tertentu.
 */
export function hasAccess(role: string, path: string): boolean {
  if (!role) return false;
  const formattedRole = role.toLowerCase();
  if (formattedRole === 'super_admin' || formattedRole === 'tenant_admin') return true;

  const roles = getCustomRoles();
  const config = roles[formattedRole] || roles[role];
  if (config) {
    return config.allowedPaths.includes(path);
  }

  const fallback = ROLE_MENU_ACCESS[formattedRole];
  return fallback ? fallback.includes(path) : false;
}

/**
 * Mendapatkan URL redirect default setelah login berdasarkan role.
 */
export function getDefaultRedirect(role: string): string {
  if (!role) return '/admin/login';
  const formattedRole = role.toLowerCase();
  if (formattedRole === 'therapist') return '/admin/staff/today';

  const roles = getCustomRoles();
  const config = roles[formattedRole] || roles[role];
  if (config && config.defaultRedirect) {
    return config.defaultRedirect;
  }

  return '/admin/overview';
}
