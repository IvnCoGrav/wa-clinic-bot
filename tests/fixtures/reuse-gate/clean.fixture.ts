// Fixture: clean.fixture.ts
export function calculateCartDiscount(itemsCount: number, pricePerItem: number, couponPercent: number): number {
  const rawTotal = itemsCount * pricePerItem;
  if (couponPercent > 0 && couponPercent <= 100) {
    const discountAmount = (rawTotal * couponPercent) / 100;
    return rawTotal - discountAmount;
  }
  return rawTotal;
}

export function cleanConsumer() {
  return calculateCartDiscount(2, 50000, 10);
}
