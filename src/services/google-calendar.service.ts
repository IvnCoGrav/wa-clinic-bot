import { google } from 'googleapis';
import dotenv from 'dotenv';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { getBrandIdentityAsync } from '../config/brand';
import { getGoogleCalendarConfig } from '../config/google-calendar.config';

dotenv.config();

/**
 * I-006 — sinkronisasi Google Calendar per tenant, idempoten, dan durasi nyata.
 *
 * Tiga akar masalah yang diperbaiki:
 * 1. **Tenant-aware**: kalender tujuan dibaca dari `Tenant.settings.googleCalendar`
 *    (fallback env `GOOGLE_CALENDAR_ID`), bukan satu kalender global.
 * 2. **Idempotensi**: event memakai ID deterministik dari `reservation.id`
 *    (`resv` + hex), sehingga retry/duplicate call tidak membuat event ganda.
 *    Bila Google menjawab 409 (event sudah ada), event lama dikembalikan.
 * 3. **Durasi nyata**: memakai `reservation.duration_minutes` (dari katalog/
 *    admin), bukan asumsi 60 menit; nilai tidak sah → default 60 menit.
 *
 * Brand pada judul/deskripsi memakai `getBrandIdentityAsync(tenantId)` agar
 * nama klinik tenant tidak tertukar dengan default.
 */

export const DEFAULT_EVENT_DURATION_MINUTES = 60;
export const MAX_EVENT_DURATION_MINUTES = 12 * 60;

export interface CalendarReservationInput {
  id?: string | null;
  tenant_id?: string | null;
  booking_date: Date | string | null;
  treatment_detail: string | null;
  duration_minutes?: number | null;
  items?: any[];
}

export interface GoogleCalendarClientDeps {
  /** Klien Calendar terinjeksi (test). Bila diisi, mode mock/real mengikuti. */
  calendarClient?: any;
  isConfigured?: boolean;
}

/** Durasi event (menit) dari reservasi — deterministik & aman. */
export function resolveEventDurationMinutes(reservation: CalendarReservationInput): number {
  const raw = Number(reservation?.duration_minutes);
  if (Number.isFinite(raw) && raw >= 10 && raw <= MAX_EVENT_DURATION_MINUTES) {
    return Math.round(raw);
  }
  return DEFAULT_EVENT_DURATION_MINUTES;
}

/**
 * ID event Google Calendar deterministik dari ID reservasi.
 * Google hanya menerima karakter base32hex `[a-v0-9]`; hex memenuhi itu dan
 * stabil lintas retry/proses.
 */
export function buildCalendarEventId(reservationId?: string | null): string | null {
  const id = typeof reservationId === 'string' ? reservationId.trim() : '';
  if (!id) return null;
  return `resv${Buffer.from(id, 'utf8').toString('hex')}`;
}

function isDuplicateEventError(err: any): boolean {
  const status = err?.code ?? err?.response?.status;
  if (status === 409) return true;
  return /duplicate/i.test(String(err?.message || ''));
}

export class GoogleCalendarService {
  private calendarClient: any = null;
  private defaultCalendarId: string = 'primary';
  private isConfigured = false;

  constructor(deps: GoogleCalendarClientDeps = {}) {
    const clientEmail = process.env.GOOGLE_CALENDAR_CLIENT_EMAIL;
    let privateKey = process.env.GOOGLE_CALENDAR_PRIVATE_KEY;
    const calendarId = process.env.GOOGLE_CALENDAR_ID;

    if (calendarId) {
      this.defaultCalendarId = calendarId;
    }

    if (clientEmail && privateKey) {
      try {
        // Handle escaped newlines in environment variables
        const formattedKey = privateKey.replace(/\\n/g, '\n');

        const auth = new google.auth.JWT({
          email: clientEmail,
          key: formattedKey,
          scopes: ['https://www.googleapis.com/auth/calendar'],
        });

        this.calendarClient = google.calendar({ version: 'v3', auth });
        this.isConfigured = true;
      } catch (err) {
        console.error('[Google Calendar] Failed to initialize API client:', err);
      }
    } else {
      console.warn('[Google Calendar] Service Account credentials are missing. Falling back to Mock mode.');
    }

    // Seam test: klien terinjeksi menggantikan inisialisasi env.
    if (deps.calendarClient !== undefined) {
      this.calendarClient = deps.calendarClient;
      this.isConfigured = deps.isConfigured ?? true;
    }
  }

  /** Bangun payload event (murni) agar mudah diuji & dipakai create/update. */
  public async buildEventPayload(
    reservation: CalendarReservationInput,
    customerName: string,
    tenantId: string,
    action: 'created' | 'updated' = 'created'
  ): Promise<Record<string, any>> {
    if (!reservation.booking_date) {
      throw new Error('Booking date is required to sync a calendar event');
    }

    const startDateTime = new Date(reservation.booking_date);
    if (isNaN(startDateTime.getTime())) {
      throw new Error('Booking date is invalid for calendar event');
    }
    const endDateTime = new Date(
      startDateTime.getTime() + resolveEventDurationMinutes(reservation) * 60 * 1000
    );

    const treatmentText =
      Array.isArray(reservation.items) && reservation.items.length > 0
        ? reservation.items.map((i: any) => i.custom_name || i.name).filter(Boolean).join(' + ')
        : reservation.treatment_detail || 'Moms / Baby Spa';

    const brand = await getBrandIdentityAsync(tenantId);

    return {
      summary: `${brand.businessName} Treatment - ${customerName}`,
      description: `Treatment: ${treatmentText}\n${action === 'created' ? 'Created' : 'Updated'} automatically by ${brand.businessName} Chatbot.`,
      start: {
        dateTime: startDateTime.toISOString(),
        timeZone: 'Asia/Jakarta',
      },
      end: {
        dateTime: endDateTime.toISOString(),
        timeZone: 'Asia/Jakarta',
      },
    };
  }

  private async resolveContext(
    reservation: CalendarReservationInput,
    tenantId?: string
  ): Promise<{ tenantId: string; calendarId: string; enabled: boolean }> {
    const effectiveTenant =
      tenantId || (reservation?.tenant_id as string | undefined) || DEFAULT_TENANT_ID;
    const cfg = await getGoogleCalendarConfig(effectiveTenant, this.defaultCalendarId);
    return { tenantId: effectiveTenant, calendarId: cfg.calendarId, enabled: cfg.enabled };
  }

  /**
   * Menambahkan event baru ke Google Calendar (idempoten).
   * @returns ID event Google Calendar
   */
  public async createEvent(
    reservation: CalendarReservationInput,
    customerName: string,
    tenantId?: string
  ): Promise<string> {
    const ctx = await this.resolveContext(reservation, tenantId);
    if (!ctx.enabled) {
      console.log(`[Google Calendar] Disabled for tenant '${ctx.tenantId}' — event dilewati.`);
      return '';
    }

    const event = await this.buildEventPayload(reservation, customerName, ctx.tenantId, 'created');
    const eventId = buildCalendarEventId(reservation.id);

    if (!this.isConfigured || !this.calendarClient) {
      const mockEventId = eventId ? `mock_cal_event_${eventId}` : `mock_cal_event_${Date.now()}`;
      console.log('[Google Calendar Mock] Created Event:', mockEventId, { calendarId: ctx.calendarId, event });
      return mockEventId;
    }

    const requestBody = eventId ? { ...event, id: eventId } : event;
    try {
      const res = await this.calendarClient.events.insert({
        calendarId: ctx.calendarId,
        requestBody,
      });
      return res.data.id || eventId || '';
    } catch (err: any) {
      // Idempotensi: event dengan ID sama sudah ada (retry/duplicate turn).
      if (eventId && isDuplicateEventError(err)) {
        try {
          const existing = await this.calendarClient.events.get({
            calendarId: ctx.calendarId,
            eventId,
          });
          return existing?.data?.id || eventId;
        } catch (getErr: any) {
          console.warn('[Google Calendar] Duplicate event tetapi gagal dibaca:', getErr?.message || getErr);
          return eventId;
        }
      }
      console.error('[Google Calendar] Error creating event:', err);
      throw new Error(`Failed to create calendar event: ${err?.message || err}`);
    }
  }

  /**
   * Memperbarui detail / waktu event di Google Calendar.
   */
  public async updateEvent(
    eventId: string,
    reservation: CalendarReservationInput,
    customerName: string,
    tenantId?: string
  ): Promise<void> {
    const ctx = await this.resolveContext(reservation, tenantId);
    if (!ctx.enabled) {
      console.log(`[Google Calendar] Disabled for tenant '${ctx.tenantId}' — update dilewati.`);
      return;
    }

    const event = await this.buildEventPayload(reservation, customerName, ctx.tenantId, 'updated');

    if (!this.isConfigured || !this.calendarClient) {
      console.log('[Google Calendar Mock] Updated Event:', eventId, { calendarId: ctx.calendarId, event });
      return;
    }

    try {
      await this.calendarClient.events.update({
        calendarId: ctx.calendarId,
        eventId,
        requestBody: event,
      });
    } catch (err: any) {
      console.error('[Google Calendar] Error updating event:', err);
      throw new Error(`Failed to update calendar event: ${err?.message || err}`);
    }
  }

  /**
   * Menghapus event dari Google Calendar.
   */
  public async deleteEvent(eventId: string, tenantId?: string): Promise<void> {
    const ctx = await this.resolveContext({ booking_date: null, treatment_detail: null }, tenantId);
    if (!ctx.enabled) {
      console.log(`[Google Calendar] Disabled for tenant '${ctx.tenantId}' — delete dilewati.`);
      return;
    }

    if (!this.isConfigured || !this.calendarClient) {
      console.log('[Google Calendar Mock] Deleted Event:', eventId, { calendarId: ctx.calendarId });
      return;
    }

    try {
      await this.calendarClient.events.delete({
        calendarId: ctx.calendarId,
        eventId,
      });
    } catch (err: any) {
      // Jika event sudah terhapus manual di calendar web, kita abaikan saja / warning
      console.warn('[Google Calendar] Error deleting event:', err?.message || err);
    }
  }
}

export const googleCalendarService = new GoogleCalendarService();
