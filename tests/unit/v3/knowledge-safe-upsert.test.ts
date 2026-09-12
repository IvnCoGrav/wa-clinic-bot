import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { knowledgeBaseService } from '../../../src/services/knowledge.service';
import { faqs } from '../../../src/cli/faq-corpus';
import { DEFAULT_TENANT_ID } from '../../../src/config/tenant';

/**
 * Plan 4 Phase 2 — Seeding RAG non-destruktif (Issue #46).
 * - `seed-faq.ts` DILARANG mengandung `deleteMany` (kurasi admin live wajib selamat).
 * - `upsertChunk` idempoten: judul sama 2x → 1 baris (update di tempat, id stabil).
 * - Korpus mencakup 48 artikel (34 seed + 14 kurasi live hasil safe-merge).
 */
describe('Knowledge Safe Upsert (Plan 4 Phase 2)', () => {
  it('seed-faq.ts tidak mengandung operasi destruktif deleteMany', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../../src/cli/seed-faq.ts'), 'utf-8');
    const codeOnly = src
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    expect(codeOnly).not.toContain('deleteMany(');
    expect(codeOnly).toContain('upsertChunk');
  });

  it('upsertChunk idempoten: judul sama 2x → update di tempat, bukan duplikat', async () => {
    const title = `Idempotency Probe ${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const first = await knowledgeBaseService.upsertChunk({
      tenantId: DEFAULT_TENANT_ID,
      title,
      content: 'Konten versi pertama',
      keywords: 'probe',
    });
    expect(first.created).toBe(true);

    const second = await knowledgeBaseService.upsertChunk({
      tenantId: DEFAULT_TENANT_ID,
      title: title.toUpperCase(), // kunci identitas case-insensitive
      content: 'Konten versi kedua (revisi admin)',
      keywords: 'probe',
    });
    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);
  });

  it('judul berbeda tetap membuat baris baru (upsert tidak menelan data)', async () => {
    const base = `Upsert New Row ${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const a = await knowledgeBaseService.upsertChunk({
      tenantId: DEFAULT_TENANT_ID,
      title: `${base} A`,
      content: 'Konten A',
    });
    const b = await knowledgeBaseService.upsertChunk({
      tenantId: DEFAULT_TENANT_ID,
      title: `${base} B`,
      content: 'Konten B',
    });
    expect(a.created).toBe(true);
    expect(b.created).toBe(true);
    expect(b.id).not.toBe(a.id);
  });

  it('korpus seed mencakup 48 artikel termasuk 14 kurasi live', () => {
    expect(faqs.length).toBe(48);
    const titles = faqs.map((f) => (f as any).question as string);
    // Sampel kurasi live hasil safe-merge (Issue #46)
    expect(titles).toContain('Minyak apa yang digunakan untuk memijat bayi? Apakah aman untuk kulit sensitif?');
    expect(titles).toContain('Mending mana pijat sebelum atau sesudah imunisasi ?');
    // Sampel seed lokal yang wajib lestari (SOP kritis)
    expect(titles).toContain('Apakah bayi yang baru jatuh atau terbentur boleh langsung dipijat?');
    // Tanpa duplikat judul (kunci upsert)
    const norm = titles.map((t) => t.trim().toLowerCase().replace(/\s+/g, ' '));
    expect(new Set(norm).size).toBe(titles.length);
  });
});
