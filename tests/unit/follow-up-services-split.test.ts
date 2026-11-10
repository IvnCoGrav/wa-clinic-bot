import { describe, it, expect, vi, beforeEach } from 'vitest';
import { followUpService } from '../../src/services/follow-up.service';
import { followUpTemplateService } from '../../src/services/follow-up-template.service';
import { followUpLifecycleService } from '../../src/services/follow-up-lifecycle.service';
import { followUpEngineService } from '../../src/services/follow-up-engine.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

describe('Follow-Up Modular Services Split (FN-01)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('followUpTemplateService', () => {
    it('should export singleton instance and key template methods', () => {
      expect(followUpTemplateService).toBeDefined();
      expect(typeof followUpTemplateService.getAllTemplates).toBe('function');
      expect(typeof followUpTemplateService.saveTemplate).toBe('function');
      expect(typeof followUpTemplateService.resetTemplate).toBe('function');
    });

    it('getAllTemplates returns rolling template list', async () => {
      const templates = await followUpTemplateService.getAllTemplates(DEFAULT_TENANT_ID);
      expect(Array.isArray(templates)).toBe(true);
      expect(templates.length).toBeGreaterThan(0);
      expect(templates[0]).toHaveProperty('type');
      expect(templates[0]).toHaveProperty('variant');
    });
  });

  describe('followUpLifecycleService', () => {
    it('should export singleton instance and key lifecycle triggers', () => {
      expect(followUpLifecycleService).toBeDefined();
      expect(typeof followUpLifecycleService.createNoPurchaseFollowUps).toBe('function');
      expect(typeof followUpLifecycleService.rescheduleNoPurchaseOnInboundChat).toBe('function');
      expect(typeof followUpLifecycleService.onReservationCreated).toBe('function');
      expect(typeof followUpLifecycleService.createReservationFollowUps).toBe('function');
      expect(typeof followUpLifecycleService.onReservationCancelled).toBe('function');
      expect(typeof followUpLifecycleService.onReservationRescheduled).toBe('function');
      expect(typeof followUpLifecycleService.createNextTreatmentFollowUps).toBe('function');
      expect(typeof followUpLifecycleService.enqueueDormantWinbackFollowUps).toBe('function');
      expect(typeof followUpLifecycleService.checkAndSetLostCustomers).toBe('function');
    });
  });

  describe('followUpEngineService', () => {
    it('should export singleton instance and key execution methods', () => {
      expect(followUpEngineService).toBeDefined();
      expect(typeof followUpEngineService.executeFollowUp).toBe('function');
      expect(typeof followUpEngineService.sendNow).toBe('function');
      expect(typeof followUpEngineService.retryFollowUp).toBe('function');
      expect(typeof followUpEngineService.queueFollowUp).toBe('function');
      expect(typeof followUpEngineService.bulkQueueFollowUps).toBe('function');
      expect(typeof followUpEngineService.processDueFollowUps).toBe('function');
      expect(typeof followUpEngineService.reconcileOrphanedCompletedFollowUps).toBe('function');
    });
  });

  describe('followUpService facade backward compatibility', () => {
    it('delegates template methods to followUpTemplateService', async () => {
      const spy = vi.spyOn(followUpTemplateService, 'getAllTemplates').mockResolvedValueOnce([
        { id: '1', type: 'NO_PURCHASE_1' as any, variant: 1, template: 'test', delay_hours: 24, is_active: true, target_audience: 'ALL' }
      ]);
      const res = await followUpService.getAllTemplates(DEFAULT_TENANT_ID);
      expect(spy).toHaveBeenCalledWith(DEFAULT_TENANT_ID);
      expect(res).toEqual([
        { id: '1', type: 'NO_PURCHASE_1', variant: 1, template: 'test', delay_hours: 24, is_active: true, target_audience: 'ALL' }
      ]);
    });

    it('delegates lifecycle methods to followUpLifecycleService', async () => {
      const spy = vi.spyOn(followUpLifecycleService, 'onReservationCreated').mockResolvedValueOnce();
      await followUpService.onReservationCreated('cust-1', 'res-1', DEFAULT_TENANT_ID);
      expect(spy).toHaveBeenCalledWith('cust-1', 'res-1', DEFAULT_TENANT_ID);
    });

    it('delegates engine methods to followUpEngineService', async () => {
      const spy = vi.spyOn(followUpEngineService, 'processDueFollowUps').mockResolvedValueOnce(5);
      const res = await followUpService.processDueFollowUps(DEFAULT_TENANT_ID);
      expect(spy).toHaveBeenCalledWith(DEFAULT_TENANT_ID, expect.any(Function));
      expect(res).toBe(5);
    });
  });
});
