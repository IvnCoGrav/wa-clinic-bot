import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { mediaService } from '../../src/services/media.service';
import { prisma } from '../../src/db/client';

const TENANT = 'test-orphan-tenant';

describe('sweepOrphanMedia — sapu file yatim tanpa merusak pratinjau', () => {
  const rootDir = path.join(process.cwd(), 'storage', 'media');
  const inboundDir = path.join(rootDir, 'inbound', TENANT);

  beforeEach(() => {
    fs.rmSync(path.join(rootDir, 'inbound', TENANT), { recursive: true, force: true });
    fs.rmSync(path.join(rootDir, 'outbound', TENANT), { recursive: true, force: true });
    fs.mkdirSync(inboundDir, { recursive: true });

    vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue(null as any);
    vi.spyOn(prisma, '$queryRaw').mockImplementation((async (strings: any) => {
      const sql = Array.isArray(strings) ? strings.join('?') : String(strings);
      if (sql.includes("payload_raw->>'unset'")) return [{ n: BigInt(0) }];
      if (sql.includes('FROM customers')) return [];
      if (sql.includes('FROM messages')) return [{ u: `/media/inbound/${TENANT}/hd.jpg` }];
      return [];
    }) as any);
  });

  afterEach(() => {
    fs.rmSync(path.join(rootDir, 'inbound', TENANT), { recursive: true, force: true });
    fs.rmSync(path.join(rootDir, 'outbound', TENANT), { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('menghapus file yatim lama, mempertahankan HD yang dirujuk + thumbnail-nya, dan melewati file baru', async () => {
    const hd = path.join(inboundDir, 'hd.jpg');
    const hdThumb = path.join(inboundDir, 'hd_thumb.jpg');
    const orphan = path.join(inboundDir, 'orphan_thumb.jpg');
    const freshOrphan = path.join(inboundDir, 'fresh_orphan.jpg');

    fs.writeFileSync(hd, Buffer.alloc(1000));
    fs.writeFileSync(hdThumb, Buffer.alloc(500));
    fs.writeFileSync(orphan, Buffer.alloc(500));
    fs.writeFileSync(freshOrphan, Buffer.alloc(500));

    const old = new Date(Date.now() - 5 * 3600 * 1000);
    fs.utimesSync(hd, old, old);
    fs.utimesSync(hdThumb, old, old);
    fs.utimesSync(orphan, old, old);

    const res = await mediaService.sweepOrphanMedia(TENANT, { dryRun: false, minAgeHours: 1 });

    expect(res.aborted).toBeUndefined();
    expect(res.deleted).toBe(1);
    expect(fs.existsSync(hd)).toBe(true);
    expect(fs.existsSync(hdThumb)).toBe(true); // thumb dari HD yang dirujuk
    expect(fs.existsSync(orphan)).toBe(false);
    expect(fs.existsSync(freshOrphan)).toBe(true); // belum lewat minAgeHours
  });

  it('menolak berjalan saat masih ada payload rusak (anti hapus thumbnail yang bisa dipulihkan)', async () => {
    (prisma.$queryRaw as any).mockImplementation((async (strings: any) => {
      const sql = Array.isArray(strings) ? strings.join('?') : String(strings);
      if (sql.includes("payload_raw->>'unset'")) return [{ n: BigInt(7) }];
      return [];
    }) as any);

    const orphan = path.join(inboundDir, 'orphan_thumb.jpg');
    fs.writeFileSync(orphan, Buffer.alloc(500));
    const old = new Date(Date.now() - 5 * 3600 * 1000);
    fs.utimesSync(orphan, old, old);

    const res = await mediaService.sweepOrphanMedia(TENANT, { dryRun: false, minAgeHours: 1 });

    expect(res.aborted).toBe(true);
    expect(res.deleted).toBe(0);
    expect(fs.existsSync(orphan)).toBe(true);
  });

  it('dry-run tidak menghapus apa pun', async () => {
    const orphan = path.join(inboundDir, 'orphan_thumb.jpg');
    fs.writeFileSync(orphan, Buffer.alloc(500));
    const old = new Date(Date.now() - 5 * 3600 * 1000);
    fs.utimesSync(orphan, old, old);

    const res = await mediaService.sweepOrphanMedia(TENANT, { dryRun: true, minAgeHours: 1 });

    expect(res.orphans).toBe(1);
    expect(res.deleted).toBe(0);
    expect(fs.existsSync(orphan)).toBe(true);
  });
});
