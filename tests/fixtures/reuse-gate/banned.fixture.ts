// Fixture: banned.fixture.ts (mendeklarasikan simbol terlarang)
export function isClinicLocationQuestion(text: string): boolean {
  if (!text) return false;
  return /lokasi|alamat|di mana/i.test(text);
}
