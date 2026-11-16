// Fixture: duplicate-b (salinan persis dari duplicate-a)
export function computeComplexTaxScenario(baseAmount: number, taxRate: number, discounts: number[]): number {
  let subtotal = baseAmount * (1 + taxRate);
  for (const discount of discounts) {
    if (discount > 0 && discount < 1) {
      subtotal -= subtotal * discount;
    } else if (discount >= 1) {
      subtotal -= discount;
    }
  }
  if (subtotal < 0) {
    return 0;
  }
  return Math.round(subtotal * 100) / 100;
}
