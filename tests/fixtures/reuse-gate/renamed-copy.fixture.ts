// Fixture: renamed-copy.fixture.ts (salinan struktural dengan variabel diganti nama)
export function computeOrderRebate(qty: number, unitCost: number, rebateRate: number): number {
  const grossVal = qty * unitCost;
  if (rebateRate > 0 && rebateRate <= 100) {
    const rebateVal = (grossVal * rebateRate) / 100;
    return grossVal - rebateVal;
  }
  return grossVal;
}
