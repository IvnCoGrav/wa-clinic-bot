import { CALCULATE_DELIVERY_TOOL_SCHEMA, executeCalculateDelivery, CalculateDeliveryInput } from './calculate-delivery.tool';
import { GET_CATALOG_TOOL_SCHEMA, executeGetCatalog, GetCatalogInput } from './get-catalog.tool';
import { SAVE_RESERVATION_TOOL_SCHEMA, executeSaveReservation, SaveReservationInput } from './save-reservation.tool';
import { ESCALATE_HUMAN_TOOL_SCHEMA, executeEscalateHuman, EscalateHumanInput } from './escalate-human.tool';
import { GET_CLINIC_POLICY_FAQ_TOOL_SCHEMA, executeGetClinicFaq, GetClinicFaqInput } from './clinic-faq.tool';

export const ALL_V3_TOOLS = [
  CALCULATE_DELIVERY_TOOL_SCHEMA,
  GET_CATALOG_TOOL_SCHEMA,
  SAVE_RESERVATION_TOOL_SCHEMA,
  ESCALATE_HUMAN_TOOL_SCHEMA,
  GET_CLINIC_POLICY_FAQ_TOOL_SCHEMA,
];

export interface ToolExecutionContext {
  tenantId: string;
  customerId: string;
  conversationId: string;
  phone: string;
  chatId: string;
}

export async function executeToolByName(name: string, args: any, ctx: ToolExecutionContext): Promise<any> {
  switch (name) {
    case 'calculate_delivery': {
      const input: CalculateDeliveryInput = {
        locationText: args.locationText,
        streetDetail: args.streetDetail,
        tenantId: ctx.tenantId,
      };
      return await executeCalculateDelivery(input);
    }

    case 'get_catalog_and_price': {
      const input: GetCatalogInput = {
        category: args.category,
        childAgeMonths: args.childAgeMonths,
        symptoms: args.symptoms,
        specificTreatmentName: args.specificTreatmentName,
      };
      return await executeGetCatalog(input);
    }

    case 'save_reservation': {
      const input: SaveReservationInput = {
        customerId: ctx.customerId,
        chatId: ctx.chatId,
        customerName: args.customerName,
        treatmentName: args.treatmentName,
        bookingDate: args.bookingDate,
        bookingTime: args.bookingTime,
        childName: args.childName,
        childAgeMonths: args.childAgeMonths,
        notes: args.notes,
        tenantId: ctx.tenantId,
      };
      return await executeSaveReservation(input);
    }

    case 'escalate_to_human': {
      const input: EscalateHumanInput = {
        conversationId: ctx.conversationId,
        phone: ctx.phone,
        reason: args.reason,
        severity: args.severity,
        tenantId: ctx.tenantId,
      };
      return await executeEscalateHuman(input);
    }

    case 'get_clinic_policy_faq': {
      const input: GetClinicFaqInput = {
        topic: args.topic,
      };
      return await executeGetClinicFaq(input);
    }

    default:
      throw new Error(`Tool "${name}" tidak ditemukan di Tool Registry.`);
  }
}
