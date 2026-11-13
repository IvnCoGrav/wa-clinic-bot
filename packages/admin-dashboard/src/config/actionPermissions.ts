/**
 * Peta izin level aksi — HANYA berisi aksi yang batasannya benar-benar
 * ditegakkan backend. Sumber setiap baris dicatat di komentar.
 *
 * Aturan penting: jangan menebak izin dari nama role atau nama tombol. Aksi
 * yang tidak punya pemeriksaan peran di backend sengaja TIDAK dibatasi di UI,
 * karena menyembunyikan tombol tanpa penegakan server hanya menyesatkan
 * (pengguna lain tetap bisa memanggil API-nya).
 */

export type ActionKey =
  | 'freeze_retention_snapshot'
  | 'update_retention_policy'
  | 'export_customer_audience'
  | 'manage_whatsapp_provider'
  | 'edit_tenant_landing_html';

export interface ActionRule {
  /** Role yang lolos. `*` berarti semua role admin yang login. */
  roles: string[] | '*';
  /** Bukti penegakan di backend (file:line). */
  source: string;
  /** Konsekuensi bila dipanggil tanpa hak. */
  note: string;
}

export const ACTION_RULES: Record<ActionKey, ActionRule> = {
  freeze_retention_snapshot: {
    roles: ['super_admin', 'tenant_admin'],
    source: 'src/routes/admin/staff-retention.subroute.ts:144',
    note: 'Pembekuan snapshot retensi dibalas 403 untuk role lain.',
  },
  update_retention_policy: {
    roles: ['super_admin'],
    source: 'src/routes/admin/staff-retention.subroute.ts:254',
    note: 'Policy retensi hanya Super Admin.',
  },
  export_customer_audience: {
    roles: ['super_admin'],
    source: 'src/routes/admin/customers-export.subroute.ts:46',
    note: 'Export audience dibalas 403 untuk selain Super Admin.',
  },
  manage_whatsapp_provider: {
    roles: ['super_admin'],
    source: 'src/routes/admin/waba.subroute.ts:21 (preHandler seluruh rute)',
    note: 'Status sesi, QR, dan konfigurasi WhatsApp hanya Super Admin.',
  },
  edit_tenant_landing_html: {
    // Backend memeriksa kecocokan TENANT sesi, bukan nama role. Karena itu
    // pembatasannya tidak bisa diterjemahkan menjadi daftar role di UI.
    roles: '*',
    source: 'src/routes/admin/landings.subroute.ts:142',
    note: 'Staf boleh mengubah landing tenant-nya sendiri; tenant lain dibalas 403. '
      + 'Batas ini berbasis tenant sesi, bukan role.',
  },
};

/** Role yang dikenali dashboard (lihat config/rolePermissions.ts). */
export function canDo(role: string | null | undefined, action: ActionKey): boolean {
  if (!role) return false;
  const rule = ACTION_RULES[action];
  if (!rule) return true;
  if (rule.roles === '*') return true;
  return rule.roles.includes(role);
}

/** Alasan siap tampil saat aksi disembunyikan (untuk tooltip/dokumentasi). */
export function denyReason(action: ActionKey): string {
  const rule = ACTION_RULES[action];
  const who = rule.roles === '*' ? 'semua admin' : rule.roles.join(', ');
  return `Hanya untuk ${who} (${rule.source}).`;
}
