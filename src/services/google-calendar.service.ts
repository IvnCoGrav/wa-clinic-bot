import { google } from 'googleapis';
import dotenv from 'dotenv';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { getBrandIdentity } from '../config/brand';

dotenv.config();

export class GoogleCalendarService {
  private calendarClient: any = null;
  private calendarId: string = 'primary';
  private isConfigured = false;

  constructor() {
    const clientEmail = process.env.GOOGLE_CALENDAR_CLIENT_EMAIL;
    let privateKey = process.env.GOOGLE_CALENDAR_PRIVATE_KEY;
    const calendarId = process.env.GOOGLE_CALENDAR_ID;

    if (calendarId) {
      this.calendarId = calendarId;
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
  }

  /**
   * Menambahkan event baru ke Google Calendar
   * @returns ID event Google Calendar
   */
  public async createEvent(reservation: { booking_date: Date | null; treatment_detail: string | null }, customerName: string): Promise<string> {
    if (!reservation.booking_date) {
      throw new Error('Booking date is required to create a calendar event');
    }

    const startDateTime = new Date(reservation.booking_date);
    // Asumsi durasi default 60 menit jika detail tidak di-parse, atau disesuaikan
    const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000);

    const event = {
      summary: `${getBrandIdentity().businessName} Treatment - ${customerName}`,
      description: `Treatment: ${reservation.treatment_detail || 'Moms / Baby Spa'}\nCreated automatically by ${getBrandIdentity().businessName} Chatbot.`,
      start: {
        dateTime: startDateTime.toISOString(),
        timeZone: 'Asia/Jakarta',
      },
      end: {
        dateTime: endDateTime.toISOString(),
        timeZone: 'Asia/Jakarta',
      },
    };

    if (!this.isConfigured || !this.calendarClient) {
      const mockEventId = `mock_cal_event_${Date.now()}`;
      console.log('[Google Calendar Mock] Created Event:', mockEventId, event);
      return mockEventId;
    }

    try {
      const res = await this.calendarClient.events.insert({
        calendarId: this.calendarId,
        requestBody: event,
      });
      return res.data.id || '';
    } catch (err: any) {
      console.error('[Google Calendar] Error creating event:', err);
      throw new Error(`Failed to create calendar event: ${err.message}`);
    }
  }

  /**
   * Memperbarui detail / waktu event di Google Calendar
   */
  public async updateEvent(eventId: string, reservation: { booking_date: Date | null; treatment_detail: string | null }, customerName: string): Promise<void> {
    if (!reservation.booking_date) {
      throw new Error('Booking date is required to update a calendar event');
    }

    const startDateTime = new Date(reservation.booking_date);
    const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000);

    const event = {
      summary: `${getBrandIdentity().businessName} Treatment - ${customerName}`,
      description: `Treatment: ${reservation.treatment_detail || 'Moms / Baby Spa'}\nUpdated automatically by ${getBrandIdentity().businessName} Chatbot.`,
      start: {
        dateTime: startDateTime.toISOString(),
        timeZone: 'Asia/Jakarta',
      },
      end: {
        dateTime: endDateTime.toISOString(),
        timeZone: 'Asia/Jakarta',
      },
    };

    if (!this.isConfigured || !this.calendarClient) {
      console.log('[Google Calendar Mock] Updated Event:', eventId, event);
      return;
    }

    try {
      await this.calendarClient.events.update({
        calendarId: this.calendarId,
        eventId,
        requestBody: event,
      });
    } catch (err: any) {
      console.error('[Google Calendar] Error updating event:', err);
      throw new Error(`Failed to update calendar event: ${err.message}`);
    }
  }

  /**
   * Menghapus event dari Google Calendar
   */
  public async deleteEvent(eventId: string): Promise<void> {
    if (!this.isConfigured || !this.calendarClient) {
      console.log('[Google Calendar Mock] Deleted Event:', eventId);
      return;
    }

    try {
      await this.calendarClient.events.delete({
        calendarId: this.calendarId,
        eventId,
      });
    } catch (err: any) {
      // Jika event sudah terhapus manual di calendar web, kita abaikan saja / warning
      console.warn('[Google Calendar] Error deleting event:', err.message);
    }
  }
}

export const googleCalendarService = new GoogleCalendarService();
