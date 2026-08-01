import { prisma } from "../src/db/client";
(async () => {
  const total = await prisma.followUp.count();
  const byStatus = await prisma.followUp.groupBy({ by: ["status"], _count: true });
  const byType = await prisma.followUp.groupBy({ by: ["type"], _count: true });
  console.log("Total follow-ups:", total);
  console.log("By status:", byStatus.map((s: any) => `${s.status}:${s._count}`).join(", "));
  console.log("By type:", byType.map((t: any) => `${t.type}:${t._count}`).join(", "));
  await prisma.$disconnect();
})();
