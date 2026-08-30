import { describe, it, expect } from 'vitest';
import {
  stripBufferMetadata,
  cleanTreatmentName,
  isAddonServiceName,
  parseTreatmentItemsFromRaw,
} from '../../packages/admin-dashboard/src/utils/treatmentStringParser';
import {
  calculateOngkirFromTiers,
  DeliveryTierItem,
} from '../../packages/admin-dashboard/src/utils/deliveryTierCalculator';

describe('treatmentStringParser & deliveryTierCalculator Unit Tests', () => {
  describe('treatmentStringParser', () => {
    it('should strip [Total 55m + Buffer 20m = 75m] buffer metadata completely', () => {
      const raw = 'Pijat Bayi Ceria (Rileksasi) [40m] + Sinar Moksa (Add-on) [15m Addon] [Total 55m + Buffer 20m = 75m]';
      const stripped = stripBufferMetadata(raw);
      expect(stripped).toBe('Pijat Bayi Ceria (Rileksasi) [40m] + Sinar Moksa (Add-on) [15m Addon]');
    });

    it('should clean single treatment name from duration tag', () => {
      const raw = 'Pijat Bayi Ceria (Rileksasi) [40m]';
      expect(cleanTreatmentName(raw)).toBe('Pijat Bayi Ceria (Rileksasi)');
    });

    it('should identify add-on service correctly', () => {
      expect(isAddonServiceName('Sinar Moksa (Add-on)')).toBe(true);
      expect(isAddonServiceName('Moxa Perut')).toBe(true);
      expect(isAddonServiceName('Pijat Bayi Ceria')).toBe(false);
    });

    it('should parse multi-treatment into clean items without creating dummy buffer items', () => {
      const raw = 'Pijat Bayi Ceria (Rileksasi) [40m] + Sinar Moksa (Add-on) [15m Addon] [Total 55m + Buffer 20m = 75m]';
      const catalog = [
        { id: 'srv-1', name: 'Pijat Bayi Ceria (Rileksasi)', promoPrice: 60000, durationMinutes: 40, category: 'BABY' },
        { id: 'srv-2', name: 'Sinar Moksa (Add-on)', promoPrice: 30000, durationMinutes: 15, category: 'ADD_ON' },
      ];

      const items = parseTreatmentItemsFromRaw(raw, catalog);
      expect(items.length).toBe(2);
      expect(items[0].name).toBe('Pijat Bayi Ceria (Rileksasi)');
      expect(items[0].price).toBe(60000);
      expect(items[0].durationMinutes).toBe(40);
      expect(items[0].isAddon).toBe(false);

      expect(items[1].name).toBe('Sinar Moksa (Add-on)');
      expect(items[1].price).toBe(30000);
      expect(items[1].durationMinutes).toBe(15);
      expect(items[1].isAddon).toBe(true);

      const subtotal = items.reduce((sum, item) => sum + item.price, 0);
      expect(subtotal).toBe(90000);
    });
  });

  describe('deliveryTierCalculator', () => {
    const sampleTiers: DeliveryTierItem[] = [
      { maxDist: 5, fee: 0, promoDiscount: 0 },
      { maxDist: 7, fee: 15000, promoDiscount: 10000 },
      { maxDist: 10, fee: 15000, promoDiscount: 5000 },
      { maxDist: 15, fee: 25000, promoDiscount: 10000 },
      { maxDist: 20, fee: 25000, promoDiscount: 5000 },
      { maxDist: 25, fee: 35000, promoDiscount: 10000 },
      { maxDist: 30, fee: 35000, promoDiscount: 5000 },
    ];

    it('should return 0 (Gratis) for distance <= 5 km', () => {
      const calc = calculateOngkirFromTiers(3.5, sampleTiers);
      expect(calc.netOngkir).toBe(0);
      expect(calc.fee).toBe(0);
    });

    it('should calculate 17.91 km as tier 15-20 km (Rp 20.000 net, NOT Rp 44.730)', () => {
      const calc = calculateOngkirFromTiers(17.91, sampleTiers);
      expect(calc.matchedTier?.maxDist).toBe(20);
      expect(calc.fee).toBe(25000);
      expect(calc.promoDiscount).toBe(5000);
      expect(calc.netOngkir).toBe(20000);
      expect(calc.isOutOfCoverage).toBe(false);
    });

    it('should flag distance beyond 30 km as out of coverage', () => {
      const calc = calculateOngkirFromTiers(35.0, sampleTiers);
      expect(calc.isOutOfCoverage).toBe(true);
    });
  });
});
