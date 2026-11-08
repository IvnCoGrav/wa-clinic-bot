import { describe, it, expect } from 'vitest';
import { salvageToolCallsFromDsml } from '../../src/v3/agent/pipeline/dsml-tool-salvage';

describe('Tool Execution Authorization & Masking Guard (Task 0.6)', () => {
  const dsmlContent = `
    Tentu Bunda, saya bantu pesankan jadwalnya.
    <|DSML|>
    invoke name="save_reservation" {"patientName": "Adik Bayi", "treatmentName": "Pijat Bayi"}
    </|DSML|>
  `;

  it('should NOT salvage or authorize masked tools that are not in allowedToolNames', () => {
    const allowedToolNames = ['get_catalog_and_price', 'check_slot_availability'];

    // Pada kode lama, salvageToolCallsFromDsml tidak menerima/memvalidasi allowedToolNames
    // dan membocorkan tool ter-mask (save_reservation).
    // Pada Fase 4, salvage/otorisasi WAJIB menolak tool yang tidak diizinkan.
    const salvaged = (salvageToolCallsFromDsml as any)(dsmlContent, { allowedToolNames });

    // Ekspektasi: save_reservation TIDAK boleh lolos otorisasi eksekusi bila tidak ada di allowedToolNames
    const hasUnauthorizedTool = Array.isArray(salvaged) && salvaged.some(
      (tc: any) => tc.function?.name === 'save_reservation'
    );

    expect(hasUnauthorizedTool).toBe(false);
  });
});
