/**
 * scripts/lib/user-persona-simulator.ts — Dynamic User Persona Simulator.
 *
 * LLM flash/ringan berperan sebagai CUSTOMER SAJA (tidak pernah sebagai bot).
 * Merespons adaptif berdasarkan persona yang diekstrak dari chat riil/episode fixture.
 * Tenant-aware: persona dimuat dari DB per-tenant.
 *
 * Determinisme: seed + temperature terkunci, cap turns, loop detection.
 */

import { z } from 'zod';

/** Persona Customer dari DB (per tenant) */
export const CustomerPersonaSchema = z.object({
  customerName: z.string(),
  locationProfile: z.string(),           // "Tenggilis Mejoyo Surabaya"
  childAgeProfile: z.string(),           // "Bayi 3 bulan"
  symptomOrInterest: z.string(),         // "Batuk pilek, mau tanya terapi uap"
  slangAndTone: z.string(),              // "Santai, campur bahasa Jawa Suroboyoan ('kemeng', 'wes gk kuat')"
  primaryGoal: z.string(),               // "Mengetahui apakah bapil boleh dipijat dan minta info tarif"
  maxTurns: z.number().int().min(1).max(10).default(5),
});
export type CustomerPersona = z.infer<typeof CustomerPersonaSchema>;

/** Konfigurasi runtime simulator */
export const SimulatorConfigSchema = z.object({
  model: z.string().default('gemini-2.5-flash'), // model ringan
  temperature: z.number().min(0).max(1).default(0.5),
  seed: z.number().int().default(42),
  maxTurns: z.number().int().min(1).max(10).default(5),
  systemPrompt: z.string(),
});
export type SimulatorConfig = z.infer<typeof SimulatorConfigSchema>;

/** Single turn transkrip */
export const SimTurnSchema = z.object({
  turn: z.number().int(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  timestamp: z.string().datetime(),
});
export type SimTurn = z.infer<typeof SimTurnSchema>;

/** Hasil simulasi penuh */
export const SimulationResultSchema = z.object({
  episodeId: z.string(),
  persona: CustomerPersonaSchema,
  config: SimulatorConfigSchema,
  transcript: z.array(SimTurnSchema),
  finalState: z.string().optional(),
  toolsCalled: z.array(z.string()).optional(),
  terminatedEarly: z.boolean().default(false),
  terminationReason: z.string().optional(),
});
export type SimulationResult = z.infer<typeof SimulationResultSchema>;

/** Build system prompt untuk LLM customer simulator */
export function buildCustomerSimulatorPrompt(persona: CustomerPersona): string {
  return `Kamu adalah SIMULATOR CUSTOMER (Ibu/Bapak) yang chat ke WhatsApp klinik bayi.
JANGAN PERNAH bertindak sebagai bot/bidan/asisten. Kamu HANYA merespons sebagai customer.

=== PERSONA CUSTOMER ===
Nama: ${persona.customerName}
Lokasi: ${persona.locationProfile}
Profil Anak: ${persona.childAgeProfile}
Keluhan/Minat: ${persona.symptomOrInterest}
Gaya Bahasa: ${persona.slangAndTone}
Tujuan Utama: ${persona.primaryGoal}

=== ATURAN KETAT ===
1. Kamu HANYA kirim pesan customer. JANGAN balas sebagai bot.
2. Gunakan gaya bahasa alami sesuai persona (typo, slang, singkatan boleh).
3. Maksimal 2-3 kalimat per balasan. Jangan cerita panjang.
4. Jika bot tanya lokasi → share lokasi/teks sesuai persona.locationProfile.
5. Jika bot tanya detail anak → jawab sesuai persona.childAgeProfile.
6. Jika bot rekomendasikan layanan → tanya harga/durah/jadwal sesuai persona.primaryGoal.
7. Jika bot minta konfirmasi booking → jawab "ya" atau "minta detail dulu" sesuai goal.
8. STOP jika: (a) sudah booking selesai, (b) bot eskalasi ke manusia, (c) cap maxTurns.
9. JANGAN ulang pertanyaan yang sudah dijawab.
10. JANGAN keluar dari karakter (tidak pernah sebut "sebagai AI", "saya bot", dll).`;
}

/** Detect loop: 3 balasan identik/serupa beruntun */
function detectLoop(transcript: SimTurn[], threshold = 3): boolean {
  if (transcript.length < threshold * 2) return false;
  const recentUser = transcript.filter(t => t.role === 'user').slice(-threshold);
  const contents = recentUser.map(t => t.content.trim().toLowerCase());
  return contents.every(c => c === contents[0]) && contents[0].length > 0;
}

/** Simulate one episode dengan LLM customer */
export async function simulateEpisode(
  episodeId: string,
  persona: CustomerPersona,
  config: SimulatorConfig,
  botRunner: (userMsg: string, history: SimTurn[]) => Promise<{ reply: string; state?: string; tools?: string[] }>
): Promise<SimulationResult> {
  const transcript: SimTurn[] = [];
  let turn = 0;
  let terminatedEarly = false;
  let terminationReason: string | undefined;
  let finalState: string | undefined;
  const toolsCalled: string[] = [];

  // Initial user message dari episode fixture (first customer turn)
  // Note: episode fixture first turn is already customer message
  // We'll start with that as the opening

  while (turn < config.maxTurns && !terminatedEarly) {
    let userMsg: string;

    if (turn === 0) {
      // First turn: persona opens conversation based on primaryGoal/symptom
      userMsg = `[SIMULATOR OPENING] ${persona.symptomOrInterest || persona.primaryGoal}`;
    } else {
      // Generate user response via LLM (placeholder - actual LLM call would go here)
      // For now, use deterministic fallback based on persona
      userMsg = generateDeterministicUserResponse(persona, transcript, turn);
    }

    const userTurn: SimTurn = {
      turn,
      role: 'user',
      content: userMsg,
      timestamp: new Date().toISOString(),
    };
    transcript.push(userTurn);

    // Call bot
    const botResult = await botRunner(userMsg, transcript);
    const { reply, state, tools } = botResult;

    if (state) finalState = state;
    if (tools) toolsCalled.push(...tools);

    const botTurn: SimTurn = {
      turn,
      role: 'assistant',
      content: reply,
      timestamp: new Date().toISOString(),
    };
    transcript.push(botTurn);

    // Check termination conditions
    if (state === 'HUMAN_HANDLING') {
      terminatedEarly = true;
      terminationReason = 'Bot escalated to human handling';
      break;
    }
    if (state === 'SCHEDULED' || state === 'COMPLETED') {
      terminatedEarly = true;
      terminationReason = `Conversation reached terminal state: ${state}`;
      break;
    }
    if (detectLoop(transcript)) {
      terminatedEarly = true;
      terminationReason = 'Loop detected (repeated user responses)';
      break;
    }

    turn++;
  }

  if (!terminatedEarly && turn >= config.maxTurns) {
    terminationReason = 'Max turns reached';
  }

  return {
    episodeId,
    persona,
    config,
    transcript,
    finalState,
    toolsCalled: [...new Set(toolsCalled)],
    terminatedEarly,
    terminationReason,
  };
}

/** Deterministic fallback user response (when LLM not available) */
function generateDeterministicUserResponse(
  persona: CustomerPersona,
  transcript: SimTurn[],
  turn: number
): string {
  const lastBotMsg = [...transcript].reverse().find(t => t.role === 'assistant')?.content?.toLowerCase() || '';
  const goal = persona.primaryGoal.toLowerCase();
  const slang = persona.slangAndTone.toLowerCase();

  // Pattern matching untuk respons deterministik
  if (lastBotMsg.includes('lokasi') || lastBotMsg.includes('alamat') || lastBotMsg.includes('dimana')) {
    return persona.locationProfile;
  }
  if (lastBotMsg.includes('umur') || lastBotMsg.includes('usia') || lastBotMsg.includes('bulan') || lastBotMsg.includes('tahun')) {
    return persona.childAgeProfile;
  }
  if (lastBotMsg.includes('harga') || lastBotMsg.includes('biaya') || lastBotMsg.includes('tarif') || lastBotMsg.includes('ongkir')) {
    if (goal.includes('harga') || goal.includes('tarif')) {
      return 'Berapa harganya ya?';
    }
    return 'Oh gitu, berapa ongkirnya?';
  }
  if (lastBotMsg.includes('jadwal') || lastBotMsg.includes('jam') || lastBotMsg.includes('hari') || lastBotMsg.includes('kapan')) {
    return 'Bisa jam berapa ya?';
  }
  if (lastBotMsg.includes('konfirmasi') || lastBotMsg.includes('booking') || lastBotMsg.includes('reservasi') || lastBotMsg.includes('lanjut')) {
    if (goal.includes('booking') || goal.includes('reserv')) {
      return 'Ya, lanjut booking';
    }
    return 'Minta detail dulu ya';
  }
  if (lastBotMsg.includes('terapis') || lastBotMsg.includes('wanita') || lastBotMsg.includes('cewek') || lastBotMsg.includes('priawan')) {
    return 'Terapisnya cewek semua kan?';
  }
  if (lastBotMsg.includes('pijat') || lastBotMsg.includes('massage') || lastBotMsg.includes('therapy') || lastBotMsg.includes('bapil')) {
    return 'Ada yang cocok buat anak saya ga?';
  }

  // Default: pertanyaan follow-up generik
  const generics = [
    'Oh gitu, trus?',
    'Bisa jelasin lebih detail?',
    'Kalau gitu berapa lama?',
    'Oke, lanjut ya',
  ];
  return generics[turn % generics.length];
}

/** Load persona dari DB per tenant (placeholder - actual impl di service) */
export async function loadPersonaFromDb(tenantId: string, episodeId: string): Promise<CustomerPersona> {
  // TODO: Implement DB query ke tenant_persona / customer profiles
  // Return default based on episode tier for now
  return {
    customerName: 'Bunda Simulasi',
    locationProfile: 'Tenggilis Mejoyo Surabaya',
    childAgeProfile: 'Bayi 6 bulan',
    symptomOrInterest: 'Mau tanya pijat bayi',
    slangAndTone: 'Santai, bahasa Indonesia campur Jawa Suroboyoan',
    primaryGoal: 'Booking pijat bayi ceria kalau cocok',
    maxTurns: 5,
  };
}