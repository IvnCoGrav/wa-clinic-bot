/**
 * money-contract.ts — Kontrak uang tunggal (Fase 0).
 * effective = promoPrice ?? price ?? originalPrice ?? 0.
 * total = sum(effective) + ongkirNet - discountRp.
 * Murni, tanpa I/O, tenant-agnostic (angka dari DB/katalog).
 */
export interface MoneyLike {
  price?: number | null;
  promoPrice?: number | null;
  originalPrice?: number | null;
}
export function effectiveOf(m: MoneyLike | null | undefined): number {
  if (!m) return 0;
  if (typeof m.promoPrice === 'number') return m.promoPrice;
  if (typeof m.price === 'number') return m.price;
  if (typeof m.originalPrice === 'number') return m.originalPrice;
  return 0;
}
export function totalOf(items: MoneyLike[], ongkirNet = 0, discountRp = 0): number {
  const sub = (items || []).reduce((s, it) => s + effectiveOf(it), 0);
  return sub + (ongkirNet || 0) - (discountRp || 0);
}
