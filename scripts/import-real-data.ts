import { prisma } from '../db/client';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const filePath = path.resolve(process.cwd(), 'storage', 'real_data_export.json');
  if (!fs.existsSync(filePath)) {
    console.error(`❌ File export tidak ditemukan di ${filePath}`);
    process.exit(1);
  }

  console.log(`📥 [IMPORTER] Membaca data real dari ${filePath}...`);
  const rawData = fs.readFileSync(filePath, 'utf-8');
  const payload = JSON.parse(rawData);

  const customers = payload.customers || [];
  const legacyStagingList = payload.legacyStaging || [];

  console.log(`🚀 [IMPORTER] Memulai impor ${customers.length} data customer riil ke database server...`);

  let importedCustomers = 0;
  let importedChildren = 0;
  let importedReservations = 0;
  let importedConversations = 0;
  let importedMessages = 0;

  for (const c of customers) {
    // 1. Upsert Customer
    const customerRecord = await prisma.customer.upsert({
      where: { id: c.id },
      create: {
        id: c.id,
        tenant_id: c.tenant_id || 'default-tenant',
        phone: c.phone,
        name: c.name,
        kelurahan: c.kelurahan,
        kecamatan: c.kecamatan,
        kota: c.kota,
        lat: c.lat,
        lng: c.lng,
        distance_km: c.distance_km,
        ongkir: c.ongkir,
        is_out_of_coverage: c.is_out_of_coverage || false,
        status: c.status || 'active',
        is_sandbox_test: false,
        is_mql: c.is_mql || false,
        mql_bubble_count: c.mql_bubble_count || 0,
        is_legacy_source: c.is_legacy_source || false,
        created_at: new Date(c.created_at),
        updated_at: new Date(c.updated_at),
      },
      update: {
        name: c.name,
        kelurahan: c.kelurahan,
        kecamatan: c.kecamatan,
        kota: c.kota,
        lat: c.lat,
        lng: c.lng,
        distance_km: c.distance_km,
        ongkir: c.ongkir,
        is_out_of_coverage: c.is_out_of_coverage || false,
        status: c.status || 'active',
        is_sandbox_test: false,
        is_mql: c.is_mql || false,
        mql_bubble_count: c.mql_bubble_count || 0,
        is_legacy_source: c.is_legacy_source || false,
      },
    });
    importedCustomers++;

    // 2. Upsert Children
    if (Array.isArray(c.children)) {
      for (const ch of c.children) {
        await prisma.child.upsert({
          where: { id: ch.id },
          create: {
            id: ch.id,
            tenant_id: ch.tenant_id || 'default-tenant',
            customer_id: customerRecord.id,
            name: ch.name,
            birth_date: ch.birth_date ? new Date(ch.birth_date) : null,
            age_months_at_registration: ch.age_months_at_registration,
            raw_age_text: ch.raw_age_text,
            created_at: new Date(ch.created_at),
            updated_at: new Date(ch.updated_at),
          },
          update: {
            name: ch.name,
            birth_date: ch.birth_date ? new Date(ch.birth_date) : null,
            age_months_at_registration: ch.age_months_at_registration,
            raw_age_text: ch.raw_age_text,
          },
        });
        importedChildren++;
      }
    }

    // 3. Upsert Reservations
    if (Array.isArray(c.reservations)) {
      for (const r of c.reservations) {
        await prisma.reservation.upsert({
          where: { id: r.id },
          create: {
            id: r.id,
            tenant_id: r.tenant_id || 'default-tenant',
            customer_id: customerRecord.id,
            treatment_category: r.treatment_category || 'BABY',
            treatment_detail: r.treatment_detail,
            booking_date: r.booking_date ? new Date(r.booking_date) : null,
            raw_text: r.raw_text,
            status: r.status || 'confirmed',
            purchase_value: r.purchase_value,
            purchase_occurred_at: r.purchase_occurred_at ? new Date(r.purchase_occurred_at) : null,
            purchase_review_status: r.purchase_review_status || 'approved',
            created_at: new Date(r.created_at),
            updated_at: new Date(r.updated_at),
          },
          update: {
            status: r.status,
            raw_text: r.raw_text,
            treatment_detail: r.treatment_detail,
            treatment_category: r.treatment_category || 'BABY',
            purchase_value: r.purchase_value,
            purchase_occurred_at: r.purchase_occurred_at ? new Date(r.purchase_occurred_at) : null,
          },
        });
        importedReservations++;
      }
    }

    // 4. Upsert Conversations & Messages
    if (Array.isArray(c.conversations)) {
      for (const conv of c.conversations) {
        const convRecord = await prisma.conversation.upsert({
          where: { id: conv.id },
          create: {
            id: conv.id,
            tenant_id: conv.tenant_id || 'default-tenant',
            customer_id: customerRecord.id,
            current_state: conv.current_state || 'INITIAL',
            previous_state: conv.previous_state,
            is_human_handling: conv.is_human_handling || false,
            last_message_at: conv.last_message_at ? new Date(conv.last_message_at) : new Date(),
            created_at: new Date(conv.created_at),
            updated_at: new Date(conv.updated_at),
          },
          update: {
            current_state: conv.current_state || 'INITIAL',
            previous_state: conv.previous_state,
            is_human_handling: conv.is_human_handling || false,
            last_message_at: conv.last_message_at ? new Date(conv.last_message_at) : new Date(),
          },
        });
        importedConversations++;

        if (Array.isArray(conv.messages)) {
          for (const msg of conv.messages) {
            await prisma.message.upsert({
              where: { id: msg.id },
              create: {
                id: msg.id,
                tenant_id: msg.tenant_id || 'default-tenant',
                conversation_id: convRecord.id,
                wa_message_id: msg.wa_message_id,
                direction: msg.direction || 'INBOUND',
                content: msg.content,
                sender_type: msg.sender_type || 'BOT',
                sender_name: msg.sender_name,
                payload_raw: msg.payload_raw,
                created_at: new Date(msg.created_at),
                read_at: msg.read_at ? new Date(msg.read_at) : new Date(msg.created_at || Date.now()),
              },
              update: {
                direction: msg.direction,
                content: msg.content,
                payload_raw: msg.payload_raw,
                read_at: msg.read_at ? new Date(msg.read_at) : new Date(msg.created_at || Date.now()),
              },
            });
            importedMessages++;
          }
        }
      }
    }
  }

  // 5. Upsert Legacy Staging
  for (const stg of legacyStagingList) {
    try {
      await prisma.legacyStaging.upsert({
        where: { id: stg.id },
        create: {
          id: stg.id,
          tenantId: stg.tenantId || 'default',
          phoneNumber: stg.phoneNumber,
          name: stg.name,
          extractedLocation: stg.extractedLocation,
          status: stg.status,
          leadCreatedAt: new Date(stg.leadCreatedAt || Date.now()),
          firstPurchaseAt: stg.firstPurchaseAt ? new Date(stg.firstPurchaseAt) : null,
          extractedReservationJson: stg.extractedReservationJson,
          rawMessagesCount: stg.rawMessagesCount || 0,
          rawMessagesJson: stg.rawMessagesJson || [],
          createdAt: new Date(stg.createdAt || Date.now()),
          updatedAt: new Date(stg.updatedAt || Date.now()),
        },
        update: {
          status: stg.status,
          name: stg.name,
          firstPurchaseAt: stg.firstPurchaseAt ? new Date(stg.firstPurchaseAt) : null,
          extractedReservationJson: stg.extractedReservationJson,
        },
      });
    } catch {
      // Abaikan jika duplicate unique constraint
    }
  }

  console.log(`\n🎉 [IMPORTER SUCCESS] Sinkronisasi data real ke database server selesai!`);
  console.log(`   - Customer Real     : ${importedCustomers}`);
  console.log(`   - Data Anak Real    : ${importedChildren}`);
  console.log(`   - Reservasi Real    : ${importedReservations}`);
  console.log(`   - Percakapan Real   : ${importedConversations}`);
  console.log(`   - Pesan Riwayat Real: ${importedMessages}`);
}

main()
  .catch((e) => {
    console.error('❌ Import failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
