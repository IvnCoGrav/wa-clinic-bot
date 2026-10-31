import { describe, it, expect } from 'vitest';
import { checkDestructiveSafety, assertSafeDestructiveRun } from '../../scripts/lib/destructive-guard';

describe('Destructive Guard Unit Tests', () => {
  it('1. should throw error when NODE_ENV is production', () => {
    expect(() =>
      checkDestructiveSafety({
        nodeEnv: 'production',
        dbUrl: 'postgresql://postgres:pass@localhost:5432/test',
        argv: ['node', 'script.ts', '--confirm'],
      })
    ).toThrowError(/Execution blocked in production environment/);
  });

  it('2. should throw error when DATABASE_URL is non-local without --force-nonlocal', () => {
    expect(() =>
      checkDestructiveSafety({
        nodeEnv: 'development',
        dbUrl: 'postgresql://postgres:pass@db.internal.remote.com:5432/production_data',
        argv: ['node', 'script.ts', '--confirm'],
      })
    ).toThrowError(/Execution blocked on non-local host/);
  });

  it('3. should allow non-local host when --force-nonlocal is supplied and not production', () => {
    const res = checkDestructiveSafety({
      nodeEnv: 'staging',
      dbUrl: 'postgresql://postgres:pass@db.internal.remote.com:5432/staging_data',
      argv: ['node', 'script.ts', '--confirm', '--force-nonlocal'],
    });

    expect(res.host).toBe('db.internal.remote.com');
    expect(res.isConfirmed).toBe(true);
    expect(res.isDryRun).toBe(false);
  });

  it('4. should default to dry-run when --confirm is missing', () => {
    const res = checkDestructiveSafety({
      nodeEnv: 'development',
      dbUrl: 'postgresql://postgres:pass@localhost:5432/test',
      argv: ['node', 'script.ts'],
    });

    expect(res.isDryRun).toBe(true);
    expect(res.isConfirmed).toBe(false);
  });

  it('5. should enable write execution when --confirm is present on local host', () => {
    const res = checkDestructiveSafety({
      nodeEnv: 'development',
      dbUrl: 'postgresql://postgres:pass@127.0.0.1:5432/test',
      argv: ['node', 'script.ts', '--confirm'],
    });

    expect(res.isDryRun).toBe(false);
    expect(res.isConfirmed).toBe(true);
  });

  it('6. should remain dry-run if --dry-run is explicitly passed even with --confirm', () => {
    const res = checkDestructiveSafety({
      nodeEnv: 'development',
      dbUrl: 'postgresql://postgres:pass@localhost:5432/test',
      argv: ['node', 'script.ts', '--confirm', '--dry-run'],
    });

    expect(res.isDryRun).toBe(true);
  });

  it('7. assertSafeDestructiveRun should execute cleanly on local dry-run', () => {
    const res = assertSafeDestructiveRun('TestScript', {
      nodeEnv: 'development',
      dbUrl: 'postgresql://postgres:pass@localhost:5432/test',
      argv: ['node', 'script.ts'],
    });

    expect(res.isDryRun).toBe(true);
  });
});
