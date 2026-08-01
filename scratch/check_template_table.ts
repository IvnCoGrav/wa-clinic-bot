import { prisma } from "../src/db/client";
(async () => {
  try {
    const count = await prisma.followUpTemplate.count();
    console.log("follow_up_templates table exists. Count:", count);
  } catch (e: any) {
    console.log("ERROR:", e.message);
  }
  await prisma.$disconnect();
})();
