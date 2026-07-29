import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { googleCalendarService } from '../../src/services/google-calendar.service';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { FastifyInstance } from 'fastify';

describe('Google Calendar Integration Tests', () => {
  let app: FastifyInstance;
  let createEventSpy: any;
  let updateEventSpy: any;
  let deleteEventSpy: any;

  beforeAll(async () => {
    process.env.ADMIN_API_KEY = 'my_admin_api_key_secret';
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup spies
    createEventSpy = vi.spyOn(googleCalendarService, 'createEvent').mockResolvedValue('mocked-calendar-id-123');
    updateEventSpy = vi.spyOn(googleCalendarService, 'updateEvent').mockResolvedValue(undefined);
    deleteEventSpy = vi.spyOn(googleCalendarService, 'deleteEvent').mockResolvedValue(undefined);
  });

  it('PATCH /api/admin/reservation/:id/confirm -> triggers Calendar event creation', async () => {
    // Mock database records
    const mockReservation = {
      id: 'res-123',
      customer_id: 'cust-999',
      booking_date: new Date('2026-08-01T10:00:00.000Z'),
      treatment_detail: 'Pijat Bayi Ceria',
      status: 'pending',
      customer: {
        id: 'cust-999',
        name: 'Bunda Indah',
        phone: '62899999999',
      },
    };

    vi.mocked(prisma.reservation.findFirst).mockResolvedValue(mockReservation as any);
    vi.mocked(prisma.reservation.update).mockResolvedValue({
      ...mockReservation,
      status: 'confirmed',
      google_calendar_event_id: 'mocked-calendar-id-123',
    } as any);

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/reservation/res-123/confirm',
      headers: {
        'x-api-key': 'my_admin_api_key_secret',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.google_calendar_event_id).toBe('mocked-calendar-id-123');

    // Pastikan googleCalendarService.createEvent dipanggil dengan argumen yang benar
    expect(createEventSpy).toHaveBeenCalledTimes(1);
    expect(createEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'res-123' }),
      'Bunda Indah'
    );
  });

  it('PATCH /api/admin/reservation/:id/set-date -> triggers Calendar event update if google_calendar_event_id exists', async () => {
    const mockReservation = {
      id: 'res-123',
      customer_id: 'cust-999',
      booking_date: new Date('2026-08-01T10:00:00.000Z'),
      treatment_detail: 'Pijat Bayi Ceria',
      status: 'confirmed',
      google_calendar_event_id: 'mocked-calendar-id-123',
      customer: {
        id: 'cust-999',
        name: 'Bunda Indah',
        phone: '62899999999',
      },
    };

    vi.mocked(prisma.reservation.findFirst).mockResolvedValue(mockReservation as any);
    vi.mocked(prisma.reservation.update).mockResolvedValue({
      ...mockReservation,
      booking_date: new Date('2026-08-02T10:00:00.000Z'),
    } as any);

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/reservation/res-123/set-date',
      headers: {
        'x-api-key': 'my_admin_api_key_secret',
      },
      payload: {
        bookingDate: '2026-08-02T10:00:00.000Z',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).success).toBe(true);

    // Pastikan updateEvent terpanggil
    expect(updateEventSpy).toHaveBeenCalledTimes(1);
    expect(updateEventSpy).toHaveBeenCalledWith(
      'mocked-calendar-id-123',
      expect.objectContaining({ id: 'res-123' }),
      'Bunda Indah'
    );
  });

  it('DELETE /api/admin/reservation/:id -> triggers Calendar event deletion', async () => {
    const mockReservation = {
      id: 'res-123',
      customer_id: 'cust-999',
      booking_date: new Date('2026-08-01T10:00:00.000Z'),
      treatment_detail: 'Pijat Bayi Ceria',
      status: 'confirmed',
      google_calendar_event_id: 'mocked-calendar-id-123',
      customer: {
        id: 'cust-999',
        name: 'Bunda Indah',
        phone: '62899999999',
      },
    };

    vi.mocked(prisma.reservation.findFirst).mockResolvedValue(mockReservation as any);
    vi.mocked(prisma.reservation.update).mockResolvedValue({
      ...mockReservation,
      status: 'cancelled',
    } as any);
    
    // Mock follow-up active check (return active follow-up so we don't trigger restoration in this test, tested separately)
    vi.mocked(prisma.followUp.findFirst).mockResolvedValue({ id: 'f-active' } as any);

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/admin/reservation/res-123',
      headers: {
        'x-api-key': 'my_admin_api_key_secret',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).success).toBe(true);

    // Pastikan deleteEvent terpanggil
    expect(deleteEventSpy).toHaveBeenCalledTimes(1);
    expect(deleteEventSpy).toHaveBeenCalledWith('mocked-calendar-id-123');
  });
});
