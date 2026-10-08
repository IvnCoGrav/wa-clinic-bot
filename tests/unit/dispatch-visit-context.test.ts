import { describe, it, expect } from 'vitest';
import {
  shouldWarnUnregisteredVisit,
  hasFreshSharelocToday,
  hasFreshDispatchMediaToday,
  isWithinWibDay,
  VisitMessageLike,
  VisitFieldState,
} from '../../src/domain/dispatch-visit-context';

describe('Dispatch Visit Context — Presisi Tanpa-Hafalan (MT-3.1)', () => {
  // Pin batas waktu kalender WIB secara deterministik (2026-10-08 00:00:00 – 23:59:59.999 WIB)
  // 00:00:00 WIB = 2026-10-07 17:00:00.000 UTC
  // 23:59:59 WIB = 2026-10-08 16:59:59.999 UTC
  const dayStart = new Date('2026-10-07T17:00:00.000Z');
  const dayEnd = new Date('2026-10-08T16:59:59.999Z');

  const todayMid = new Date('2026-10-08T03:00:00.000Z'); // 10:00 WIB
  const thirtyDaysAgo = new Date('2026-09-08T03:00:00.000Z');
  const threeDaysAgo = new Date('2026-10-05T03:00:00.000Z');

  const emptyField: VisitFieldState = {
    hasTodayReservation: false,
    hasActiveTrip: false,
    hasOtwActive: false,
  };

  it('1. REJECT: Media OUTBOUND lampau 30 hari yang lalu tidak memicu peringatan', () => {
    const messages: VisitMessageLike[] = [
      {
        direction: 'OUTBOUND',
        sender_type: 'ADMIN',
        content: '[IMAGE]',
        media: { url: 'https://example.com/asset-1.jpg' },
        created_at: thirtyDaysAgo,
      },
    ];

    expect(hasFreshDispatchMediaToday(messages, dayStart, dayEnd)).toBe(false);
    expect(shouldWarnUnregisteredVisit({ messages, dayStart, dayEnd, field: emptyField })).toBe(false);
  });

  it('2. REJECT: Media OUTBOUND hari ini yang bukan pesan terakhir dan tanpa flag penugasan tidak memicu peringatan', () => {
    const messages: VisitMessageLike[] = [
      {
        direction: 'OUTBOUND',
        sender_type: 'ADMIN',
        content: '[IMAGE]',
        media: { url: 'https://example.com/catalog.jpg' },
        created_at: todayMid,
        dispatchOrigin: false,
        isFieldStaff: false,
      },
      {
        direction: 'OUTBOUND',
        sender_type: 'ADMIN',
        content: 'Ada yang bisa kami bantu lagi?',
        created_at: new Date('2026-10-08T03:05:00.000Z'),
      },
    ];

    expect(hasFreshDispatchMediaToday(messages, dayStart, dayEnd)).toBe(false);
    expect(shouldWarnUnregisteredVisit({ messages, dayStart, dayEnd, field: emptyField })).toBe(false);
  });

  it('3. REJECT: Bukti transfer INBOUND dari pasien tidak memicu peringatan kunjungan', () => {
    const messages: VisitMessageLike[] = [
      {
        direction: 'INBOUND',
        sender_type: 'CUSTOMER',
        content: '[IMAGE]',
        media: { url: 'https://example.com/payment.jpg' },
        created_at: todayMid,
      },
    ];

    expect(hasFreshDispatchMediaToday(messages, dayStart, dayEnd)).toBe(false);
    expect(shouldWarnUnregisteredVisit({ messages, dayStart, dayEnd, field: emptyField })).toBe(false);
  });

  it('4. REJECT: Shareloc lampau 3 hari yang lalu tidak memicu peringatan', () => {
    const messages: VisitMessageLike[] = [
      {
        direction: 'INBOUND',
        sender_type: 'CUSTOMER',
        location: { lat: -7.267, lng: 112.698 },
        created_at: threeDaysAgo,
      },
    ];

    expect(hasFreshSharelocToday(messages, dayStart, dayEnd)).toBe(false);
    expect(shouldWarnUnregisteredVisit({ messages, dayStart, dayEnd, field: emptyField })).toBe(false);
  });

  it('5. ACCEPT: Shareloc hari ini memicu peringatan (menguji 3 format: objek, format [LOCATION: Lat..], format [LOCATION Lat..])', () => {
    const msgObj: VisitMessageLike[] = [
      {
        direction: 'INBOUND',
        location: { latitude: -7.267, longitude: 112.698 },
        created_at: todayMid,
      },
    ];
    expect(hasFreshSharelocToday(msgObj, dayStart, dayEnd)).toBe(true);
    expect(shouldWarnUnregisteredVisit({ messages: msgObj, dayStart, dayEnd, field: emptyField })).toBe(true);

    const msgTag1: VisitMessageLike[] = [
      {
        direction: 'INBOUND',
        content: '[LOCATION: Lat -7.267, Lng 112.698]',
        created_at: todayMid,
      },
    ];
    expect(hasFreshSharelocToday(msgTag1, dayStart, dayEnd)).toBe(true);
    expect(shouldWarnUnregisteredVisit({ messages: msgTag1, dayStart, dayEnd, field: emptyField })).toBe(true);

    const msgTag2: VisitMessageLike[] = [
      {
        direction: 'INBOUND',
        content: '[LOCATION Lat -7.267, Lng 112.698]',
        created_at: todayMid,
      },
    ];
    expect(hasFreshSharelocToday(msgTag2, dayStart, dayEnd)).toBe(true);
    expect(shouldWarnUnregisteredVisit({ messages: msgTag2, dayStart, dayEnd, field: emptyField })).toBe(true);
  });

  it('6. ACCEPT: Media OUTBOUND hari ini dengan flag dispatchOrigin=true memicu peringatan jika tanpa reservasi', () => {
    const messages: VisitMessageLike[] = [
      {
        direction: 'OUTBOUND',
        sender_type: 'ADMIN',
        media: { url: 'https://example.com/dispatch-live.jpg' },
        dispatchOrigin: true,
        created_at: todayMid,
      },
      {
        direction: 'OUTBOUND',
        sender_type: 'ADMIN',
        content: 'Konfirmasi kunjungan',
        created_at: new Date('2026-10-08T03:02:00.000Z'),
      },
    ];

    expect(hasFreshDispatchMediaToday(messages, dayStart, dayEnd)).toBe(true);
    expect(shouldWarnUnregisteredVisit({ messages, dayStart, dayEnd, field: emptyField })).toBe(true);
  });

  it('7. REJECT pesan terakhir tanpa cap & ACCEPT jika membawa isFieldStaff=true / dispatchOrigin=true', () => {
    // Pesan terakhir tanpa cap dispatchOrigin atau isFieldStaff = false (brosur/gambar biasa)
    const messagesLastWithoutCap: VisitMessageLike[] = [
      {
        direction: 'OUTBOUND',
        sender_type: 'ADMIN',
        media: { url: 'https://example.com/photo.jpg' },
        created_at: todayMid,
      },
    ];
    expect(hasFreshDispatchMediaToday(messagesLastWithoutCap, dayStart, dayEnd)).toBe(false);
    expect(shouldWarnUnregisteredVisit({ messages: messagesLastWithoutCap, dayStart, dayEnd, field: emptyField })).toBe(false);

    // Staf lapangan dengan isFieldStaff=true = true
    const messagesStaff: VisitMessageLike[] = [
      {
        direction: 'OUTBOUND',
        sender_type: 'STAFF',
        media: { url: 'https://example.com/photo.jpg' },
        isFieldStaff: true,
        created_at: todayMid,
      },
      {
        direction: 'OUTBOUND',
        sender_type: 'ADMIN',
        content: 'Terima kasih',
        created_at: new Date('2026-10-08T03:05:00.000Z'),
      },
    ];
    expect(hasFreshDispatchMediaToday(messagesStaff, dayStart, dayEnd)).toBe(true);
    expect(shouldWarnUnregisteredVisit({ messages: messagesStaff, dayStart, dayEnd, field: emptyField })).toBe(true);
  });

  it('8. GUARD STATE: Bila ada reservasi hari ini, trip aktif, atau OTW aktif, peringatan selalu padam (false)', () => {
    const messages: VisitMessageLike[] = [
      {
        direction: 'OUTBOUND',
        location: { lat: -7.267, lng: 112.698 },
        media: { url: 'https://example.com/photo.jpg' },
        created_at: todayMid,
      },
    ];

    // Case a: reservasi hari ini ada
    expect(
      shouldWarnUnregisteredVisit({
        messages,
        dayStart,
        dayEnd,
        field: { hasTodayReservation: true, hasActiveTrip: false, hasOtwActive: false },
      })
    ).toBe(false);

    // Case b: trip aktif ada
    expect(
      shouldWarnUnregisteredVisit({
        messages,
        dayStart,
        dayEnd,
        field: { hasTodayReservation: false, hasActiveTrip: true, hasOtwActive: false },
      })
    ).toBe(false);

    // Case c: OTW aktif ada
    expect(
      shouldWarnUnregisteredVisit({
        messages,
        dayStart,
        dayEnd,
        field: { hasTodayReservation: false, hasActiveTrip: false, hasOtwActive: true },
      })
    ).toBe(false);
  });

  it('9. STATUS RESERVASI: completed hari ini meredam alarm (anti-dobel booking)', () => {
    const freshShareloc: VisitMessageLike[] = [
      {
        direction: 'INBOUND',
        location: { lat: -7.267, lng: 112.698 },
        created_at: todayMid,
      },
    ];
    // Reservasi completed hari ini dipetakan ke hasTodayReservation=true
    expect(
      shouldWarnUnregisteredVisit({
        messages: freshShareloc,
        dayStart,
        dayEnd,
        field: { hasTodayReservation: true, hasActiveTrip: false, hasOtwActive: false },
      })
    ).toBe(false);
  });

  it('10. STATUS RESERVASI: cancelled hari ini tidak meredam alarm (batal tetap picu peringatan jika ada shareloc)', () => {
    const freshShareloc: VisitMessageLike[] = [
      {
        direction: 'INBOUND',
        location: { lat: -7.267, lng: 112.698 },
        created_at: todayMid,
      },
    ];
    // Reservasi cancelled tidak memberikan perlindungan (hasTodayReservation=false)
    expect(
      shouldWarnUnregisteredVisit({
        messages: freshShareloc,
        dayStart,
        dayEnd,
        field: { hasTodayReservation: false, hasActiveTrip: false, hasOtwActive: false },
      })
    ).toBe(true);
  });
});
