import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { FollowUpTemplateType } from '../../config/followup-templates';

import * as constants from './constants';
import * as templates from './follow-up-templates.service';
import * as query from './follow-up-query.service';
import * as creation from './follow-up-creation.service';
import * as executor from './follow-up-executor.service';
import * as scheduler from './follow-up-scheduler.service';
import * as maintenance from './follow-up-maintenance.service';

export * from './constants';
export * from './follow-up-templates.service';
export * from './follow-up-query.service';
export * from './follow-up-creation.service';
export * from './follow-up-executor.service';
export * from './follow-up-scheduler.service';
export * from './follow-up-maintenance.service';

export class FollowUpService {
  // Template management
  public async getAllTemplates(tenantId: string = DEFAULT_TENANT_ID) {
    return templates.getAllTemplates(tenantId);
  }

  public async saveTemplate(
    type: string,
    variant: number,
    text: string,
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<void> {
    return templates.saveTemplate(type, variant, text, tenantId);
  }

  public async resetTemplate(
    type: string,
    variant: number,
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<void> {
    return templates.resetTemplate(type, variant, tenantId);
  }

  // Query
  public async listFollowUps(
    tenantId: string = DEFAULT_TENANT_ID,
    options: {
      status?: string;
      type?: string;
      search?: string;
      dateFilter?: string;
      page?: number;
      pageSize?: number;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
    } = {}
  ) {
    return query.listFollowUps(tenantId, options);
  }

  // Lifecycle & Creation
  public computeScheduleAtWib0940(anchor: Date, dayOffset: number, seed: string = ''): Date {
    return creation.computeScheduleAtWib0940(anchor, dayOffset, seed);
  }

  public computeNextTreatmentAtWib0900(bookingDate: Date, monthOffset: number): Date {
    return creation.computeNextTreatmentAtWib0900(bookingDate, monthOffset);
  }

  public async createNoPurchaseFollowUps(
    customerId: string,
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<void> {
    return creation.createNoPurchaseFollowUps(customerId, tenantId);
  }

  public async rescheduleNoPurchaseOnInboundChat(
    customerId: string,
    tenantId: string = DEFAULT_TENANT_ID,
    chatAt: Date = new Date()
  ) {
    return creation.rescheduleNoPurchaseOnInboundChat(customerId, tenantId, chatAt);
  }

  public async onReservationCreated(
    customerId: string,
    reservationId: string,
    tenantId: string = DEFAULT_TENANT_ID
  ) {
    return creation.onReservationCreated(customerId, reservationId, tenantId);
  }

  public async createReservationFollowUps(params: {
    reservationId: string;
    customerId: string;
    bookingDate: Date;
    treatmentCategory?: string | null;
    tenantId?: string;
  }) {
    return creation.createReservationFollowUps(params);
  }

  public async onReservationCancelled(
    reservationId: string,
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<void> {
    return creation.onReservationCancelled(reservationId, tenantId);
  }

  public async onReservationRescheduled(
    reservationId: string,
    newBookingDate: Date,
    tenantId: string = DEFAULT_TENANT_ID
  ) {
    return creation.onReservationRescheduled(reservationId, newBookingDate, tenantId);
  }

  public async createNextTreatmentFollowUps(
    customerId: string,
    bookingDate: Date,
    tenantId: string = DEFAULT_TENANT_ID,
    reservationId?: string,
    treatmentCategory?: string | null
  ): Promise<void> {
    return creation.createNextTreatmentFollowUps(
      customerId,
      bookingDate,
      tenantId,
      reservationId,
      treatmentCategory
    );
  }

  public async reconcileOrphanedCompletedFollowUps(
    tenantId: string = DEFAULT_TENANT_ID
  ) {
    return creation.reconcileOrphanedCompletedFollowUps(
      tenantId,
      this.createNextTreatmentFollowUps.bind(this)
    );
  }

  // Execution
  public async resolveMilestoneType(
    fu: any,
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<FollowUpTemplateType | null> {
    return executor.resolveMilestoneType(fu, tenantId);
  }

  public async executeFollowUp(
    fu: any,
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<boolean> {
    return executor.executeFollowUp(fu, tenantId);
  }

  public async executeFollowUpWaba(
    fu: any,
    templateType: FollowUpTemplateType,
    name: string,
    tenantId: string,
    timeStr?: string,
    babyName?: string
  ): Promise<boolean> {
    return executor.executeFollowUpWaba(fu, templateType, name, tenantId, timeStr, babyName);
  }

  // Scheduling & Admin actions
  public async sendNow(id: string, tenantId: string = DEFAULT_TENANT_ID): Promise<boolean> {
    return scheduler.sendNow(id, tenantId, this.executeFollowUp.bind(this));
  }

  public async retryFollowUp(id: string, tenantId: string = DEFAULT_TENANT_ID): Promise<boolean> {
    return scheduler.retryFollowUp(id, tenantId);
  }

  public async queueFollowUp(id: string, tenantId: string = DEFAULT_TENANT_ID): Promise<boolean> {
    return scheduler.queueFollowUp(id, tenantId);
  }

  public async bulkQueueFollowUps(tenantId: string = DEFAULT_TENANT_ID): Promise<number> {
    return scheduler.bulkQueueFollowUps(tenantId);
  }

  public async cancelFollowUp(
    id: string,
    tenantId: string = DEFAULT_TENANT_ID,
    options: { reason?: string } = {}
  ): Promise<boolean> {
    return scheduler.cancelFollowUp(id, tenantId, options);
  }

  public async skipFollowUpsForBypassCustomer(
    customerId: string,
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<number> {
    return scheduler.skipFollowUpsForBypassCustomer(customerId, tenantId);
  }

  public async bulkCancelFollowUps(
    tenantId: string = DEFAULT_TENANT_ID,
    status: string = 'PENDING',
    options: { reason?: string } = {}
  ): Promise<number> {
    return scheduler.bulkCancelFollowUps(tenantId, status, options);
  }

  public async updateFollowUp(
    id: string,
    data: {
      scheduledAt?: Date;
      stage?: number;
      customText?: string | null;
    },
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<any> {
    return scheduler.updateFollowUp(id, data, tenantId);
  }

  public async rescheduleFollowUp(
    id: string,
    newDate: Date,
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<any> {
    return scheduler.rescheduleFollowUp(id, newDate, tenantId);
  }

  public async rescheduleOverdueFollowUps(
    tenantId: string = DEFAULT_TENANT_ID,
    options: {
      maxPerDay?: number;
      startDate?: Date;
    } = {}
  ) {
    return scheduler.rescheduleOverdueFollowUps(tenantId, options);
  }

  public async countDailySent(tenantId: string, now: Date): Promise<number> {
    return scheduler.countDailySent(tenantId, now);
  }

  public async processDueFollowUps(tenantId: string = DEFAULT_TENANT_ID): Promise<number> {
    return scheduler.processDueFollowUps(tenantId, this.executeFollowUp.bind(this));
  }

  // Maintenance & Dormant
  public async buildWinbackScheduleSlots(tenantId: string, count: number, now: Date): Promise<Date[]> {
    return maintenance.buildWinbackScheduleSlots(tenantId, count, now);
  }

  public async enqueueDormantWinbackFollowUps(tenantId: string = DEFAULT_TENANT_ID): Promise<number> {
    return maintenance.enqueueDormantWinbackFollowUps(tenantId);
  }

  public async checkAndSetLostCustomers(tenantId: string = DEFAULT_TENANT_ID): Promise<void> {
    return maintenance.checkAndSetLostCustomers(tenantId);
  }
}

export const followUpService = new FollowUpService();
export default followUpService;
