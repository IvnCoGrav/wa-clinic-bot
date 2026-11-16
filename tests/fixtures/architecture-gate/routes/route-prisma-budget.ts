// Fixture: route-prisma-budget.ts
declare const prisma: any;

export async function dummyRouteHandler() {
  const c1 = await prisma.customer.findUnique({ where: { id: '1' } });
  const c2 = await prisma.customer.findMany();
  const c3 = await prisma.customer.create({ data: {} });
  return { c1, c2, c3 };
}
