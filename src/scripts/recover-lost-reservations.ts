#!/usr/bin/env tsx
/**
 * recover-lost-reservations.ts — Catch reservasi yang terlewat (Siska #777 dkk)
 * Scan messages INBOUND yang berisi form reservasi tapi belum punya Reservation.
 * Idempoten 24h by treatment_detail, tenant-aware, fire CAPI InitiateCheckout.
 *
 * Usage (di server):
 *   npx tsx src/scripts/recover-lost-reservations.ts --dry-run
 *   npx tsx src/scripts/recover-lost-reservations.ts --execute --days=30 --limit=500
 *   npx tsx src/scripts/recover-lost-reservations.ts --execute --phone=628xxx
 */
import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { isReservationFormMessage, parseReservationText } from '../utils/reservation-text-parser';
import { reservationLifecycleService } from '../services/reservation-lifecycle.service';
import { fireCapiEvent } from '../services/capi.service';

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || !args.includes('--execute');
  const daysArg = args.find(a => a.startsWith('--days='))?.split('=')[1];
  const days = daysArg ? parseInt(daysArg, 10) : 30;
  const limitArg = args.find(a => a.startsWith('--limit='))?.split('=')[1];
  const limit = limitArg ? parseInt(limitArg, 10) : 500;
  const phoneFilter = args.find(a => a.startsWith('--phone='))?.split('=')[1];
  const nameFilter = args.find(a => a.startsWith('--name='))?.split('=')[1];

  console.log(`[RECOVER] dryRun=${dryRun} days=${days} limit=${limit} phone=${phoneFilter||'-'} name=${nameFilter||'-'}`);

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Ambil messages inbound yang kandidat form (optimasi: filter berisi keyword header)
  const messages: any[] = await (prisma as any).message.findMany({
    where: {
      tenant_id: DEFAULT_TENANT_ID,
      direction: 'INBOUND' as any,
      created_at: { gte: since },
      ...(phoneFilter ? { conversation: { customer: { phone: { contains: phoneFilter } } } } : {}),
    },
    include: {
      conversation: {
        include: { customer: true },
      },
    },
    orderBy: { created_at: 'desc' },
    take: 2000,
  });

  // Filter di memory dengan isReservationFormMessage (toleran, persis webhook)
  let candidates = messages.filter(m => m.content && isReservationFormMessage(m.content));
  if (nameFilter) {
    const nf = nameFilter.toLowerCase();
    candidates = candidates.filter(m => m.content.toLowerCase().includes(nf) || (m.conversation?.customer?.name||'').toLowerCase().includes(nf));
  }
  if (candidates.length > limit) candidates = candidates.slice(0, limit);

  console.log(`[RECOVER] candidates form messages: ${candidates.length} (dari ${messages.length} messages scan)`);

  let created = 0, skippedExists = 0, parseFail = 0, skippedDry = 0;

  for (const msg of candidates) {
    const customer = msg.conversation?.customer;
    if (!customer) { parseFail++; continue; }
    const raw = msg.content as string;
    const pr = parseReservationText(raw);
    if (!pr.success || !pr.reservation) {
      console.log(`[SKIP PARSE FAIL] msg ${msg.id} customer ${customer.phone} (${customer.name||'-'}) — ${pr.error} missing=${pr.missingFields?.join(',')}`);
      parseFail++;
      continue;
    }
    const p = pr.reservation;

    // Idempoten: cek reservasi 24h dengan treatment_detail sama untuk customer ini
    const recent = await prisma.reservation.findFirst({
      where: {
        customer_id: customer.id,
        tenant_id: DEFAULT_TENANT_ID,
        created_at: { gte: new Date(Date.now() - 24*60*60*1000) },
        treatment_detail: p.treatmentDetail,
      },
    });
    if (recent) {
      skippedExists++;
      continue;
    }

    // Juga cek global: jika raw_text sudah ada persis (duplikat pesan yang di-log 2x)
    const sameRaw = await prisma.reservation.findFirst({
      where: { customer_id: customer.id, raw_text: raw },
    });
    if (sameRaw) { skippedExists++; continue; }

    if (dryRun) {
      console.log(`[DRY WOULD CREATE] ${customer.phone} (${customer.name||'-'}) — ${p.treatmentDetail} | raw: ${raw.slice(0,80).replace(/\n/g,' ')}...`);
      skippedDry++;
      continue;
    }

    const reservation = await prisma.reservation.create({
      data: {
        tenant_id: DEFAULT_TENANT_ID,
        customer_id: customer.id,
        treatment_category: p.treatmentCategory,
        treatment_detail: p.treatmentDetail,
        booking_date: p.bookingDate,
        raw_text: raw,
        status: 'pending',
      },
    });
    console.log(`[CREATED] reservation ${reservation.id} untuk ${customer.phone} (${p.name||customer.name}) — ${p.treatmentDetail}`);

    await reservationLifecycleService.onReservationCreated({
      customerId: customer.id,
      reservationId: reservation.id,
      tenantId: DEFAULT_TENANT_ID,
      chatId: `${customer.phone}@c.us`,
      babies: p.babies || [],
    });

    // Update nama kontak jika ada nama baru di form
    const cname = p.name?.trim();
    if (cname && cname.toLowerCase() !== 'bunda' && cname.length>1) {
      const kec = customer.kecamatan || '';
      const contact = `Bunda ${cname}${kec?` ${kec}`:''}`.trim();
      try {
        const { customerService } = await import('../services/customer.service');
        await customerService.updateCustomerName(customer.id, contact, DEFAULT_TENANT_ID);
        console.log(`  -> updateCustomerName: ${contact}`);
      } catch {}
    }

    // Meta CAPI InitiateCheckout — agar capi-queue & Meta tidak lose
    try {
      fireCapiEvent({ eventName: 'InitiateCheckout', customer, tenantId: DEFAULT_TENANT_ID, customData: { source: 'RECOVER_LOST_RESERVATIONS', treatment: p.treatmentDetail } });
      console.log(`  -> CAPI InitiateCheckout fired`);
    } catch (e: any) { console.warn(`  -> CAPI fail: ${e.message}`); }

    created++;

    // Jika filter phone/name spesifik (Siska), cukup 1
    if (phoneFilter && created >= 5) break;
  }

  console.log(`[RECOVER DONE] created=${created} skippedExists=${skippedExists} parseFail=${parseFail} dryWould=${skippedDry} dryRun=${dryRun}`);
  if (dryRun) console.log('Jalankan dengan --execute untuk benar-benar membuat reservasi.');
}

main().catch(e => { console.error(e); process.exit(1); }).finally(()=> prisma.$disconnect?.());
