import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getTodayWibDateKey,
  getTomorrowWibDateKey,
  getTomorrowWibDate,
  diffCalendarDaysWib,
} from '../../packages/admin-dashboard/src/utils/dateWib';
import { formatIndonesianDate } from '../../packages/admin-dashboard/src/utils/chatScheduleExtractor';

describe('Reservation Form Default Date Contract (Tomorrow from Today)', () => {
  it('getTomorrowWibDateKey correctly advances 1 day ahead of getTodayWibDateKey in WIB', () => {
    const today = getTodayWibDateKey();
    const tomorrow = getTomorrowWibDateKey();
    expect(diffCalendarDaysWib(today, tomorrow)).toBe(1);
    expect(tomorrow > today).toBe(true);
  });

  it('CreateReservationModal uses getTomorrowWibDateKey as fallback for new reservation', () => {
    const modalPath = join(process.cwd(), 'packages/admin-dashboard/src/components/calendar/CreateReservationModal.tsx');
    const content = readFileSync(modalPath, 'utf8');

    // Pastikan fallback slot target baru memakai __tomorrow__ dan getTomorrowWibDateKey()
    expect(content).toContain("slotTargetKeyRef.current = '__tomorrow__';");
    expect(content).toContain('setBookingDate(getTomorrowWibDateKey());');

    // Pastikan min tetap hari ini agar admin bisa memilih same-day jika diinginkan
    expect(content).toContain("min={mode === 'edit' ? undefined : getTodayWibDateKey()}");
  });

  it('InvoiceGeneratorModal uses dynamic tomorrow date instead of hardcoded August placeholder', () => {
    const invoiceModalPath = join(process.cwd(), 'packages/admin-dashboard/src/components/modals/InvoiceGeneratorModal.tsx');
    const content = readFileSync(invoiceModalPath, 'utf8');

    expect(content).not.toContain('placeholder="Contoh: Minggu 30 Agustus 2026"');
    expect(content).toContain('placeholder={`Contoh: ${formatIndonesianDate(getTomorrowWibDate())}`}');
  });

  it('QuickHoldModal defaults to tomorrow when initialDate is not provided', () => {
    const quickHoldPath = join(process.cwd(), 'packages/admin-dashboard/src/components/calendar/QuickHoldModal.tsx');
    const content = readFileSync(quickHoldPath, 'utf8');

    expect(content).toContain('setBookingDate(getTomorrowWibDateKey());');
  });

  it('formatIndonesianDate defaults to tomorrow when date is omitted', () => {
    const formatted = formatIndonesianDate();
    const tomorrowObj = getTomorrowWibDate();
    expect(formatted).toContain(String(tomorrowObj.getDate()));
    expect(formatted).toContain(String(tomorrowObj.getFullYear()));
  });
});
