import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { StaffAuthService } from '../../src/services/staff-auth.service';
import { auditService } from '../../src/services/audit.service';
import { prisma } from '../../src/db/client';

describe('Admin Staff Management & Assignment Integration Tests (/api/admin/staff & reservation assign)', () => {
  const app = buildApp();
  const adminHeaders = { 'x-api-key': 'test_admin_key_999' };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ADMIN_API_KEY = 'test_admin_key_999';
  });

  describe('GET /api/admin/staff', () => {
    it('returns staff list successfully', async () => {
      (prisma.staff.findMany as any).mockResolvedValue([
        {
          id: 'staff-1',
          tenant_id: 'default-tenant',
          name: 'Bidan Dewi',
          phone: '08123456789',
          role: 'THERAPIST',
          active: true,
          created_at: new Date(),
          updated_at: new Date(),
          _count: { reservations: 3 },
        },
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/staff',
        headers: adminHeaders,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].name).toBe('Bidan Dewi');
    });
  });

  describe('POST /api/admin/staff', () => {
    it('validates required fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/staff',
        headers: adminHeaders,
        payload: { name: 'Dewi' },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toContain('wajib diisi');
    });

    it('returns 409 when phone number already exists', async () => {
      (prisma.staff.findFirst as any).mockResolvedValue({ id: 'staff-existing' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/staff',
        headers: adminHeaders,
        payload: { name: 'Dewi', phone: '08123456789', password: 'secretpassword' },
      });

      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.body);
      expect(body.error).toContain('sudah terdaftar');
    });

    it('creates staff and logs audit action successfully', async () => {
      (prisma.staff.findFirst as any).mockResolvedValue(null);
      (prisma.staff.create as any).mockResolvedValue({
        id: 'staff-new',
        tenant_id: 'default-tenant',
        name: 'Bidan Dewi',
        phone: '08123456789',
        role: 'THERAPIST',
        active: true,
        created_at: new Date(),
        updated_at: new Date(),
      });
      const auditSpy = vi.spyOn(auditService, 'logAdminAction').mockResolvedValue();

      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/staff',
        headers: adminHeaders,
        payload: { name: 'Bidan Dewi', phone: '08123456789', password: 'secretpassword' },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.data.id).toBe('staff-new');
      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CREATE_STAFF',
          targetId: 'staff-new',
        })
      );
    });
  });

  describe('PATCH /api/admin/staff/:id', () => {
    it('updates staff and revokes sessions when deactivated', async () => {
      (prisma.staff.findFirst as any).mockResolvedValue({
        id: 'staff-1',
        name: 'Bidan Dewi',
        phone: '08123456789',
        active: true,
      });

      (prisma.staff.update as any).mockResolvedValue({
        id: 'staff-1',
        tenant_id: 'default-tenant',
        name: 'Bidan Dewi',
        phone: '08123456789',
        role: 'THERAPIST',
        active: false,
        created_at: new Date(),
        updated_at: new Date(),
      });

      const revokeSpy = vi.spyOn(StaffAuthService, 'revokeAllSessions').mockResolvedValue(true);
      const auditSpy = vi.spyOn(auditService, 'logAdminAction').mockResolvedValue();

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/admin/staff/staff-1',
        headers: adminHeaders,
        payload: { active: false },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.data.active).toBe(false);
      expect(revokeSpy).toHaveBeenCalledWith('staff-1');
      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'UPDATE_STAFF',
          targetId: 'staff-1',
        })
      );
    });
  });

  describe('PATCH /api/admin/reservation/:id/assign-staff', () => {
    it('assigns staff to reservation successfully', async () => {
      (prisma.reservation.findFirst as any).mockResolvedValue({
        id: 'res-1',
        tenant_id: 'default-tenant',
      });

      (prisma.staff.findFirst as any).mockResolvedValue({
        id: 'staff-1',
        name: 'Bidan Dewi',
      });

      (prisma.reservation.update as any).mockResolvedValue({
        id: 'res-1',
        assigned_staff_id: 'staff-1',
        assigned_staff: {
          id: 'staff-1',
          name: 'Bidan Dewi',
          phone: '08123456789',
        },
      });

      const auditSpy = vi.spyOn(auditService, 'logAdminAction').mockResolvedValue();

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/admin/reservation/res-1/assign-staff',
        headers: adminHeaders,
        payload: { assigned_staff_id: 'staff-1' },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.data.assigned_staff.name).toBe('Bidan Dewi');
      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ASSIGN_RESERVATION_STAFF',
          targetId: 'res-1',
        })
      );
    });
  });

  describe('DELETE /api/admin/staff/:id', () => {
    it('returns 404 if staff not found', async () => {
      (prisma.staff.findFirst as any).mockResolvedValue(null);

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/admin/staff/non-existent-id',
        headers: adminHeaders,
      });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.error).toContain('tidak ditemukan');
    });

    it('deletes staff, revokes sessions, and logs audit action successfully', async () => {
      (prisma.staff.findFirst as any).mockResolvedValue({
        id: 'staff-to-del',
        tenant_id: 'default-tenant',
        name: 'Bidan Rina',
        phone: '081255556666',
        role: 'THERAPIST',
      });
      (prisma.staff.delete as any).mockResolvedValue({ id: 'staff-to-del' });

      const revokeSpy = vi.spyOn(StaffAuthService, 'revokeAllSessions').mockResolvedValue(true);
      const auditSpy = vi.spyOn(auditService, 'logAdminAction').mockResolvedValue();

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/admin/staff/staff-to-del',
        headers: adminHeaders,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.message).toContain('Bidan Rina');
      expect(revokeSpy).toHaveBeenCalledWith('staff-to-del');
      expect(prisma.staff.delete).toHaveBeenCalledWith({
        where: { id: 'staff-to-del' },
      });
      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DELETE_STAFF',
          targetId: 'staff-to-del',
        })
      );
    });
  });
});
