import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * A-008: setiap fallback deterministik yang disuntikkan SETELAH sanitizer awal
 * wajib melewati sanitizer final sebelum dikirim. Guard ini mencegah regresi
 * urutan pipeline (kuota "Bunda" / batas 3 kalimat bocor).
 */
describe('Guardrail final sanitize (A-008)', () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), 'src/v3/agent/pipeline/guardrail-pipeline.ts'),
    'utf8'
  );

  it('sanitizer final berada setelah guard terminal dan sebelum return output', () => {
    const terminal = src.indexOf('TERMINAL_SILENT_DROP_GUARD');
    const finalSanitize = src.indexOf('A-008: gerbang akhir deterministik');
    const returnOutput = src.indexOf('finalReply,', finalSanitize);
    expect(terminal).toBeGreaterThan(-1);
    expect(finalSanitize).toBeGreaterThan(terminal);
    expect(returnOutput).toBeGreaterThan(finalSanitize);
  });

  it('sanitizer final memakai cleanOutboundReply', () => {
    const block = src.slice(src.indexOf('A-008: gerbang akhir deterministik'));
    expect(block.slice(0, 600)).toContain('OutputSanitizer.cleanOutboundReply');
  });
});
