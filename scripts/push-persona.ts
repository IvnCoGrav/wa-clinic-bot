/**
 * push-persona.ts
 * Tulis persona aktif (dari file persona_custom.txt / default) ke tabel tenant_persona
 * agar berlaku langsung tanpa perlu menyimpan manual lewat panel AI Persona.
 *
 * Jalankan: npx tsx src/scripts/push-persona.ts
 */
import { BOT_PERSONA_PROMPT, savePersonaToDb } from '../config/persona';
import { DEFAULT_TENANT_ID } from '../config/tenant';

async function main() {
  console.log('[PUSH-PERSONA] Persona yang akan disimpan (default-tenant):');
  console.log('------------------------------------------------------------');
  console.log(BOT_PERSONA_PROMPT.slice(0, 400));
  console.log('...');
  console.log(`[PUSH-PERSONA] Panjang teks: ${BOT_PERSONA_PROMPT.length} karakter`);

  const ok = await savePersonaToDb(BOT_PERSONA_PROMPT, DEFAULT_TENANT_ID);
  if (ok) {
    console.log('[PUSH-PERSONA] SUKSES: persona berhasil ditulis ke DB tenant_persona.');
  } else {
    console.error('[PUSH-PERSONA] GAGAL menulis ke DB.');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[PUSH-PERSONA] Error:', err);
  process.exitCode = 1;
});
