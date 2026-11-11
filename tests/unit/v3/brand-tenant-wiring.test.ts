import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * A-009/C-010: jalur deterministik & Call 2 wajib memakai brand tenant async,
 * bukan brand default sinkron (tenant-blind).
 */
describe('Brand tenant wiring (A-009/C-010)', () => {
  const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8');

  it('generation-stage memakai brand tenant, bukan default sinkron', () => {
    const src = read('src/v3/agent/pipeline/generation-stage.ts');
    expect(src).toContain('getBrandIdentityAsync(turn.tenantId)');
    expect(src).not.toContain('const brand = getBrandIdentity();');
  });

  it('guardrail pipeline memakai brand tenant untuk fallback deterministik', () => {
    const src = read('src/v3/agent/pipeline/guardrail-pipeline.ts');
    expect(src).toContain('getBrandIdentityAsync(input.tenantId)');
    expect(src).not.toContain('const brand = getBrandIdentity();');
  });
});
