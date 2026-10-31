import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { customerService } from '../../src/services/customer.service';
import { checkDailyInvariants, autoRepairLtvDrift } from '../../src/services/daily-invariant-monitor.service';
import { prisma } from '../../src/db/client';

describe('LTV Cache Integrity & Single-Writer Guard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Static Architecture Guard (Single-Writer Mandate)', () => {
    it('MANDATORY: ensures no file outside customer.service.ts writes directly to ltv_cache', () => {
      const srcDir = path.resolve(process.cwd(), 'src');
      const allTsFiles: string[] = [];

      function walkDir(dir: string) {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const fullPath = path.join(dir, file);
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            walkDir(fullPath);
          } else if (file.endsWith('.ts') && !file.endsWith('.d.ts')) {
            allTsFiles.push(fullPath);
          }
        }
      }

      walkDir(srcDir);

      const illegalWriters: Array<{ file: string; line: number; snippet: string }> = [];

      // Regex mencari pola penulisan data: { ... ltv_cache: ... }
      const ltvWriteRegex = /ltv_cache\s*:\s*[^?]/;

      for (const filePath of allTsFiles) {
        const relativePath = path.relative(process.cwd(), filePath).replace(/\\/g, '/');
        // Pengecualian resmi tunggal: customer.service.ts
        if (relativePath === 'src/services/customer.service.ts') continue;

        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Abaikan komentar, tipe interface / types, atau select/orderBy/filter query
          if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
          if (line.includes('interface ') || line.includes('type ')) continue;
          if (line.includes('orderBy') || line.includes('select:') || line.includes('select :')) continue;
          if (line.includes('where:') || line.includes('where :')) continue;
          if (line.includes('ltv_cache?:') || line.includes('ltv_cache: number') || line.includes('ltv_cache: IntFilter')) continue;
          if (line.includes('Number(customer.ltv_cache') || line.includes('c.ltv_cache')) continue;

          // Periksa apakah ada pola penulisan ke DB
          if (ltvWriteRegex.test(line) && (line.includes('data:') || lines[Math.max(0, i - 1)].includes('data:'))) {
            illegalWriters.push({
              file: relativePath,
              line: i + 1,
              snippet: line.trim(),
            });
          }
        }
      }

      expect(illegalWriters).toEqual([]);
    });
  });

  describe('2. Recalculation Accuracy & Status Filtering', () => {
    it('accurately calculates LTV excluding cancelled, rejected, and unpriced holds', async () => {
      const mockReservations = [
        { id: 'r1', status: 'completed', purchase_value: 120000, treatment_detail: 'Pijat Bayi', raw_text: null },
        { id: 'r2', status: 'confirmed', purchase_value: 80000, treatment_detail: 'Baby Bath', raw_text: null },
        { id: 'r3', status: 'cancelled', purchase_value: 150000, treatment_detail: 'Batal', raw_text: null },
        { id: 'r4', status: 'rejected', purchase_value: 200000, treatment_detail: 'Tolak', raw_text: null },
        { id: 'r5', status: 'hold', purchase_value: null, treatment_detail: '[HOLD] Slot Ditawarkan (BABY)', raw_text: null },
      ];

      vi.spyOn(prisma.reservation, 'findMany').mockImplementation(async (args: any) => {
        const notIn = args?.where?.status?.notIn || [];
        return mockReservations.filter((r) => !notIn.includes(r.status)) as any;
      });
      const updateSpy = vi.spyOn(prisma.customer, 'update').mockResolvedValue({ id: 'c1', ltv_cache: 200000 } as any);

      const calculatedLtv = await customerService.recalculateCustomerLtv('c1', 'default-tenant');

      // 120.000 + 80.000 = 200.000 (cancelled, rejected disaring oleh query; unpriced hold diabaikan nilainya)
      expect(calculatedLtv).toBe(200000);
      expect(prisma.reservation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            customer_id: 'c1',
            status: { notIn: ['cancelled', 'rejected'] },
          }),
        })
      );
      expect(updateSpy).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { ltv_cache: 200000 },
      });
    });

    it('resolves unpriced completed treatments via resolveTreatmentValue', async () => {
      const mockReservations = [
        { id: 'r1', status: 'completed', purchase_value: null, treatment_detail: 'Baby Massage Tradisional', raw_text: null },
      ];

      vi.spyOn(prisma.reservation, 'findMany').mockResolvedValue(mockReservations as any);
      const updateSpy = vi.spyOn(prisma.customer, 'update').mockResolvedValue({ id: 'c2', ltv_cache: 150000 } as any);

      const calculatedLtv = await customerService.recalculateCustomerLtv('c2', 'default-tenant');
      expect(calculatedLtv).toBe(150000);
      expect(updateSpy).toHaveBeenCalledWith({
        where: { id: 'c2' },
        data: { ltv_cache: 150000 },
      });
    });
  });

  describe('3. Daily Invariant & Auto-Repair', () => {
    it('detects LTV drift and auto-repairs customer ltv_cache', async () => {
      const driftedRows = [
        { id: 'c-drift-1', ltv_cache: 0, sum_val: 140000 },
      ];

      vi.spyOn(prisma, '$queryRawUnsafe').mockImplementation(async (sql: any) => {
        if (typeof sql === 'string' && sql.includes('SELECT count(*)::int AS cnt FROM (')) {
          return [{ cnt: BigInt(1) }] as any;
        }
        if (typeof sql === 'string' && sql.includes('SELECT c.id, c.ltv_cache, COALESCE(SUM(r.purchase_value), 0)::int AS sum_val')) {
          return driftedRows as any;
        }
        return [{ cnt: BigInt(0) }] as any;
      });

      vi.spyOn(prisma.reservation, 'count').mockResolvedValue(0);
      vi.spyOn(prisma.reservationArchive, 'count').mockResolvedValue(0);
      vi.spyOn(customerService, 'recalculateCustomerLtv').mockResolvedValue(140000);
      const auditSpy = vi.spyOn(prisma.auditLog, 'create').mockResolvedValue({ id: 'aud-1' } as any);

      const report = await checkDailyInvariants('default-tenant');
      const ltvViolation = report.violations.find((v) => v.key === 'LTV_CACHE_DRIFT');
      expect(ltvViolation).toBeDefined();
      expect(ltvViolation?.count).toBe(1);

      const repairedCount = await autoRepairLtvDrift('default-tenant');
      expect(repairedCount).toBe(1);
      expect(customerService.recalculateCustomerLtv).toHaveBeenCalledWith('c-drift-1', 'default-tenant');
      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'AUTO_REPAIR_LTV_DRIFT',
            target_id: 'c-drift-1',
          }),
        })
      );
    });
  });
});
