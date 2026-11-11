import { describe, it, expect } from 'vitest';
import { WahaGatewayDriver } from '../../../src/integrations/whatsapp/waha.driver';

/** W-011: WAHA tidak boleh mengirim teks palsu `Template[...]` ke customer. */
describe('WAHA sendTemplateMessage (W-011)', () => {
  it('mengembalikan kegagalan eksplisit, bukan teks literal palsu', async () => {
    const driver = new WahaGatewayDriver({} as any, 'tenant-w011');
    const res = await driver.sendTemplateMessage('628111', 'tpl', 'id', [
      { type: 'body', parameters: [{ type: 'text', value: 'halo' }] },
    ] as any);
    expect(res.success).toBe(false);
    expect((res.error as any)?.code).toBe('WAHA_TEMPLATE_UNSUPPORTED');
  });
});
