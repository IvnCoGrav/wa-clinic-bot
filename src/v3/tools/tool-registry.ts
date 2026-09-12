import { CALCULATE_DELIVERY_TOOL_SCHEMA, executeCalculateDelivery, CalculateDeliveryInput } from './calculate-delivery.tool';
import { GET_CATALOG_TOOL_SCHEMA, executeGetCatalog, GetCatalogInput, CatalogSessionContext } from './get-catalog.tool';
import { SAVE_RESERVATION_TOOL_SCHEMA, executeSaveReservation, SaveReservationInput } from './save-reservation.tool';
import { ESCALATE_HUMAN_TOOL_SCHEMA, executeEscalateHuman, EscalateHumanInput } from './escalate-human.tool';
import { GET_CLINIC_POLICY_FAQ_TOOL_SCHEMA, executeGetClinicFaq, GetClinicFaqInput } from './clinic-faq.tool';
import { SEARCH_KNOWLEDGE_FAQ_TOOL_SCHEMA, executeSearchKnowledgeFaq, SearchKnowledgeFaqInput } from './search-knowledge-faq.tool';

export const ALL_V3_TOOLS = [
  CALCULATE_DELIVERY_TOOL_SCHEMA,
  GET_CATALOG_TOOL_SCHEMA,
  SAVE_RESERVATION_TOOL_SCHEMA,
  ESCALATE_HUMAN_TOOL_SCHEMA,
  GET_CLINIC_POLICY_FAQ_TOOL_SCHEMA,
  SEARCH_KNOWLEDGE_FAQ_TOOL_SCHEMA,
];

export interface CartSnapshotItem {
  name: string;
  price: number;
  promoPrice?: number | null;
}

export interface ToolExecutionContext {
  tenantId: string;
  customerId: string;
  conversationId: string;
  phone: string;
  chatId: string;
  selectedTreatment?: string;
  /** Snapshot keranjang terbaru (diisi agent-runner pre-execution) untuk agregasi total. */
  cartSnapshot?: CartSnapshotItem[];
  /** Snapshot ongkir sesi (diisi agent-runner pre-execution) untuk template total katalog. */
  locationSnapshot?: CatalogSessionContext;
  /** Waktu kunjungan yang diminta/disepakati (anti pengulangan tanya hari). */
  preferredDateSnapshot?: string;
  /** Audit 694493: true bila customer sudah tanya harga/total (mode transaksional). */
  priceDiscussedSnapshot?: boolean;
  /** Teks pesan user terkini (anti-halusinasi hari save_reservation). */
  recentUserTexts?: string[];
}

export async function executeToolByName(name: string, args: any, ctx: ToolExecutionContext): Promise<any> {
  switch (name) {
    case 'calculate_delivery': {
      const input: CalculateDeliveryInput = {
        locationText: args.locationText,
        streetDetail: args.streetDetail,
        tenantId: ctx.tenantId,
        candidateTreatmentName: ctx.selectedTreatment,
        cartSnapshot: ctx.cartSnapshot,
        preferredDate: ctx.preferredDateSnapshot,
        priceDiscussed: ctx.priceDiscussedSnapshot,
      };
      return await executeCalculateDelivery(input);
    }

    case 'get_catalog_and_price': {
      const input: GetCatalogInput = {
        category: args.category,
        childAgeMonths: args.childAgeMonths,
        gestationalWeeks: args.gestationalWeeks,
        momStage: args.momStage,
        symptoms: args.symptoms,
        specificTreatmentName: args.specificTreatmentName,
        inquirePrice: args.inquirePrice,
        targetPrice: args.targetPrice,
        asksDuration: args.asksDuration,
      };
      return await executeGetCatalog(input, ctx.tenantId, {
        ...(ctx.locationSnapshot || {}),
        cartItems: Array.isArray(ctx.cartSnapshot)
          ? ctx.cartSnapshot.map((c) => ({ name: c.name, promoPrice: c.promoPrice ?? null, price: c.price ?? null }))
          : undefined,
      });
    }

    case 'save_reservation': {
      const input: SaveReservationInput = {
        customerId: ctx.customerId,
        chatId: ctx.chatId,
        dayMentionEvidence: ctx.recentUserTexts,
        customerName: args.customerName,
        treatmentName: args.treatmentName,
        additionalTreatments: args.additionalTreatments,
        bookingDate: args.bookingDate,
        bookingTime: args.bookingTime,
        childName: args.childName,
        childAgeMonths: args.childAgeMonths,
        children: args.children,
        gestationalWeeks: args.gestationalWeeks,
        momStage: args.momStage,
        momNotes: args.momNotes,
        notes: args.notes,
        address: args.address,
        conversationId: ctx.conversationId,
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
      return await executeGetClinicFaq(input, ctx.tenantId);
    }

    case 'search_knowledge_faq': {
      const input: SearchKnowledgeFaqInput = {
        query: args.query,
        limit: args.limit,
        tenantId: ctx.tenantId,
      };
      return await executeSearchKnowledgeFaq(input);
    }

    default:
      throw new Error(`Tool "${name}" tidak ditemukan di Tool Registry.`);
  }
}
