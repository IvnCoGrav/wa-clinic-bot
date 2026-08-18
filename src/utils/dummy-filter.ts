/**
 * Helper terstandarisasi untuk mendeteksi nomor/customer dummy, test sandbox, spammer, atau unmapped LID.
 */
export function isDummyOrTestContact(
  phone?: string | null,
  name?: string | null,
  isSandbox?: boolean
): boolean {
  if (isSandbox) return true;
  const ph = (phone || '').trim();
  const nm = (name || '').trim();

  if (!ph || ph === '0' || ph === '628123456789' || ph === '6281234567890') return true;

  // Nomor simulator test (misal 6289999xxx, 628129999xxx, 08571111xxx)
  if (/^628(?:9999|129999)/.test(ph) || ph.startsWith('08571111') || ph.startsWith('628571111')) return true;

  // Prefix mock/dummy
  if (ph.startsWith('dummy_') || ph.startsWith('cust_test_') || ph.startsWith('mock_')) return true;

  // Keyword test di nomor / suffix ec
  if (/test|sandbox|broadcast|newsletter|ec\d+/i.test(ph)) return true;

  // Nama test simulator
  if (nm && /^(?:Bunda\s+Test|Test|Dummy|Sandbox|Spammer|Simulator)$/i.test(nm)) return true;

  // Bukan format telepon seluler Indonesia yang valid (harus 628 atau 08, 9-14 digit)
  if (!/^(?:628|08)\d{7,12}$/.test(ph)) return true;

  return false;
}
