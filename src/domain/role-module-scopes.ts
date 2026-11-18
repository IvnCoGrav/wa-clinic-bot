/**
 * Modul Kanonis RBAC: Kebijakan Layer 1 + Pemetaan Modul UI → Scope API (`role_api_scopes`).
 *
 * Murni (tanpa I/O / Prisma / layanan eksternal) — menjadi satu-satunya sumber kebenaran
 * untuk:
 *   1. Daftar batas keamanan Layer 1 (`SUPER_ADMIN_ONLY_PREFIXES`, `SETTINGS_READ_ALLOWLIST`,
 *      `SUPER_ADMIN_WRITE_PREFIXES`, `SUPER_ADMIN_RESTRICTED_SUBPATHS`) yang diimpor langsung
 *      oleh `src/routes/admin.route.ts` sehingga tidak terjadi drift antar lapisan (KNOWN #358 A-009).
 *   2. Derivasi otomatis `role_api_scopes` untuk custom role saat dibuat/diubah di
 *      `POST /api/admin/roles` (`deriveApiScopesForAllowedPaths`), agar custom role baru tidak
 *      langsung terkunci HTTP 403 fail-closed (`H-04`, `CD-07`).
 *
 * Aturan ketat keamanan (`A-009`, `K-1`, `K-5`, `K-6`, `CD-02`):
 *   - `/admin/overview` TIDAK PERNAH otomatis memberi `/api/admin/financial-analytics`;
 *     akses omzet hanya diberikan bila `/admin/financial-analytics` dipilih secara eksplisit.
 *   - Tidak ada entri di `MODULE_PATH_TO_API_SCOPES` yang diblokir seluruh method-nya oleh Layer 1
 *     (mis. `/api/admin/settings/notifications`, `/api/admin/debug`, atau `approve-purchase`).
 */

export interface DerivedApiScope {
  apiPrefix: string;
  methods: string;
}

export interface RestrictedSubpathRule {
  method: string;
  pattern: string;
}

/**
 * Layer 1: Prefix endpoint sensitif khusus Super Admin.
 * Pengecualian baca (GET) hanya berlaku untuk daftar eksplisit di `SETTINGS_READ_ALLOWLIST`.
 */
export const SUPER_ADMIN_ONLY_PREFIXES: readonly string[] = [
  '/api/admin/backup',
  '/api/admin/settings',
  '/api/admin/ai-models',
  '/api/admin/evaluations',
  '/api/admin/ai-evaluations',
  '/api/admin/sandbox',
  '/api/admin/debug',
  '/api/admin/migration',
  '/api/admin/persona',
  '/api/admin/export',
  '/api/admin/integrations/google',
  '/api/admin/waba',
  '/api/admin/whatsapp-provider',
  '/api/admin/waba-templates',
  '/api/admin/customers/audience-export',
  '/api/admin/few-shots',
  '/api/admin/ai-rollout-scope',
  '/api/admin/prompt-config',
  '/api/admin/conversation-behavior',
];

/**
 * Layer 1: Pengecualian GET non-rahasia di bawah `/api/admin/settings`.
 * `/api/admin/settings/notifications` SENGAJA dilarang karena memuat `telegramPairingToken` (CD-02).
 */
export const SETTINGS_READ_ALLOWLIST: readonly string[] = [
  '/api/admin/settings',
  '/api/admin/settings/notifications/logs',
  '/api/admin/settings/daily-report',
  '/api/admin/settings/payment-info',
  '/api/admin/settings/pricelist-image',
];

/**
 * Layer 1: Endpoint yang hanya boleh DIBACA (`GET`) staf non-Super-Admin via `role_api_scopes`;
 * seluruh operasi tulis (`POST`/`PUT`/`PATCH`/`DELETE`) diblokir ke Super Admin (Cfg-011/013, K-3).
 */
export const SUPER_ADMIN_WRITE_PREFIXES: readonly string[] = [
  '/api/admin/services',
  '/api/admin/delivery-tiers',
  '/api/admin/meta-performance',
  '/api/admin/tenant-settings',
  '/api/admin/customer-service',
];

/**
 * Layer 1: Prefix tambahan yang diblokir non-GET-nya oleh guard eksplisit di `admin.route.ts`.
 */
const SUPER_ADMIN_WRITE_ONLY_GUARDED_PREFIXES: readonly string[] = [
  '/api/admin/roles',
  '/api/admin/staff',
  '/api/admin/knowledge',
];

/**
 * Layer 1: Deny deterministik sub-path sensitif di bawah wildcard `*` operasional (KNOWN #358 A-002/K-6).
 * Mempertahankan `DELETE /api/admin/reservation/:id` (CD-01) sambil memblokir CAPI Purchase produksi
 * dan WAHA full-sync bagi non-Super-Admin.
 */
export const SUPER_ADMIN_RESTRICTED_SUBPATHS: readonly RestrictedSubpathRule[] = [
  { method: 'POST', pattern: '/api/admin/reservation/:id/approve-purchase' },
  { method: 'POST', pattern: '/api/admin/reservation/:id/reject-purchase' },
  { method: 'POST', pattern: '/api/admin/reservation/:id/unreject-purchase' },
  { method: 'POST', pattern: '/api/admin/live-chat/sync-full' },
];

/**
 * Daftar modul UI di `rolePermissions.ts` yang seluruh backend API-nya berada di bawah
 * `SUPER_ADMIN_ONLY_PREFIXES`, sehingga tidak menghasilkan scope API untuk custom role.
 */
export const SUPER_ADMIN_ONLY_MODULE_PATHS: readonly string[] = [
  '/admin/chat-migration',
  '/admin/sandbox',
  '/admin/persona',
  '/admin/ai-evaluations',
  '/admin/settings',
  '/admin/chat-export',
  '/admin/debug',
];

/**
 * Scope API dasar yang selalu melekat pada setiap custom role agar boot dashboard,
 * pembacaan daftar role, badge health, dan push notification tidak pernah gagal 403.
 */
export const BASELINE_STAFF_API_SCOPES: readonly DerivedApiScope[] = [
  { apiPrefix: '/api/admin/roles', methods: 'GET' },
  { apiPrefix: '/api/admin/health', methods: 'GET' },
  { apiPrefix: '/api/admin/push/public-key', methods: 'GET' },
  { apiPrefix: '/api/admin/push/subscribe', methods: 'POST' },
  { apiPrefix: '/api/admin/push/unsubscribe', methods: 'POST' },
];

/**
 * Peta kanonis `modulePath` (frontend `ALL_MODULES` + `/admin/financial-analytics`) → scope API.
 * Setiap `apiPrefix` WAJIB cocok dengan rute terdaftar di `buildApp()` (0 orphan) dan
 * tidak bertabrakan dengan Layer 1.
 */
export const MODULE_PATH_TO_API_SCOPES: Readonly<Record<string, readonly DerivedApiScope[]>> = {
  // Dashboard & Pasien
  // A-009: /admin/overview TIDAK BOLEH otomatis memberi /api/admin/financial-analytics!
  '/admin/overview': [
    { apiPrefix: '/api/admin/reservations/count', methods: 'GET' },
    { apiPrefix: '/api/admin/live-chat', methods: 'GET' },
    { apiPrefix: '/api/admin/settings', methods: 'GET' },
  ],
  '/admin/financial-analytics': [
    { apiPrefix: '/api/admin/financial-analytics', methods: 'GET' },
  ],
  '/admin/customers': [
    { apiPrefix: '/api/admin/customers', methods: 'GET,POST,PUT,PATCH' },
    { apiPrefix: '/api/admin/customers/:id/addresses', methods: 'DELETE' },
    { apiPrefix: '/api/admin/reservation', methods: 'GET' },
    { apiPrefix: '/api/admin/reservation-series', methods: 'GET' },
    { apiPrefix: '/api/admin/staff', methods: 'GET' },
    { apiPrefix: '/api/admin/labels', methods: 'GET' },
    { apiPrefix: '/api/admin/geo/areas', methods: 'GET' },
    { apiPrefix: '/api/admin/tenant-settings', methods: 'GET' },
  ],
  '/admin/labels': [
    { apiPrefix: '/api/admin/labels', methods: '*' },
  ],
  '/admin/customer-service': [
    // K-3 Opsi C: GET non-rahasia via scope; POST tetap diblokir Layer 1
    { apiPrefix: '/api/admin/customer-service', methods: 'GET' },
  ],

  // Operasional & Jadwal
  '/admin/reservations': [
    { apiPrefix: '/api/admin/reservations', methods: '*' },
    { apiPrefix: '/api/admin/reservation', methods: '*' },
    { apiPrefix: '/api/admin/reservation-series', methods: '*' },
    { apiPrefix: '/api/admin/dispatch/trip', methods: 'GET' },
    { apiPrefix: '/api/admin/customers', methods: 'GET,POST,PUT,PATCH' },
    { apiPrefix: '/api/admin/customers/:id/addresses', methods: 'DELETE' },
    { apiPrefix: '/api/admin/services', methods: 'GET' },
    { apiPrefix: '/api/admin/delivery-tiers', methods: 'GET' },
    { apiPrefix: '/api/admin/staff', methods: 'GET' },
    { apiPrefix: '/api/admin/geo/areas', methods: 'GET' },
    { apiPrefix: '/api/admin/tenant-settings', methods: 'GET' },
  ],
  '/admin/today-treatments': [
    // API utama berada di /api/staff/*; berikut helper read admin yang ikut dipanggil
    { apiPrefix: '/api/admin/dispatch/trip', methods: 'GET' },
    { apiPrefix: '/api/admin/staff', methods: 'GET' },
    { apiPrefix: '/api/admin/tenant-settings', methods: 'GET' },
  ],
  '/admin/staff-management': [
    // Tulis akun staf diblokir Layer 1; baca daftar & retensi diperbolehkan
    { apiPrefix: '/api/admin/staff', methods: 'GET' },
    { apiPrefix: '/api/admin/staff-retention', methods: 'GET' },
  ],
  '/admin/services': [
    { apiPrefix: '/api/admin/services', methods: 'GET' },
  ],
  '/admin/delivery': [
    { apiPrefix: '/api/admin/delivery-tiers', methods: 'GET' },
    { apiPrefix: '/api/admin/geo/areas', methods: 'GET' },
  ],

  // CRM & Komunikasi
  '/admin/follow-ups': [
    { apiPrefix: '/api/admin/follow-ups', methods: '*' },
    { apiPrefix: '/api/admin/follow-up-templates', methods: 'GET' },
  ],
  '/admin/follow-up-templates': [
    { apiPrefix: '/api/admin/follow-up-templates', methods: '*' },
  ],
  '/admin/live-chat': [
    { apiPrefix: '/api/admin/live-chat', methods: '*' },
    { apiPrefix: '/api/admin/conversations', methods: '*' },
    { apiPrefix: '/api/admin/conversation', methods: '*' },
    { apiPrefix: '/api/admin/customers', methods: 'GET,POST,PUT,PATCH' },
    { apiPrefix: '/api/admin/customers/:id/addresses', methods: 'DELETE' },
    { apiPrefix: '/api/admin/reservations', methods: '*' },
    { apiPrefix: '/api/admin/reservation', methods: '*' },
    { apiPrefix: '/api/admin/dispatch/trip', methods: 'GET' },
    { apiPrefix: '/api/admin/labels', methods: 'GET,POST,PUT,PATCH' },
    { apiPrefix: '/api/admin/quick-replies', methods: 'GET' },
    { apiPrefix: '/api/admin/services', methods: 'GET' },
    { apiPrefix: '/api/admin/delivery-tiers', methods: 'GET' },
    { apiPrefix: '/api/admin/staff', methods: 'GET' },
    { apiPrefix: '/api/admin/gateway-capability', methods: 'GET' },
    { apiPrefix: '/api/admin/settings', methods: 'GET' },
    { apiPrefix: '/api/admin/settings/payment-info', methods: 'GET' },
    { apiPrefix: '/api/admin/settings/pricelist-image', methods: 'GET' },
    { apiPrefix: '/api/admin/tenant-settings', methods: 'GET' },
    { apiPrefix: '/api/admin/copilot', methods: 'POST' },
  ],
  '/admin/knowledge-base': [
    // Tulis KB diblokir Layer 1; baca diizinkan via scope
    { apiPrefix: '/api/admin/knowledge', methods: 'GET' },
  ],
  '/admin/telegram': [
    // CD-02: /api/admin/settings/notifications TIDAK BOLEH masuk (memuat telegramPairingToken)
    { apiPrefix: '/api/admin/settings/notifications/logs', methods: 'GET' },
    { apiPrefix: '/api/admin/settings/daily-report', methods: 'GET' },
    { apiPrefix: '/api/admin/staff', methods: 'GET' },
  ],
  '/admin/quick-replies': [
    { apiPrefix: '/api/admin/quick-replies', methods: '*' },
    { apiPrefix: '/api/admin/settings', methods: 'GET' },
    { apiPrefix: '/api/admin/settings/payment-info', methods: 'GET' },
    { apiPrefix: '/api/admin/settings/pricelist-image', methods: 'GET' },
  ],

  // Marketing & Ads (K-5: read-only & aman tanpa /debug dan tanpa approve-purchase)
  '/admin/landing': [
    { apiPrefix: '/api/admin/landings', methods: 'GET' },
  ],
  '/admin/meta-click-catcher': [
    { apiPrefix: '/api/admin/ctwa-catchers', methods: 'GET,POST,PUT,PATCH,DELETE' },
    { apiPrefix: '/api/admin/meta-performance', methods: 'GET' },
  ],
  '/admin/meta-capi-queue': [
    { apiPrefix: '/api/admin/capi-queue', methods: 'GET' },
  ],

  // Portal Lapangan & Terapis (endpoint utama di /api/staff/*; baseline sudah cukup)
  '/admin/staff/today': [],
  '/admin/staff/schedule': [],
};

const METHOD_ORDER = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

function parseMethodsList(methods: string): string[] {
  const cleaned = String(methods || '*')
    .split(',')
    .map((m) => m.trim().toUpperCase())
    .filter(Boolean);
  if (cleaned.length === 0 || cleaned.includes('*')) return ['*'];
  return cleaned;
}

function mergeMethods(existing: string, incoming: string): string {
  const a = parseMethodsList(existing);
  const b = parseMethodsList(incoming);
  if (a.includes('*') || b.includes('*')) return '*';
  const merged = new Set<string>([...a, ...b]);
  const ordered: string[] = [];
  for (const m of METHOD_ORDER) {
    if (merged.has(m)) {
      ordered.push(m);
      merged.delete(m);
    }
  }
  for (const extra of Array.from(merged).sort()) {
    ordered.push(extra);
  }
  return ordered.join(',');
}

/**
 * Menguji apakah sebuah baris `(apiPrefix, methods)` kontradiktif dengan Layer 1 —
 * yaitu SELURUH method yang diizinkan oleh baris tersebut pasti diblokir Layer 1
 * untuk staf non-Super-Admin.
 */
export function isScopeFullyBlockedByLayer1(apiPrefix: string, methods: string): boolean {
  const prefix = String(apiPrefix || '').replace(/\/+$/, '');
  if (!prefix) return true;

  const expandedMethods = parseMethodsList(methods).includes('*')
    ? [...METHOD_ORDER]
    : parseMethodsList(methods);

  const isMethodBlocked = (method: string): boolean => {
    const upper = method.toUpperCase();
    // 1. SUPER_ADMIN_ONLY_PREFIXES (dengan pengecualian GET di SETTINGS_READ_ALLOWLIST)
    if (SUPER_ADMIN_ONLY_PREFIXES.some((p) => prefix === p || prefix.startsWith(`${p}/`))) {
      const allowedSettingsRead = upper === 'GET' && SETTINGS_READ_ALLOWLIST.includes(prefix);
      if (!allowedSettingsRead) return true;
    }
    // 2. SUPER_ADMIN_WRITE_PREFIXES & write-only guarded prefixes
    if (upper !== 'GET') {
      if (
        SUPER_ADMIN_WRITE_PREFIXES.some((p) => prefix === p || prefix.startsWith(`${p}/`)) ||
        SUPER_ADMIN_WRITE_ONLY_GUARDED_PREFIXES.some((p) => prefix === p || prefix.startsWith(`${p}/`))
      ) {
        return true;
      }
    }
    // 3. SUPER_ADMIN_RESTRICTED_SUBPATHS (exact pattern match)
    if (SUPER_ADMIN_RESTRICTED_SUBPATHS.some((r) => r.method === upper && r.pattern === prefix)) {
      return true;
    }
    return false;
  };

  return expandedMethods.every(isMethodBlocked);
}

/**
 * Menurunkan daftar `role_api_scopes` deterministik & bebas-duplikasi untuk custom role
 * berdasarkan `allowedPaths` UI yang dipilih Super Admin.
 *
 * - Selalu menggabungkan `BASELINE_STAFF_API_SCOPES`.
 * - Mengabaikan path di `SUPER_ADMIN_ONLY_MODULE_PATHS` dan path tidak dikenal.
 * - Menyaring setiap scope yang seluruh method-nya diblokir Layer 1 (defense-in-depth).
 * - Menggabungkan method untuk `apiPrefix` yang sama secara deterministik dan mengurutkan
 *   hasil berdasarkan `apiPrefix`.
 */
export function deriveApiScopesForAllowedPaths(allowedPaths: readonly string[]): DerivedApiScope[] {
  const scopeMap = new Map<string, string>();
  const superAdminModules = new Set<string>(SUPER_ADMIN_ONLY_MODULE_PATHS);

  const addScope = (entry: DerivedApiScope) => {
    if (isScopeFullyBlockedByLayer1(entry.apiPrefix, entry.methods)) return;
    const prev = scopeMap.get(entry.apiPrefix);
    scopeMap.set(entry.apiPrefix, prev ? mergeMethods(prev, entry.methods) : entry.methods);
  };

  for (const base of BASELINE_STAFF_API_SCOPES) {
    addScope(base);
  }

  for (const rawPath of allowedPaths || []) {
    const normalized = String(rawPath || '').trim().replace(/\/+$/, '');
    if (!normalized || superAdminModules.has(normalized)) continue;
    const mapped = MODULE_PATH_TO_API_SCOPES[normalized];
    if (!mapped) continue;
    for (const entry of mapped) {
      addScope(entry);
    }
  }

  return Array.from(scopeMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([apiPrefix, methods]) => ({ apiPrefix, methods }));
}
