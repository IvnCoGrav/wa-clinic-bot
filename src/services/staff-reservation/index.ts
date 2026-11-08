export * from './types';
export * from './task-builder';
export * from './staff-tasks.service';
export * from './staff-trip-messages.service';
export * from './staff-payment.service';
export * from './staff-ops.service';

import {
  PRIVACY_NEAR_CLINIC_KM,
  getWibDateRange,
  getTodayTasks,
  getUpcomingSchedule,
  getCompletedTasks,
} from './staff-tasks.service';
import {
  resolveClinicName,
  renderStaffTripMessage,
  appendEtaBlock,
  resolveDepartureShare,
  getOtwMessageText,
  getArrivalMessageText,
  getTripStatusMessageText,
  getTripDelayMessageText,
} from './staff-trip-messages.service';
import {
  getPaymentInfo,
  recordPayment,
  sendPaymentInfo,
} from './staff-payment.service';
import {
  assertConversationOwnedByStaffToday,
  reassignTask,
  updateCustomerLocation,
  recordArrival,
  completeTask,
} from './staff-ops.service';

/**
 * Facade class StaffReservationService untuk kompatibilitas penuh 100%
 * dengan seluruh pemanggil lama (static methods).
 */
export class StaffReservationService {
  static readonly PRIVACY_NEAR_CLINIC_KM = PRIVACY_NEAR_CLINIC_KM;
  static getWibDateRange = getWibDateRange;
  static getTodayTasks = getTodayTasks;
  static getUpcomingSchedule = getUpcomingSchedule;
  static getCompletedTasks = getCompletedTasks;

  static resolveClinicName = resolveClinicName;
  static renderStaffTripMessage = renderStaffTripMessage;
  static appendEtaBlock = appendEtaBlock;
  static resolveDepartureShare = resolveDepartureShare;

  static getOtwMessageText = getOtwMessageText;
  static getArrivalMessageText = getArrivalMessageText;
  static getTripStatusMessageText = getTripStatusMessageText;
  static getTripDelayMessageText = getTripDelayMessageText;

  static getPaymentInfo = getPaymentInfo;
  static recordPayment = recordPayment;
  static sendPaymentInfo = sendPaymentInfo;

  static assertConversationOwnedByStaffToday = assertConversationOwnedByStaffToday;
  static reassignTask = reassignTask;
  static updateCustomerLocation = updateCustomerLocation;
  static recordArrival = recordArrival;
  static completeTask = completeTask;
}

export default StaffReservationService;
