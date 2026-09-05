import { CustomerSlate, ExtractedEntities } from './types';
import { DEFAULT_TENANT_ID } from '../config/tenant';

export interface FewShotExemplar {
  id: string;
  tenantId?: string;
  scenario: string;
  tags: string[];
  customerMessage: string;
  idealResponse: string;
  isActive?: boolean;
  sortOrder?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Bank Percakapan Ideal Bawaan Sistem (Default System Exemplars).
 * Selalu tersedia sebagai fallback jika database offline atau tabel kosong.
 */
export const DEFAULT_FEW_SHOT_EXEMPLARS: FewShotExemplar[] = [
  {
    id: 'symptom_flu_consultation',
    scenario: 'Pasien berkonsultasi keluhan batuk / pilek / flu / grok-grok pada bayi',
    tags: ['consult_symptom', 'flu', 'batuk', 'pilek', 'grok'],
    customerMessage: 'Anak saya usia 3 bulan lagi grok-grok dan pilek bun, ada pijatnya gak ya?',
    idealResponse:
      'Iya Bunda, untuk membantu melegakan pernapasan dan ketidaknyamanan si kecil, kami ada layanan *Pijat Bayi Pulih Ceria* yang dikombinasikan dengan teknik akupresur dan aromaterapi khusus flu/batuk pilek yaa 😊 Mau kami bantu cekkan ketersediaan jadwal Bidan untuk kunjungan ke rumah, Bunda?',
    isActive: true,
    sortOrder: 1,
  },
  {
    id: 'schedule_inquiry_anti_affirmation',
    scenario: 'Pasien menanyakan ketersediaan jadwal di hari tertentu (Anti-Afirmasi Jadwal)',
    tags: ['ask_schedule', 'schedule', 'sabtu', 'minggu', 'besok'],
    customerMessage: 'Hari Sabtu ini bu bidan bisa datang ke rumah?',
    idealResponse:
      'Untuk ketersediaan jadwal di hari Sabtu, akan kami bantu cekkan ketersediaan jadwal Bidan yang ready terlebih dahulu ya Bunda 😊 Kira-kira Bunda lebih nyaman di jam berapa yaa (pagi/siang/sore)?',
    isActive: true,
    sortOrder: 2,
  },
  {
    id: 'price_inquiry',
    scenario: 'Pasien menanyakan tarif/harga layanan',
    tags: ['ask_price', 'price', 'harga', 'tarif', 'biaya'],
    customerMessage: 'Untuk tarif pijat batuk pilek kena berapa ya bun?',
    idealResponse:
      'Untuk layanan *Pijat Bayi Pulih Ceria*, tarif promonya saat ini Rp 70.000 (durasi ~40 menit) ya Bunda 😊 Mau kami bantu jadwalkan kunjungan Bidan ke rumah untuk si kecil?',
    isActive: true,
    sortOrder: 3,
  },
  {
    id: 'payment_method_inquiry',
    scenario: 'Pasien menanyakan metode pembayaran (Transfer / QRIS / Cash)',
    tags: ['payment', 'qris', 'transfer', 'cash'],
    customerMessage: 'Pembayarannya bisa transfer atau harus cash kak?',
    idealResponse:
      'Untuk pembayaran sangat fleksibel ya Bunda, bisa melalui Transfer Bank (BCA, Mandiri, BRI), QRIS Universal, ataupun Tunai (Cash) setelah treatment selesai dilakukan 😊 Mau kami bantu cekkan jadwal Bidan?',
    isActive: true,
    sortOrder: 4,
  },
  {
    id: 'maternal_lactation_inquiry',
    scenario: 'Pasien menanyakan pijat laktasi / oksitosin untuk Ibu Menyusui',
    tags: ['laktasi', 'oksitosin', 'ibu', 'moms'],
    customerMessage: 'Pijat oksitosin itu untuk apa ya bun? Bisa buat lancarin ASI?',
    idealResponse:
      'Benar sekali Bunda 😊 *Pijat Oksitosin* khusus untuk Bunda menyusui/nifas guna merangsang hormon oksitosin alami, membantu melancarkan aliran ASI, serta merilekskan otot punggung dan leher yang tegang. Mau kami bantu jadwalkan untuk Bunda?',
    isActive: true,
    sortOrder: 5,
  },
  {
    id: 'post_delivery_treatment_continuation',
    scenario: 'Customer memilih/menentukan treatment (Anti-Penjelasan Ulang & Langsung Tanya Hari)',
    tags: ['follow_up', 'after_ongkir', 'select_treatment', 'massage biasa', 'pijat biasa'],
    customerMessage: 'Massage biasa',
    idealResponse:
      'Baik Bunda, untuk *Pijat Bayi Ceria* rencana mau kami bantu jadwalkan di hari apa ya Bunda? 🙏😊',
    isActive: true,
    sortOrder: 6,
  },
  {
    id: 'symptom_followup_no_cta',
    scenario: 'Pasien berkonsultasi gejala lanjutan atau respon penenang (Pacing Empati / Tanpa Todong CTA Jadwal)',
    tags: ['consult_symptom', 'followup', 'grok', 'gejala', 'lendir', 'pilek', 'bunyi', 'basah'],
    customerMessage: 'Nggk mbeler tp kyk cuman kyk basah trus kdng suka bunyi grr grr',
    idealResponse:
      'Iya Bunda, bunyi grok-grok pada si kecil wajar terjadi karena saluran napas bayi masih sangat sempit, sehingga sedikit lendir saja bisa menimbulkan bunyi saat bernapas 😊 Teknik akupresur dan pijat relaksasi di *Pijat Bayi Pulih Ceria* memang dirancang untuk membantu melegakan pernapasan dan mengencerkan lendir tersebut agar si kecil bisa bernapas lebih lega dan tidur pulas. Semoga si kecil selalu sehat dan nyaman yaa Bunda ✨',
    isActive: true,
    sortOrder: 7,
  },
];

// In-Memory dynamic cache per-tenant (0-latency runtime access)
const tenantExemplarsCache: Map<string, FewShotExemplar[]> = new Map();

export class FewShotExemplarBank {
  /**
   * Mengambil daftar seluruh exemplar untuk tenant (aktif & non-aktif).
   */
  public static async getAllExemplars(tenantId: string = DEFAULT_TENANT_ID): Promise<FewShotExemplar[]> {
    let cached = tenantExemplarsCache.get(tenantId);
    if (cached && cached.length > 0) {
      return cached;
    }

    try {
      const { prisma } = await import('../db/client');
      const rows = await prisma.fewShotExemplar.findMany({
        where: { tenant_id: tenantId },
        orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
      });

      if (rows && rows.length > 0) {
        cached = rows.map((r) => ({
          id: r.id,
          tenantId: r.tenant_id,
          scenario: r.scenario,
          tags: r.tags || [],
          customerMessage: r.customer_message,
          idealResponse: r.ideal_response,
          isActive: r.is_active,
          sortOrder: r.sort_order,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        }));
        tenantExemplarsCache.set(tenantId, cached);
        return cached;
      }
    } catch (err: any) {
      // Fallback diam-diam ke default jika DB offline
    }

    // Jika DB kosong atau offline, inisialisasi dengan default exemplars
    const defaults = DEFAULT_FEW_SHOT_EXEMPLARS.map((d) => ({ ...d, tenantId }));
    tenantExemplarsCache.set(tenantId, defaults);
    return defaults;
  }

  /**
   * Menambahkan exemplar baru ke DB dan memperbarui cache.
   */
  public static async createExemplar(
    data: {
      scenario: string;
      customerMessage: string;
      idealResponse: string;
      tags: string[];
      isActive?: boolean;
    },
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<FewShotExemplar> {
    const isActive = data.isActive ?? true;
    let newId = `ex_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    try {
      const { prisma } = await import('../db/client');
      const count = await prisma.fewShotExemplar.count({ where: { tenant_id: tenantId } });
      const created = await prisma.fewShotExemplar.create({
        data: {
          tenant_id: tenantId,
          scenario: data.scenario.trim(),
          customer_message: data.customerMessage.trim(),
          ideal_response: data.idealResponse.trim(),
          tags: data.tags.map((t) => t.trim().toLowerCase()).filter(Boolean),
          is_active: isActive,
          sort_order: count + 1,
        },
      });
      newId = created.id;
    } catch (err: any) {
      console.warn('[FEW SHOT BANK] DB create failed, updating in-memory only:', err.message);
    }

    const newExemplar: FewShotExemplar = {
      id: newId,
      tenantId,
      scenario: data.scenario.trim(),
      customerMessage: data.customerMessage.trim(),
      idealResponse: data.idealResponse.trim(),
      tags: data.tags.map((t) => t.trim().toLowerCase()).filter(Boolean),
      isActive,
      sortOrder: (tenantExemplarsCache.get(tenantId)?.length || 0) + 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const current = tenantExemplarsCache.get(tenantId) || [...DEFAULT_FEW_SHOT_EXEMPLARS];
    current.push(newExemplar);
    tenantExemplarsCache.set(tenantId, current);

    return newExemplar;
  }

  /**
   * Mengupdate exemplar di DB dan cache.
   */
  public static async updateExemplar(
    id: string,
    data: Partial<{
      scenario: string;
      customerMessage: string;
      idealResponse: string;
      tags: string[];
      isActive: boolean;
      sortOrder: number;
    }>,
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<FewShotExemplar | null> {
    try {
      const { prisma } = await import('../db/client');
      await prisma.fewShotExemplar.update({
        where: { id },
        data: {
          ...(data.scenario !== undefined && { scenario: data.scenario.trim() }),
          ...(data.customerMessage !== undefined && { customer_message: data.customerMessage.trim() }),
          ...(data.idealResponse !== undefined && { ideal_response: data.idealResponse.trim() }),
          ...(data.tags !== undefined && { tags: data.tags.map((t) => t.trim().toLowerCase()).filter(Boolean) }),
          ...(data.isActive !== undefined && { is_active: data.isActive }),
          ...(data.sortOrder !== undefined && { sort_order: data.sortOrder }),
        },
      });
    } catch (err: any) {
      console.warn('[FEW SHOT BANK] DB update failed, updating in-memory only:', err.message);
    }

    const current = await this.getAllExemplars(tenantId);
    const index = current.findIndex((c) => c.id === id);
    if (index === -1) return null;

    const updated = {
      ...current[index],
      ...(data.scenario !== undefined && { scenario: data.scenario.trim() }),
      ...(data.customerMessage !== undefined && { customerMessage: data.customerMessage.trim() }),
      ...(data.idealResponse !== undefined && { idealResponse: data.idealResponse.trim() }),
      ...(data.tags !== undefined && { tags: data.tags.map((t) => t.trim().toLowerCase()).filter(Boolean) }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
      ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
      updatedAt: new Date(),
    };

    current[index] = updated;
    tenantExemplarsCache.set(tenantId, current);
    return updated;
  }

  /**
   * Menghapus exemplar dari DB dan cache.
   */
  public static async deleteExemplar(id: string, tenantId: string = DEFAULT_TENANT_ID): Promise<boolean> {
    try {
      const { prisma } = await import('../db/client');
      await prisma.fewShotExemplar.deleteMany({
        where: { id, tenant_id: tenantId },
      });
    } catch (err: any) {
      console.warn('[FEW SHOT BANK] DB delete failed, updating in-memory only:', err.message);
    }

    const current = await this.getAllExemplars(tenantId);
    const filtered = current.filter((c) => c.id !== id);
    tenantExemplarsCache.set(tenantId, filtered);
    return true;
  }

  /**
   * Mereset daftar exemplar ke default sistem.
   */
  public static async resetToDefaults(tenantId: string = DEFAULT_TENANT_ID): Promise<FewShotExemplar[]> {
    try {
      const { prisma } = await import('../db/client');
      await prisma.fewShotExemplar.deleteMany({ where: { tenant_id: tenantId } });

      for (let i = 0; i < DEFAULT_FEW_SHOT_EXEMPLARS.length; i++) {
        const d = DEFAULT_FEW_SHOT_EXEMPLARS[i];
        await prisma.fewShotExemplar.create({
          data: {
            tenant_id: tenantId,
            scenario: d.scenario,
            customer_message: d.customerMessage,
            ideal_response: d.idealResponse,
            tags: d.tags,
            is_active: true,
            sort_order: i + 1,
          },
        });
      }
    } catch (err: any) {
      console.warn('[FEW SHOT BANK] DB reset failed, resetting in-memory only:', err.message);
    }

    const defaults = DEFAULT_FEW_SHOT_EXEMPLARS.map((d) => ({ ...d, tenantId }));
    tenantExemplarsCache.set(tenantId, defaults);
    return defaults;
  }

  /**
   * Memilih 1-2 contoh percakapan ideal yang paling relevan dengan pesan dan intent customer saat ini.
   */
  public static selectRelevantExemplars(
    extraction: ExtractedEntities,
    slate?: CustomerSlate,
    customerInput?: string,
    tenantId: string = DEFAULT_TENANT_ID
  ): FewShotExemplar[] {
    const inputLower = (customerInput || '').toLowerCase();
    const cached = tenantExemplarsCache.get(tenantId) || DEFAULT_FEW_SHOT_EXEMPLARS;
    const activeExemplars = cached.filter((e) => e.isActive !== false);

    const scored: Array<{ exemplar: FewShotExemplar; score: number }> = [];

    for (const ex of activeExemplars) {
      let score = 0;

      // 1. Cocokkan dengan tags
      for (const tag of ex.tags) {
        if (inputLower.includes(tag)) score += 3;
        if (extraction.intents.some((i) => i.includes(tag))) score += 4;
        if (extraction.symptoms.some((s) => s.includes(tag))) score += 4;
      }

      // 2. Prioritaskan jadwal jika ada mention hari/jadwal
      if (
        (ex.id === 'schedule_inquiry_anti_affirmation' && extraction.intents.includes('ask_schedule')) ||
        Boolean(extraction.preferredDateText)
      ) {
        score += 5;
      }

      // 3. Prioritaskan harga jika ada intent ask_price
      if (ex.id === 'price_inquiry' && extraction.intents.includes('ask_price')) {
        score += 5;
      }

      // 4. Prioritaskan keluhan jika ada symptoms
      if (
        ex.id === 'symptom_flu_consultation' &&
        (extraction.symptoms.length > 0 || extraction.intents.includes('consult_symptom'))
      ) {
        score += 5;
      }

      // 5. Prioritaskan follow-up jika ongkir sudah pernah terkirim
      if (ex.id === 'post_delivery_treatment_continuation' && slate?.isLocationConfirmed && !slate.selectedTreatmentName) {
        score += 2;
      }

      scored.push({ exemplar: ex, score });
    }

    // Urutkan skor tertinggi dan ambil maksimal 2 contoh
    scored.sort((a, b) => b.score - a.score);
    const top = scored.filter((s) => s.score > 0).slice(0, 2);

    // Fallback: Jika tidak ada yang cocok kuat, ambil exemplar pertama yang aktif
    if (top.length === 0) {
      return activeExemplars.length > 0 ? [activeExemplars[0]] : [DEFAULT_FEW_SHOT_EXEMPLARS[0]];
    }

    return top.map((t) => t.exemplar);
  }

  /**
   * Format exemplar menjadi blok teks ramah prompt.
   */
  public static formatExemplarsForPrompt(exemplars: FewShotExemplar[]): string {
    if (!exemplars || exemplars.length === 0) return '';

    const formatted = exemplars
      .map(
        (e, idx) =>
          `Contoh ${idx + 1} (${e.scenario}):\n` +
          `Pasien: "${e.customerMessage}"\n` +
          `Bidan Yusi: "${e.idealResponse}"`
      )
      .join('\n\n');

    return `CONTOH PERCAKAPAN IDEAL BIDAN YUSI (TIRU POLA DAN NADA BICARANYA):\n${formatted}`;
  }
}
