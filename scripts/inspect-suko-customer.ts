import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    const phones = ['6281390541340', '081390541340', '81390541340'];
    console.log('Searching customer with phones:', phones);

    const customer = await prisma.customer.findFirst({
      where: {
        OR: phones.map(p => ({ phone: { contains: p } }))
      },
      include: {
        conversations: {
          orderBy: { created_at: 'desc' },
          include: {
            messages: {
              orderBy: { created_at: 'asc' }
            }
          }
        },
        reservations: true
      }
    });

    if (!customer) {
      console.log('Customer NOT found with exact or partial phone.');
      // Search in messages if phone appears in text
      const msgMatch = await prisma.message.findMany({
        where: {
          content: { contains: '1390541340' }
        },
        take: 5,
        include: { conversation: { include: { customer: true } } }
      });
      console.log('Message matches:', msgMatch.length);
      for (const m of msgMatch) {
        console.log(`Msg from conv ${m.conversation_id}, cust: ${m.conversation.customer?.phone}: ${m.content}`);
      }

      // Also search customer whose address contains 'Suko'
      const sukoCusts = await prisma.customer.findMany({
        where: {
          OR: [
            { kelurahan: { contains: 'suko', mode: 'insensitive' } },
            { kecamatan: { contains: 'suko', mode: 'insensitive' } },
            { pending_kelurahan: { contains: 'suko', mode: 'insensitive' } },
            { pending_kecamatan: { contains: 'suko', mode: 'insensitive' } }
          ]
        },
        take: 10,
        orderBy: { updated_at: 'desc' },
        select: { id: true, phone: true, name: true, kelurahan: true, kecamatan: true, kota: true, updated_at: true }
      });
      console.log('Customers with Suko in kelurahan/kecamatan:', JSON.stringify(sukoCusts, null, 2));

      return;
    }

    console.log('=== CUSTOMER DETAILS ===');
    console.log(JSON.stringify({
      id: customer.id,
      phone: customer.phone,
      name: customer.name,
      kelurahan: customer.kelurahan,
      kecamatan: customer.kecamatan,
      kota: customer.kota,
      lat: customer.lat,
      lng: customer.lng,
      distance_km: customer.distance_km,
      ongkir: customer.ongkir,
      location_source: customer.location_source,
      pending_kelurahan: customer.pending_kelurahan,
      pending_kecamatan: customer.pending_kecamatan,
      pending_kota: customer.pending_kota,
      pending_lat: customer.pending_lat,
      pending_lng: customer.pending_lng,
      created_at: customer.created_at,
      updated_at: customer.updated_at,
      conversationsCount: customer.conversations.length,
      reservations: customer.reservations
    }, null, 2));

    for (const conv of customer.conversations) {
      console.log(`\n=== CONVERSATION: ${conv.id} ===`);
      console.log(`Current State: ${conv.current_state}`);
      console.log(`Session Data: ${JSON.stringify(conv.session_data, null, 2)}`);
      console.log(`Messages (${conv.messages.length}):`);
      for (const m of conv.messages) {
        console.log(`[${m.created_at.toISOString()}] ${m.direction} (${m.sender_type || 'N/A'}): ${m.content}`);
      }
    }

  } catch (e: any) {
    console.error('Error during query:', e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
