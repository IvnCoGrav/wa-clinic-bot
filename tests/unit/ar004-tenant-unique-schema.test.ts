import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Ar-004 (W7) — unique constraint per tenant untuk Staff.phone & AdClick.trackingCode.
 *
 * Migrasi SQL tidak bisa dijalankan di unit test (DB offline), jadi yang dikunci:
 * 1. Schema TIDAK lagi memakai unique global untuk dua kolom tersebut.
 * 2. Schema memakai unique komposit (tenant_id, kolom).
 * 3. File migrasi memuat DDL yang sama dengan hasil `prisma migrate diff`.
 * 4. LandingPage.slug SENGAJA masih global (deferral terdokumentasi) — supaya
 *    tidak ada yang "menyelesaikan" separuh tanpa routing per-host.
 */

const root = process.cwd();
const schema = fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8');
const migration = fs.readFileSync(
  path.join(
    root,
    'prisma/migrations/20261112130000_ar004_tenant_scoped_unique_staff_adclick/migration.sql'
  ),
  'utf8'
);

function modelBlock(name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  if (!match) throw new Error(`model ${name} tidak ditemukan`);
  return match[1];
}

describe('Ar-004 schema: unique per tenant', () => {
  it('Staff.phone tidak lagi @unique global, tetapi unik per tenant', () => {
    const staff = modelBlock('Staff');
    expect(staff).not.toMatch(/phone\s+String\s+@unique/);
    expect(staff).toContain('@@unique([tenant_id, phone])');
  });

  it('AdClick.trackingCode tidak lagi @unique global, tetapi unik per tenant', () => {
    const adClick = modelBlock('AdClick');
    expect(adClick).not.toMatch(/trackingCode\s+String\?\s+@unique/);
    expect(adClick).toContain('@@unique([tenant_id, trackingCode])');
  });

  it('migration.sql membuat index komposit dan menghapus index global', () => {
    expect(migration).toContain('DROP INDEX "staff_phone_key"');
    expect(migration).toContain('DROP INDEX "ad_clicks_trackingCode_key"');
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "staff_tenant_id_phone_key" ON "staff"("tenant_id", "phone")'
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "ad_clicks_tenant_id_trackingCode_key" ON "ad_clicks"("tenant_id", "trackingCode")'
    );
    expect(migration).not.toMatch(/CREATE UNIQUE INDEX "(staff_phone_key|ad_clicks_trackingCode_key)"/);
  });

  it('LandingPage.slug tetap global (deferral terdokumentasi, bukan terlupa)', () => {
    const landing = modelBlock('LandingPage');
    expect(landing).toMatch(/slug\s+String\s+@unique/);
    expect(landing).not.toContain('@@unique([tenant_id, slug])');
    expect(migration.toLowerCase()).not.toContain('landing_pages');
  });
});
