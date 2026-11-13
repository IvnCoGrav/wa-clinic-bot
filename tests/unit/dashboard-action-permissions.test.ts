import { describe, expect, it } from 'vitest';
import { canDo, denyReason } from '../../packages/admin-dashboard/src/config/actionPermissions';

describe('canDo — peta izin aksi', () => {
  it('export audience hanya untuk super admin (sesuai backend)', () => {
    expect(canDo('super_admin', 'export_customer_audience')).toBe(true);
    // tenant_admin DULU ikut ditampilkan tombolnya lalu menabrak 403.
    expect(canDo('tenant_admin', 'export_customer_audience')).toBe(false);
    expect(canDo('admin_cs', 'export_customer_audience')).toBe(false);
    expect(canDo('advertiser', 'export_customer_audience')).toBe(false);
    expect(canDo('therapist', 'export_customer_audience')).toBe(false);
  });

  it('pembekuan snapshot retensi boleh untuk admin utama', () => {
    expect(canDo('super_admin', 'freeze_retention_snapshot')).toBe(true);
    expect(canDo('tenant_admin', 'freeze_retention_snapshot')).toBe(true);
    expect(canDo('admin_cs', 'freeze_retention_snapshot')).toBe(false);
  });

  it('policy retensi dan konfigurasi WhatsApp hanya super admin', () => {
    expect(canDo('tenant_admin', 'update_retention_policy')).toBe(false);
    expect(canDo('tenant_admin', 'manage_whatsapp_provider')).toBe(false);
    expect(canDo('super_admin', 'manage_whatsapp_provider')).toBe(true);
  });

  it('landing tenant sendiri tidak dibatasi role (backend memeriksa tenant)', () => {
    expect(canDo('advertiser', 'edit_tenant_landing_html')).toBe(true);
    expect(canDo('admin_cs', 'edit_tenant_landing_html')).toBe(true);
  });

  it('role kosong tidak pernah dianggap berhak', () => {
    expect(canDo(null, 'export_customer_audience')).toBe(false);
    expect(canDo(undefined, 'freeze_retention_snapshot')).toBe(false);
    expect(canDo('', 'edit_tenant_landing_html')).toBe(false);
  });

  it('alasan penolakan menyebut sumber penegakan backend', () => {
    const reason = denyReason('export_customer_audience');
    expect(reason).toContain('super_admin');
    expect(reason).toContain('customers-export.subroute.ts');
  });
});
