import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';

/**
 * S-012: route pembuatan staf wajib menolak password lemah dan role tak dikenal.
 */
describe('Admin staff — enforcement kebijakan (S-012)', () => {
  const app = buildApp();
  const headers = { 'x-api-key': 'test_admin_key_staff_policy' };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ADMIN_API_KEY = 'test_admin_key_staff_policy';
    (prisma.staff as any).findFirst = vi.fn().mockResolvedValue(null);
    (prisma as any).customRole = { findFirst: vi.fn().mockResolvedValue(null) };
    (prisma.staff as any).create = vi.fn().mockResolvedValue({
      id: 'staff-new', name: 'Dewi', phone: '0812', role: 'THERAPIST', active: true,
    });
  });

  it('password lemah → 400, tidak membuat staf', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/staff',
      headers,
      payload: { name: 'Dewi', phone: '081200001', password: 'rahasia' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/minimal 8|huruf dan angka/i);
    expect((prisma.staff as any).create).not.toHaveBeenCalled();
  });

  it('role tak dikenal → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/staff',
      headers,
      payload: { name: 'Dewi', phone: '081200002', password: 'Secret12345', role: 'HACKER' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/tidak dikenal/i);
    expect((prisma.staff as any).create).not.toHaveBeenCalled();
  });

  it('custom role tenant yang ada → diterima', async () => {
    (prisma as any).customRole.findFirst = vi.fn().mockResolvedValue({ id: 'cr1', key: 'terapis_senior' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/staff',
      headers,
      payload: { name: 'Dewi', phone: '081200003', password: 'Secret12345', role: 'terapis_senior' },
    });
    expect(res.statusCode).toBe(201);
  });
});
