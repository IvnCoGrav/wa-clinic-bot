import { z } from 'zod';

export const CalculateDeliveryArgsSchema = z.object({
  locationText: z.string().min(1, 'locationText tidak boleh kosong'),
  streetDetail: z.string().optional(),
});

export const GetCatalogArgsSchema = z.object({
  category: z.enum(['BABY', 'KIDS', 'MOMS', 'BOTH']).optional(),
  childAgeMonths: z.number().nonnegative().optional(),
  symptoms: z.array(z.string()).optional().default([]),
  specificTreatmentName: z.string().optional(),
  inquirePrice: z.boolean().optional().default(false),
});

export const SaveReservationArgsSchema = z.object({
  customerName: z.string().optional(),
  treatmentName: z.string().min(2, 'treatmentName wajib diisi'),
  additionalTreatments: z.array(z.string()).optional(),
  bookingDate: z.string().min(1, 'bookingDate wajib diisi'),
  bookingTime: z.string().optional(),
  childName: z.string().optional(),
  childAgeMonths: z.number().nonnegative().optional(),
  children: z.array(z.object({ name: z.string().optional(), ageMonths: z.number().optional() })).optional(),
  notes: z.string().optional(),
});

export const EscalateHumanArgsSchema = z.object({
  reason: z.string().min(1, 'Alasan eskalasi wajib diisi'),
  severity: z.enum(['CRITICAL_MEDICAL', 'CUSTOMER_REQUEST', 'MANUAL_HANDLING']),
});

export const ClinicFaqArgsSchema = z.object({
  topic: z.enum([
    'therapist_qualification',
    'payment_methods',
    'multi_child_transport',
    'post_vaccine_rules',
    'homebase_and_coverage',
    'operational_hours_and_booking',
    'general_homecare_info',
  ]),
});

export const SearchKnowledgeFaqArgsSchema = z.object({
  query: z.string().min(1, 'Query FAQ wajib diisi'),
  limit: z.number().int().min(1).max(5).optional().default(3),
});

export function validateToolArgs(toolName: string, rawArgs: any): { success: true; data: any } | { success: false; error: string } {
  try {
    let parsed: any;
    switch (toolName) {
      case 'calculate_delivery': parsed = CalculateDeliveryArgsSchema.parse(rawArgs); break;
      case 'get_catalog_and_price': parsed = GetCatalogArgsSchema.parse(rawArgs); break;
      case 'save_reservation': parsed = SaveReservationArgsSchema.parse(rawArgs); break;
      case 'escalate_to_human': parsed = EscalateHumanArgsSchema.parse(rawArgs); break;
      case 'get_clinic_policy_faq': parsed = ClinicFaqArgsSchema.parse(rawArgs); break;
      case 'search_knowledge_faq': parsed = SearchKnowledgeFaqArgsSchema.parse(rawArgs); break;
      default: return { success: false, error: `Tool "${toolName}" tidak memiliki schema validasi.` };
    }
    return { success: true, data: parsed };
  } catch (err: any) {
    return { success: false, error: `Schema validation failed: ${err.message}` };
  }
}
