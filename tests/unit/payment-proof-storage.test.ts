import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { mediaService } from '../../src/services/media.service';

const TEST_TENANT_ID = 'proof-test-tenant';
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

/**
 * Bukti pembayaran adalah dokumen finansial:
 * - disimpan di folder terpisah `payment-proofs/`,
 * - tidak dihitung ke kuota media chat,
 * - tidak boleh dihapus prune/retensi.
 */
describe('MediaService — bukti pembayaran permanen', { timeout: 20000 }, () => {
  afterAll(() => {
    const dir = path.join(process.cwd(), 'storage', 'media', 'payment-proofs', TEST_TENANT_ID);
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it('menulis ke folder payment-proofs & URL privat', async () => {
    const saved = await mediaService.savePaymentProof({
      tenantId: TEST_TENANT_ID,
      buffer: Buffer.from(PNG_B64, 'base64'),
      mimeType: 'image/png',
    });

    expect(saved.hdPath).toMatch(/storage[\\/]media[\\/]payment-proofs[\\/]proof-test-tenant/);
    expect(saved.hdUrl).toMatch(/^\/media\/payment-proofs\/proof-test-tenant\/[a-f0-9]{32}\.png$/);
    expect(fs.existsSync(saved.hdPath)).toBe(true);
    expect(mediaService.filePathFromRelativeUrl(saved.hdUrl)).toBe(saved.hdPath);
    expect(mediaService.resolvePaymentProofFile(TEST_TENANT_ID, path.basename(saved.hdPath))).toBe(saved.hdPath);
  });

  it('tidak dihitung ke kuota media chat', async () => {
    await mediaService.savePaymentProof({
      tenantId: TEST_TENANT_ID,
      buffer: Buffer.from(PNG_B64, 'base64'),
      mimeType: 'image/png',
    });
    const usage = await mediaService.getTenantMediaUsageBytesAsync(TEST_TENANT_ID);
    expect(usage).toBe(0);
  });

  it('prune kuota chat tidak menghapus bukti pembayaran', async () => {
    const saved = await mediaService.savePaymentProof({
      tenantId: TEST_TENANT_ID,
      buffer: Buffer.from(PNG_B64, 'base64'),
      mimeType: 'image/png',
    });

    // Kuota 1 byte memaksa prune berjalan; folder payment-proofs di luar scope.
    await mediaService.pruneToLowWatermark(TEST_TENANT_ID, 1);
    expect(fs.existsSync(saved.hdPath)).toBe(true);
  });

  it('menolak nama file traversal / bukan UUID', () => {
    expect(mediaService.resolvePaymentProofFile(TEST_TENANT_ID, '../outbound/x.jpg')).toBeNull();
    expect(mediaService.resolvePaymentProofFile(TEST_TENANT_ID, 'bukan-uuid.jpg')).toBeNull();
  });
});
