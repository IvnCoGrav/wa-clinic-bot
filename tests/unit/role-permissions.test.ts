import { describe, it, expect } from 'vitest';
import {
  hasAccess,
  getDefaultRedirect,
  ROLE_LABELS,
  ROLE_MENU_ACCESS,
} from '../../packages/admin-dashboard/src/config/rolePermissions';

describe('RBAC Role Permissions (rolePermissions.ts)', () => {
  it('should have labels defined for all roles', () => {
    expect(ROLE_LABELS.super_admin).toBe('Super Admin');
    expect(ROLE_LABELS.admin_cs).toBe('Admin CS & Reservasi');
    expect(ROLE_LABELS.advertiser).toBe('Advertiser / Media Buyer');
    expect(ROLE_LABELS.therapist).toBe('Staff Terapis');
  });

  describe('hasAccess', () => {
    it('should grant super_admin and tenant_admin access to all paths', () => {
      expect(hasAccess('super_admin', '/admin/overview')).toBe(true);
      expect(hasAccess('super_admin', '/admin/settings')).toBe(true);
      expect(hasAccess('super_admin', '/admin/debug')).toBe(true);
      expect(hasAccess('super_admin', '/admin/meta-capi-queue')).toBe(true);

      expect(hasAccess('tenant_admin', '/admin/overview')).toBe(true);
      expect(hasAccess('tenant_admin', '/admin/settings')).toBe(true);
    });

    it('should allow admin_cs to access CS & operational menus but block ads/system config', () => {
      expect(hasAccess('admin_cs', '/admin/overview')).toBe(true);
      expect(hasAccess('admin_cs', '/admin/customers')).toBe(true);
      expect(hasAccess('admin_cs', '/admin/reservations')).toBe(true);
      expect(hasAccess('admin_cs', '/admin/live-chat')).toBe(true);
      expect(hasAccess('admin_cs', '/admin/follow-ups')).toBe(true);

      // Blocked for admin_cs
      expect(hasAccess('admin_cs', '/admin/settings')).toBe(false);
      expect(hasAccess('admin_cs', '/admin/debug')).toBe(false);
      expect(hasAccess('admin_cs', '/admin/meta-capi-queue')).toBe(false);
      expect(hasAccess('admin_cs', '/admin/persona')).toBe(false);
    });

    it('should allow advertiser to access ads & reporting but block customer/livechat/settings', () => {
      expect(hasAccess('advertiser', '/admin/overview')).toBe(true);
      expect(hasAccess('advertiser', '/admin/landing')).toBe(true);
      expect(hasAccess('advertiser', '/admin/meta-click-catcher')).toBe(true);
      expect(hasAccess('advertiser', '/admin/meta-capi-queue')).toBe(true);
      expect(hasAccess('advertiser', '/admin/ai-evaluations')).toBe(true);

      // Blocked for advertiser
      expect(hasAccess('advertiser', '/admin/customers')).toBe(false);
      expect(hasAccess('advertiser', '/admin/reservations')).toBe(false);
      expect(hasAccess('advertiser', '/admin/live-chat')).toBe(false);
      expect(hasAccess('advertiser', '/admin/settings')).toBe(false);
      expect(hasAccess('advertiser', '/admin/debug')).toBe(false);
    });

    it('should block therapist from accessing any admin sidebar menus', () => {
      expect(hasAccess('therapist', '/admin/overview')).toBe(false);
      expect(hasAccess('therapist', '/admin/customers')).toBe(false);
      expect(hasAccess('therapist', '/admin/settings')).toBe(false);
    });
  });

  describe('getDefaultRedirect', () => {
    it('should redirect therapist to /admin/staff/today', () => {
      expect(getDefaultRedirect('therapist')).toBe('/admin/staff/today');
    });

    it('should redirect all other roles to /admin/overview', () => {
      expect(getDefaultRedirect('super_admin')).toBe('/admin/overview');
      expect(getDefaultRedirect('admin_cs')).toBe('/admin/overview');
      expect(getDefaultRedirect('advertiser')).toBe('/admin/overview');
    });
  });
});
