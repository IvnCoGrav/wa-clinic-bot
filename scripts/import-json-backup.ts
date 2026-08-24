import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'

const prisma = new PrismaClient()

async function main() {
  let raw = fs.readFileSync('C:\\temp\\backup.sql', 'utf-8')
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1)
  const data = JSON.parse(raw)
  const tables = data.tables

  const tenantId = 'default-tenant'

  console.log('Starting import...')

  // 1. Services (unique: tenant_id + service_id)
  if (tables.services?.length) {
    console.log(`Importing ${tables.services.length} services...`)
    for (const s of tables.services) {
      await prisma.clinicService.upsert({
        where: { tenant_id_service_id: { tenant_id: tenantId, service_id: s.service_id } },
        update: { ...s, tenant_id: tenantId },
        create: { ...s, tenant_id: tenantId },
      })
    }
  }

  // 2. Delivery Tiers (unique: id)
  if (tables.deliveryTiers?.length) {
    console.log(`Importing ${tables.deliveryTiers.length} delivery tiers...`)
    for (const d of tables.deliveryTiers) {
      await prisma.deliveryTier.upsert({
        where: { id: d.id },
        update: { ...d, tenant_id: tenantId },
        create: { ...d, tenant_id: tenantId },
      })
    }
  }

  // 3. Staff (unique: phone)
  if (tables.staff?.length) {
    console.log(`Importing ${tables.staff.length} staff...`)
    for (const s of tables.staff) {
      await prisma.staff.upsert({
        where: { phone: s.phone },
        update: { ...s, tenant_id: tenantId },
        create: { ...s, tenant_id: tenantId },
      })
    }
  }

  // 4. Personas (unique: tenant_id)
  if (tables.personas?.length) {
    console.log(`Importing ${tables.personas.length} personas...`)
    for (const p of tables.personas) {
      await prisma.tenantPersona.upsert({
        where: { tenant_id: tenantId },
        update: { ...p, tenant_id: tenantId },
        create: { ...p, tenant_id: tenantId },
      })
    }
  }

  // 5. AI Configs (unique: tenant_id + task)
  if (tables.aiConfigs?.length) {
    console.log(`Importing ${tables.aiConfigs.length} AI configs...`)
    for (const a of tables.aiConfigs) {
      await prisma.tenantAiConfig.upsert({
        where: { tenant_id_task: { tenant_id: tenantId, task: a.task } },
        update: { ...a, tenant_id: tenantId },
        create: { ...a, tenant_id: tenantId },
      })
    }
  }

  // 6. Customers (unique: phone)
  if (tables.customers?.length) {
    console.log(`Importing ${tables.customers.length} customers...`)
    for (const c of tables.customers) {
      const { labels, children, ai_override, ...rest } = c
      await prisma.customer.upsert({
        where: { phone: c.phone },
        update: { ...rest, tenant_id: tenantId },
        create: { ...rest, tenant_id: tenantId },
      })
    }
  }

  // 7. Reservations (unique: id) - before children due to FK
  if (tables.reservations?.length) {
    console.log(`Importing ${tables.reservations.length} reservations...`)
    for (const r of tables.reservations) {
      await prisma.reservation.upsert({
        where: { id: r.id },
        update: { ...r, tenant_id: tenantId },
        create: { ...r, tenant_id: tenantId },
      })
    }
  }

  // 8. Children (unique: customer_id + name)
  if (tables.children?.length) {
    console.log(`Importing ${tables.children.length} children...`)
    for (const c of tables.children) {
      await prisma.child.upsert({
        where: { customer_id_name: { customer_id: c.customer_id, name: c.name } },
        update: { ...c, tenant_id: tenantId },
        create: { ...c, tenant_id: tenantId },
      })
    }
  }

  // 9. Knowledge Chunks (unique: id)
  if (tables.knowledgeChunks?.length) {
    console.log(`Importing ${tables.knowledgeChunks.length} knowledge chunks...`)
    for (const k of tables.knowledgeChunks) {
      await prisma.knowledgeChunk.upsert({
        where: { id: k.id },
        update: { ...k, tenant_id: tenantId },
        create: { ...k, tenant_id: tenantId },
      })
    }
  }

  console.log('Import complete!')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })