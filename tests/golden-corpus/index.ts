import { GoldenScenario } from './types';
import { clinicalScenarios } from './scenarios/clinical';
import { acknowledgementScenarios } from './scenarios/acknowledgement';
import { bookingScenarios } from './scenarios/booking';
import { locationScenarios } from './scenarios/location';
import { pricingScenarios } from './scenarios/pricing';

export const allGoldenScenarios: GoldenScenario[] = [
  ...clinicalScenarios,
  ...acknowledgementScenarios,
  ...bookingScenarios,
  ...locationScenarios,
  ...pricingScenarios,
];

export function validateGoldenCorpus(): { total: number; categories: Record<string, number>; ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const categories: Record<string, number> = {};
  const seen = new Set<string>();
  for (const s of allGoldenScenarios) {
    categories[s.category] = (categories[s.category] || 0) + 1;
    if (seen.has(s.id)) errors.push(`Duplicate ID: ${s.id}`);
    seen.add(s.id);
    if (!s.turns.length) errors.push(`Empty turns: ${s.id}`);
    s.turns.forEach((t, idx) => {
      if (t.turn !== idx + 1) errors.push(`Turn mismatch ${s.id} turn ${t.turn} expected ${idx + 1}`);
      if (!t.input.trim()) errors.push(`Empty input ${s.id} turn ${t.turn}`);
    });
  }
  if (allGoldenScenarios.length !== 50) errors.push(`Expected 50 scenarios, got ${allGoldenScenarios.length}`);
  return { total: allGoldenScenarios.length, categories, ok: errors.length === 0, errors };
}
