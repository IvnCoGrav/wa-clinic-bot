import { extractFastIntents } from '../persona';
import { ContextGrounder } from './context-grounder';
import { hasIslamicSalutation } from '../../../utils/lead-greeting-detector';
import { TEMPLATES } from '../../../config/persona';
import { DEFAULT_TENANT_ID } from '../../../config/tenant';
import { treatmentCatalogService } from '../../../services/treatment-catalog.service';

export interface DeliveryFastPathInput {
  executedTools: Array<{ name: string; args?: any; result?: any }>;
  cleanIncomingText: string;
  isFollowUp: boolean;
  tenantId?: string;
}

export interface DeliveryFastPathResult {
  eligible: boolean;
  reason: string;
  reply: string;
}

/**
 * Gerbang Deterministik Balasan Lokasi Murni (Deterministic Fast SOP).
 *
 * Giliran yang HANYA menjawab lokasi via calculate_delivery dibalas dengan
 * suggestedTemplateReply resmi tool — tanpa Call 2 LLM (hemat token, nol
 * parafrase, nol narasi "basecamp"). Konsumsi RAW executedTools (template
 * utuh di memori); payload LLM tetap murni terstruktur (anti parrot-effect).
 *
 * Klasifikasi murni vs campuran 100% deterministik (state/kontrak/data):
 * - WAJIB single-tool calculate_delivery + suggestedTemplateReply terisi
 *   (cabang gagal tanpa template otomatis fail-open ke Call 2).
 * - Intent dibatasi {provide_location, ask_price} via extractFastIntents
 *   (consult_symptom/ask_schedule/ask_duration → Call 2).
 * - Sinyal medis deterministik (trauma-jatuh/vaksin) → Call 2.
 * - Sebutan nama katalog (data-driven dari DB, tanpa hafalan) → Call 2.
 * Giliran campuran yang lolos ke Call 2 tetap dijaga validator D8.
 */
export class DeliveryFastPath {
  /** Intent yang kompatibel dengan balasan lokasi-murni. */
  private static readonly ALLOWED_INTENTS = new Set(['provide_location', 'ask_price']);

  /**
   * Deteksi sebutan nama treatment katalog di teks (data-driven: nama dari
   * DB/in-memory, tanpa daftar hafalan di kode). Konservatif: frasa nama
   * utuh/alias (len>=6/4) sebagai substring. Gagal baca katalog → anggap
   * menyebut (fail-open ke Call 2 = perilaku hari ini, aman).
   */
  public static mentionsCatalogTreatment(text: string, tenantId: string = DEFAULT_TENANT_ID): boolean {
    const q = (text || '').toLowerCase();
    if (!q.trim()) return false;
    let names: string[];
    try {
      names = treatmentCatalogService
        .getAllServices(true, tenantId)
        .map((s) => s?.name)
        .filter((n): n is string => typeof n === 'string' && n.trim().length > 0);
    } catch {
      return true;
    }
    for (const raw of names) {
      const full = raw.toLowerCase().trim();
      const clean = full.replace(/\s*\([^)]*\)\s*$/g, '').trim();
      const aliasMatch = raw.match(/\(([^)]+)\)/);
      const alias = aliasMatch ? aliasMatch[1].toLowerCase().trim() : '';
      if (clean.length >= 6 && q.includes(clean)) return true;
      if (full.length >= 6 && full !== clean && q.includes(full)) return true;
      if (alias.length >= 4 && q.includes(alias)) return true;
      // Frasa 2-kata pembuka nama katalog (cermin scorer katalog:
      // "paket laktasi" ∈ "Paket Laktasi Booster") — sebutan paket eksplisit.
      const firstTwo = clean.split(/\s+/).slice(0, 2).join(' ');
      if (firstTwo.length >= 6 && q.includes(firstTwo)) return true;
    }
    return false;
  }

  public static evaluate(input: DeliveryFastPathInput): DeliveryFastPathResult {
    const tools = input.executedTools || [];
    const text = input.cleanIncomingText || '';
    const tenantId = input.tenantId || DEFAULT_TENANT_ID;
    const no = (reason: string): DeliveryFastPathResult => ({ eligible: false, reason, reply: '' });

    if (tools.length !== 1 || tools[0]?.name !== 'calculate_delivery') {
      return no('bukan single calculate_delivery');
    }
    const template = tools[0]?.result?.suggestedTemplateReply;
    if (typeof template !== 'string' || template.trim().length === 0) {
      return no('tanpa suggestedTemplateReply');
    }
    const intents = extractFastIntents(text);
    const blocked = intents.filter((i) => !DeliveryFastPath.ALLOWED_INTENTS.has(i));
    if (blocked.length > 0) {
      return no(`intent campuran: ${blocked.join(',')}`);
    }
    if (ContextGrounder.hasFallInjurySignal(text) || ContextGrounder.hasVaccineSignal(text)) {
      return no('sinyal medis deterministik');
    }
    if (DeliveryFastPath.mentionsCatalogTreatment(text, tenantId)) {
      return no('sebutan nama katalog');
    }

    // Turn-0 (pesan pertama berupa lokasi): prepend header sapaan resmi agar
    // SOP greeting tidak hilang — cermin garansi sapaan generation-stage.
    // Flag Islami memakai detector eksisting (bukan regex baru).
    let reply: string = template;
    if (!input.isFollowUp) {
      const islamic = hasIslamicSalutation(text);
      reply = `${TEMPLATES.firstContactGreetingHeader({ isIslamic: islamic })}\n\n${template}`;
    }
    return { eligible: true, reason: 'lokasi murni', reply };
  }
}
