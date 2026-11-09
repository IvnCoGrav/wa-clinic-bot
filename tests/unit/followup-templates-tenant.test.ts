import { describe, it, expect } from 'vitest';
import {
  getRollingFollowUpMessage,
  getRollingFollowUpMessageAsync,
  FOLLOWUP_ROLLING_TEMPLATES,
} from '../../src/config/followup-templates';
import { getBrandIdentity } from '../../src/config/brand';

describe('CFG-04: Multi-tenant Brand in Follow-Up Templates', () => {
  it('should use custom businessName from params when provided', () => {
    const customBrand = 'Klinik Sahabat Ibu dan Anak';
    const result = getRollingFollowUpMessage('REMINDER_H0', {
      name: 'Rina',
      businessName: customBrand,
      index: 0,
    });
    expect(result.text).toContain(customBrand);
    expect(result.text).not.toContain(getBrandIdentity().businessName);
  });

  it('should render distinct brands for two different tenants', () => {
    const brandA = 'Klinik A Moms Care';
    const brandB = 'Klinik B Baby Care';

    const resA = getRollingFollowUpMessage('NO_PURCHASE_1', {
      name: 'Dewi',
      businessName: brandA,
      index: 0,
    });

    const resB = getRollingFollowUpMessage('NO_PURCHASE_1', {
      name: 'Dewi',
      businessName: brandB,
      index: 0,
    });

    expect(resA.text).toContain(brandA);
    expect(resA.text).not.toContain(brandB);

    expect(resB.text).toContain(brandB);
    expect(resB.text).not.toContain(brandA);
  });

  it('should support getRollingFollowUpMessageAsync with tenant brand', async () => {
    const res = await getRollingFollowUpMessageAsync(
      'REMINDER_H1',
      { name: 'Siti', businessName: 'Griya Bidan Ayu', index: 0 },
      'tenant-custom'
    );
    expect(res.text).toContain('Griya Bidan Ayu');
  });
});
