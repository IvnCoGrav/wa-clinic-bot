import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

/**
 * MT-1.4 — Smoke test terhadap PostgreSQL NYATA.
 *
 * Tujuan: membuktikan harness `vitest.db.config.ts` benar-benar menjalankan
 * constraint/transaksi PostgreSQL (bukan fallback in-memory), sebagai fondasi
 * regression test untuk Stage 2+ (tenant identity, reservation concurrency).
 *
 * KEAMANAN:
 * - Hanya berjalan bila `TEST_DATABASE_URL` di-set.
 * - Menolak host produksi yang diketahui (43.157.197.148) → fail-fast.
 * - Semua data uji memakai tenant_id unik berprefix `__mt14_` lalu dibersihkan.
 */

const TEST_DB_URL = process.env.TEST_DATABASE_URL || '';
const PRODUCTION_HOSTS = ['43.157.197.148'];

const isProductionUrl = (url: string): boolean =>
  PRODUCTION_HOSTS.some((h) => url.includes(h));

const canRun = TEST_DB_URL.length > 0 && !isProductionUrl(TEST_DB_URL);

if (TEST_DB_URL && isProductionUrl(TEST_DB_URL)) {
  throw new Error(
    '[MT-1.4] TEST_DATABASE_URL menunjuk ke host PRODUKSI. Test DB dibatalkan demi keamanan.'
  );
}

const describeDb = canRun ? describe : describe.skip;

describeDb('MT-1.4 — Real PostgreSQL Harness', () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: TEST_DB_URL } },
  });
  const tenantId = `__mt14_${Date.now()}`;
  const createdCustomerIds: string[] = [];
  const createdConversationIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    try {
      if (createdConversationIds.length > 0) {
        await prisma.conversation.deleteMany({ where: { id: { in: createdConversationIds } } });
      }
      if (createdCustomerIds.length > 0) {
        await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
      }
    } catch {
      // best-effort cleanup
    }
    await prisma.$disconnect();
  });

  it('membuka transaksi & rollback tanpa menyisakan row', async () => {
    const phone = `${tenantId}_rollback`;
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.customer.create({ data: { tenant_id: tenantId, phone, name: 'TX Rollback' } });
        throw new Error('ROLLBACK_INTENTIONAL');
      })
    ).rejects.toThrow('ROLLBACK_INTENTIONAL');

    const found = await prisma.customer.findFirst({ where: { tenant_id: tenantId, phone } });
    expect(found).toBeNull();
  });

  it('menegakkan unique phone pada schema saat ini (global @unique)', async () => {
    const phone = `${tenantId}_unique_${Date.now()}`;
    const first = await prisma.customer.create({ data: { tenant_id: tenantId, phone, name: 'A' } });
    createdCustomerIds.push(first.id);

    await expect(
      prisma.customer.create({ data: { tenant_id: tenantId, phone, name: 'B' } })
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('menegakkan unique (tenant_id, wa_message_id) pada Message', async () => {
    const phone = `${tenantId}_msg_${Date.now()}`;
    const customer = await prisma.customer.create({ data: { tenant_id: tenantId, phone, name: 'Msg' } });
    createdCustomerIds.push(customer.id);
    const conv = await prisma.conversation.create({
      data: { tenant_id: tenantId, customer_id: customer.id },
    });
    createdConversationIds.push(conv.id);

    await prisma.message.create({
      data: {
        tenant_id: tenantId,
        conversation_id: conv.id,
        customer_phone: phone,
        message_text: 'hello',
        current_state: 'INITIAL',
        direction: 'INBOUND',
        wa_message_id: 'wamid_mt14_1',
      } as any,
    });

    await expect(
      prisma.message.create({
        data: {
          tenant_id: tenantId,
          conversation_id: conv.id,
          customer_phone: phone,
          message_text: 'hello again',
          current_state: 'INITIAL',
          direction: 'INBOUND',
          wa_message_id: 'wamid_mt14_1',
        } as any,
      })
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('concurrent insert customer dengan phone sama → tepat satu sukses', async () => {
    const phone = `${tenantId}_race_${Date.now()}`;
    const results = await Promise.allSettled([
      prisma.customer.create({ data: { tenant_id: tenantId, phone, name: 'R1' } }),
      prisma.customer.create({ data: { tenant_id: tenantId, phone, name: 'R2' } }),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    for (const r of fulfilled) {
      if (r.status === 'fulfilled') createdCustomerIds.push((r.value as any).id);
    }
    expect(fulfilled.length).toBe(1);
  });
});
