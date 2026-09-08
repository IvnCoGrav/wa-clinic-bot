import { clinicConfig } from '../../config/clinic';
import { getBrandIdentity } from '../../config/brand';
import { TEMPLATES } from '../../config/persona';
import { DEFAULT_TENANT_ID } from '../../config/tenant';

export type ClinicPolicyTopic =
  | 'therapist_qualification'
  | 'payment_methods'
  | 'multi_child_transport'
  | 'post_vaccine_rules'
  | 'homebase_and_coverage'
  | 'operational_hours_and_booking'
  | 'general_homecare_info';

export interface GetClinicFaqInput {
  topic: ClinicPolicyTopic;
}

export interface GetClinicFaqOutput {
  success: boolean;
  topic: ClinicPolicyTopic;
  factualSummary: string;
  suggestedReply: string;
}

export const GET_CLINIC_POLICY_FAQ_TOOL_SCHEMA = {
  type: 'function',
  function: {
    name: 'get_clinic_policy_faq',
    description: 'Mengambil informasi resmi, SOP, dan kebijakan klinik Kala Moms & Baby Spa. PANGGIL TOOL INI ketika customer bertanya: asal/lokasi/homebase klinik ("dari mana asal klinik", "lokasinya dimana", "dari surabaya kah?", "sus nya dimana", "bidannya dimana", "posisi bidan dari mana"), kualifikasi terapis ber-STR, metode pembayaran transfer/QRIS/cash, ongkir multi-anak, aturan pijat pasca-vaksinasi, atau jam operasional.',
    parameters: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          enum: [
            'therapist_qualification',
            'payment_methods',
            'multi_child_transport',
            'post_vaccine_rules',
            'homebase_and_coverage',
            'operational_hours_and_booking',
            'general_homecare_info'
          ],
          description: 'Topik kebijakan atau SOP yang ditanyakan customer: asal/lokasi klinik (homebase_and_coverage), kualifikasi bidan (therapist_qualification), pembayaran (payment_methods), ongkir multi anak (multi_child_transport), vaksin (post_vaccine_rules), operasional (operational_hours_and_booking).'
        }
      },
      required: ['topic']
    }
  }
};

const clinicPolicyCache = new Map<string, { data: GetClinicFaqOutput; expiresAt: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 jam

export function clearClinicPolicyCache(tenantId: string, topic?: string): void {
  if (topic) clinicPolicyCache.delete(`${tenantId}:${topic}`);
  else {
    for (const key of clinicPolicyCache.keys()) {
      if (key.startsWith(`${tenantId}:`)) clinicPolicyCache.delete(key);
    }
  }
}

export function getStaticFallbackTopics(): GetClinicFaqOutput[] {
  const topics: ClinicPolicyTopic[] = [
    'therapist_qualification',
    'payment_methods',
    'multi_child_transport',
    'post_vaccine_rules',
    'homebase_and_coverage',
    'operational_hours_and_booking',
    'general_homecare_info',
  ];
  return topics.map((t) => getStaticFallbackPolicy(t));
}

function getStaticFallbackPolicy(topic: ClinicPolicyTopic): GetClinicFaqOutput {
  const brand = getBrandIdentity();
  switch (topic) {
    case 'therapist_qualification':
      return {
        success: true,
        topic,
        factualSummary: 'Seluruh tenaga terapis di Kala Moms & Baby Spa adalah Bidan profesional lulusan D3/D4/Profesi Kebidanan yang memiliki STR (Surat Tanda Registrasi) aktif, terlatih khusus baby & mom treatment, dan menerapkan protokol higienis ketat.',
        suggestedReply: TEMPLATES.therapistQualificationPolicy()
      };

    case 'payment_methods':
      return {
        success: true,
        topic,
        factualSummary: 'Metode pembayaran tersedia via Transfer Bank (BCA, Mandiri, BRI), QRIS Universal, atau Cash langsung ke Bidan setelah treatment selesai. Nomor rekening resmi BCA a.n Kala Moms and Baby Spa akan diinfokan Admin saat konfirmasi jadwal.',
        suggestedReply: TEMPLATES.paymentMethodPolicy()
      };

    case 'multi_child_transport':
      return {
        success: true,
        topic,
        factualSummary: 'Biaya transport/ongkir dihitung per satu kali kedatangan (per alamat rumah). Jika Bunda memesan untuk 2 anak, 3 anak, atau Bunda + si kecil dalam 1 kunjungan, ongkir tetap dihitung 1 KALI SAJA.',
        suggestedReply: TEMPLATES.multiChildTransportPolicy()
      };

    case 'post_vaccine_rules':
      return {
        success: true,
        topic,
        factualSummary: 'Si kecil sebaiknya dipijat minimal 3 hari setelah imunisasi/vaksinasi, dengan syarat si kecil sudah dalam kondisi sehat dan tidak sedang demam/hangat.',
        suggestedReply: 'Untuk si kecil yang baru saja imunisasi, sebaiknya dijadwalkan minimal *3 hari setelah vaksin* ya Bunda 😊\n\nPastikan juga si kecil sudah tidak demam atau rewel agar saat treatment si kecil merasa lebih nyaman dan rileks 🤗'
      };

    case 'homebase_and_coverage':
      return {
        success: true,
        topic,
        factualSummary: `Homebase klinik kami berlokasi di Waru, Sidoarjo (dekat perbatasan Surabaya). Layanan resmi kami adalah Homecare (Bidan yang berkunjung langsung ke rumah Bunda) dengan area jangkauan seluruh Surabaya dan Sidoarjo (maksimal 30 km dari homebase).`,
        suggestedReply: `Homebase kami berada di Waru, Sidoarjo ya Bunda 😊 Layanan kami adalah Homecare treatment di mana Bidan kami yang akan datang langsung ke rumah Bunda untuk seluruh area Surabaya dan Sidoarjo (maksimal 30 km).`
      };

    case 'operational_hours_and_booking':
      return {
        success: true,
        topic,
        factualSummary: 'Layanan homecare buka setiap hari (Senin - Minggu) pukul 08.00 - 17.00 WIB. Pemilihan slot jam kunjungan dikoordinasikan oleh Admin CS berdasarkan ketersediaan rute bidan yang bertugas.',
        suggestedReply: `Layanan homecare kami buka setiap hari (Senin - Minggu) mulai pukul 08.00 hingga 17.00 WIB ya Bunda 😊\n\nUntuk ketersediaan jadwal di hari yang Bunda inginkan, akan kami bantu cekkan terlebih dahulu slot Bidan kami yang ready 🤗`
      };

    case 'general_homecare_info':
    default:
      return {
        success: true,
        topic: 'general_homecare_info',
        factualSummary: `${brand.businessName} melayani perawatan ibu dan bayi langsung di rumah Bunda (Homecare treatment). Seluruh peralatan, matras, aromaterapi, dan minyak khusus disiapkan oleh Bidan kami.`,
        suggestedReply: `Di ${brand.businessName}, kami menyediakan layanan Homecare treatment profesional di mana Bidan kami yang akan datang langsung ke rumah Bunda dengan membawa seluruh perlengkapan steril dan higienis 😊`
      };
  }
}

export async function executeGetClinicFaq(input: GetClinicFaqInput, tenantId: string = DEFAULT_TENANT_ID): Promise<GetClinicFaqOutput> {
  const { topic } = input;
  const cacheKey = `${tenantId}:${topic}`;
  const cached = clinicPolicyCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  try {
    const { prisma } = await import('../../db/client');
    const policy = await (prisma as any).clinicPolicy.findUnique({
      where: { tenant_id_topic: { tenant_id: tenantId, topic } },
    });

    if (policy && policy.is_active) {
      const result: GetClinicFaqOutput = {
        success: true,
        topic,
        factualSummary: policy.factual_summary,
        suggestedReply: policy.suggested_reply,
      };
      clinicPolicyCache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
      return result;
    }
  } catch (err: any) {
    console.warn(JSON.stringify({ event: 'CLINIC_FAQ_TOOL_DB_ERROR', tenantId, topic, error: err.message, timestamp: new Date().toISOString() }));
  }

  // Fallback ke data statis bawaan jika DB belum di-seed
  const fallback = getStaticFallbackPolicy(topic);
  clinicPolicyCache.set(cacheKey, { data: fallback, expiresAt: Date.now() + CACHE_TTL_MS });
  return fallback;
}
