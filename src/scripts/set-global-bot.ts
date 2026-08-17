import { AiModelConfigService } from '../config/ai-models.config';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { prisma } from '../db/client';

async function main() {
  const arg = process.argv[2];
  if (arg === 'off') {
    await AiModelConfigService.setBotActive(DEFAULT_TENANT_ID, false);
    console.log('🔴 Global AI Bot telah DINONAKTIFKAN (OFF) dan disimpan persisten ke database.');
  } else if (arg === 'on') {
    await AiModelConfigService.setBotActive(DEFAULT_TENANT_ID, true);
    console.log('🟢 Global AI Bot telah DIAKTIFKAN (ON) dan disimpan persisten ke database.');
  } else {
    await AiModelConfigService.loadConfigsFromDb(DEFAULT_TENANT_ID);
    const status = AiModelConfigService.isBotActive(DEFAULT_TENANT_ID);
    console.log(`ℹ️ Status Global AI Bot saat ini: ${status ? '🟢 AKTIF (ON)' : '🔴 NONAKTIF (OFF)'}`);
  }
}

main().catch(console.error).finally(async () => { await prisma.$disconnect(); });
