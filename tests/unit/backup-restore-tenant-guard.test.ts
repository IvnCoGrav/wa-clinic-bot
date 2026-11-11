import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { backupService } from '../../src/services/backup.service';

/** I-002: restore wajib menolak dump milik tenant lain / terkontaminasi. */
describe('Restore backup — validasi tenant (I-002)', () => {
  let dir: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-tenant-'));
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const writeDump = (name: string, payload: any) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, JSON.stringify(payload), 'utf8');
    return p;
  };

  it('menolak dump yang meta.tenantId-nya berbeda', async () => {
    const file = writeDump('dump-tenant-a.json', {
      meta: { schemaVersion: '2.0', tenantId: 'tenant-a' },
      tables: { customers: [] },
    });
    await expect(backupService.restoreDatabaseFromDump(file, 'tenant-b', { force: true })).rejects.toThrow(
      /tidak boleh direstore ke tenant/i
    );
  });

  it('menolak dump dengan baris tenant lain (kontaminasi)', async () => {
    const file = writeDump('dump-contaminated.json', {
      meta: { schemaVersion: '2.0', tenantId: 'tenant-a' },
      tables: {
        customers: [{ id: 'c1', tenant_id: 'tenant-a', name: 'A' }, { id: 'c2', tenant_id: 'tenant-b', name: 'B' }],
      },
    });
    await expect(backupService.restoreDatabaseFromDump(file, 'tenant-a', { force: true })).rejects.toThrow(
      /terkontaminasi/i
    );
  });
});
