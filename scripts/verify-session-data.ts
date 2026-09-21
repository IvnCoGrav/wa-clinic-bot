import 'dotenv/config';
(async () => {
  const { prisma } = await import('../src/db/client');
  try {
    // Akseptansi Fase 1: tulis session_data tanpa error PrismaClientValidationError
    const conv: any = await prisma.conversation.findFirst({ select: { id: true }, orderBy: { updated_at: 'desc' } as any });
    if (!conv) { console.log('NO CONVERSATION'); process.exit(0); }
    const probe = { _probe: 'phase1-check', ts: new Date().toISOString() };
    await prisma.conversation.updateMany({
      where: { id: conv.id },
      data: { session_data: probe } as any,
    });
    const back: any = await prisma.conversation.findUnique({ where: { id: conv.id }, select: { session_data: true } as any });
    console.log('session_data WRITABLE:', JSON.stringify(back.session_data));
    // bersihkan probe
    await prisma.conversation.updateMany({ where: { id: conv.id }, data: { session_data: null } as any });
    console.log('PHASE 1 ACCEPTANCE: PASS');
    await prisma.$disconnect();
    process.exit(0);
  } catch (e: any) {
    console.log('PHASE 1 ACCEPTANCE: FAIL —', e.message);
    process.exit(1);
  }
})();
