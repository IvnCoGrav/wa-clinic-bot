/**
 * src/v3/guardrails/numeric-fact-validator.ts
 * Memvalidasi apakah semua nominal rupiah di teks balasan cocok dengan data tool resmi.
 */

export interface NumericValidationResult {
  isValid: boolean;
  violations: string[];
}

export function validateNumericFacts(replyText: string, executedTools: Array<{ name: string; result: any }>): NumericValidationResult {
  const violations: string[] = [];
  
  // Ekstrak semua nominal Rp di teks balasan (misal "Rp 70.000" -> 70000)
  const priceMatches = replyText.match(/Rp\s*(\d{1,3}(?:\.\d{3})*)/gi);
  if (!priceMatches) {
    return { isValid: true, violations: [] };
  }

  // Kumpulkan himpunan harga resmi yang disetujui dari tool yang dieksekusi di turn ini
  const authorizedNumbers = new Set<number>();
  authorizedNumbers.add(0); // Gratis ongkir
  authorizedNumbers.add(10000); // Addon Sinar Moksa standard

  for (const t of executedTools) {
    if (t.name === 'get_catalog_and_price' && Array.isArray(t.result?.treatments)) {
      for (const item of t.result.treatments) {
        if (item.promoPrice) authorizedNumbers.add(item.promoPrice);
        if (item.originalPrice) authorizedNumbers.add(item.originalPrice);
      }
    }
    if (t.name === 'calculate_delivery' && t.result?.success) {
      if (t.result.ongkirPromo != null) authorizedNumbers.add(t.result.ongkirPromo);
      if (t.result.ongkirNormal != null) authorizedNumbers.add(t.result.ongkirNormal);
    }
  }

  // Cek setiap angka di teks
  for (const m of priceMatches) {
    const rawVal = parseInt(m.replace(/[^0-9]/g, ''), 10);
    // Abaikan jika angka < 5000 (bukan harga)
    if (rawVal >= 5000 && !authorizedNumbers.has(rawVal)) {
      violations.push(`Nominal Rp ${rawVal.toLocaleString('id-ID')} tidak ditemukan di data katalog/ongkir tool resmi.`);
    }
  }

  return {
    isValid: violations.length === 0,
    violations,
  };
}
