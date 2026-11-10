import { describe, it, expect } from 'vitest';
import { staffNotificationFormatterService } from '../../src/services/staff-notification-formatter.service';
import { staffNotificationService } from '../../src/services/staff-notification.service';

describe('Staff Notification Modular Split (FN-03)', () => {
  describe('staffNotificationFormatterService', () => {
    it('should export singleton instance and formatting helpers', () => {
      expect(staffNotificationFormatterService).toBeDefined();
      expect(typeof staffNotificationFormatterService.escapeMarkdown).toBe('function');
      expect(typeof staffNotificationFormatterService.formatAssignmentTelegramMessage).toBe('function');
      expect(typeof staffNotificationFormatterService.formatPreVisitBriefMessage).toBe('function');
      expect(typeof staffNotificationFormatterService.formatCancellationTelegramMessage).toBe('function');
      expect(typeof staffNotificationFormatterService.formatUnassignedTelegramMessage).toBe('function');
      expect(typeof staffNotificationFormatterService.formatDailyBriefingMessage).toBe('function');
    });

    it('escapeMarkdown escapes special characters correctly', () => {
      const escaped = staffNotificationFormatterService.escapeMarkdown('Halo *Bunda* _si kecil_ [test] (123)');
      expect(escaped).not.toContain('*');
      expect(escaped).not.toContain('_');
      expect(escaped).not.toContain('[');
      expect(escaped).not.toContain(']');
    });
  });

  describe('staffNotificationService facade', () => {
    it('should retain public dispatch and pairing methods', () => {
      expect(staffNotificationService).toBeDefined();
      expect(typeof staffNotificationService.getStaffPairingInfo).toBe('function');
      expect(typeof staffNotificationService.regenerateStaffPairingToken).toBe('function');
      expect(typeof staffNotificationService.sendReservationAssignmentNotification).toBe('function');
      expect(typeof staffNotificationService.sendPreVisitBrief).toBe('function');
      expect(typeof staffNotificationService.sweepPreVisitBriefs).toBe('function');
      expect(typeof staffNotificationService.sendReservationCancelledNotification).toBe('function');
      expect(typeof staffNotificationService.sendTaskUnassignedNotification).toBe('function');
      expect(typeof staffNotificationService.sendStaffDailyBriefing).toBe('function');
      expect(typeof staffNotificationService.sendAllStaffMorningBriefings).toBe('function');
    });
  });
});
