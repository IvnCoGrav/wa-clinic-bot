import { prisma } from '../db/client';
import { hashPassword } from '../utils/bcrypt';
import { DEFAULT_TENANT_ID } from '../config/tenant';

async function main() {
  console.log('🚀 Seeding Dummy Data untuk Staff, Live Chat & Jadwal Mendatang...');

  // 1. Pastikan Tenant default ada
  await prisma.tenant.upsert({
    where: { id: DEFAULT_TENANT_ID },
    update: {},
    create: {
      id: DEFAULT_TENANT_ID,
      slug: 'default-tenant',
      name: 'Kala Spa Baby & Mom Homecare',
      whatsapp_number: '6281234567890',
    },
  });

  // 2. Buat Staff Terapis: Bidan Dewi & Bidan Yusi
  const passwordHash = await hashPassword('password123');

  const staffDewi = await prisma.staff.upsert({
    where: { phone: '08123456789' },
    update: {
      name: 'Bidan Dewi',
      password_hash: passwordHash,
      active: true,
    },
    create: {
      tenant_id: DEFAULT_TENANT_ID,
      name: 'Bidan Dewi',
      phone: '08123456789',
      password_hash: passwordHash,
      role: 'THERAPIST',
      active: true,
    },
  });

  const staffYusi = await prisma.staff.upsert({
    where: { phone: '08129876543' },
    update: {
      name: 'Bidan Yusi',
      password_hash: passwordHash,
      active: true,
    },
    create: {
      tenant_id: DEFAULT_TENANT_ID,
      name: 'Bidan Yusi',
      phone: '08129876543',
      password_hash: passwordHash,
      role: 'THERAPIST',
      active: true,
    },
  });

  console.log(`✅ Staff created/updated:`);
  console.log(`   - ${staffDewi.name} (HP: ${staffDewi.phone}, Pass: password123)`);
  console.log(`   - ${staffYusi.name} (HP: ${staffYusi.phone}, Pass: password123)`);

  // Waktu booking hari ini & hari mendatang
  const today = new Date();
  const getTodayAtHour = (hours: number, minutes: number) => {
    const d = new Date(today);
    d.setHours(hours, minutes, 0, 0);
    return d;
  };

  const getFutureDateAtHour = (daysFromNow: number, hours: number, minutes: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + daysFromNow);
    d.setHours(hours, minutes, 0, 0);
    return d;
  };

  const dummyPatients = [
    // --- HARI INI (2 data dummy, nama ditandai TEST, ditugaskan ke Bidan Yusi) ---
    {
      name: 'TEST Bunda Alika',
      phone: '085711110003',
      kelurahan: 'Rungkut Menanggal',
      kecamatan: 'Gunung Anyar',
      kota: 'Surabaya',
      lat: -7.3374,
      lng: 112.7788,
      distance: 4.2,
      ongkir: 25000,
      purchaseValue: 195000,
      isLunas: false,
      childName: 'Alika',
      childAge: '4 bulan',
      category: 'BABY' as const,
      treatment: 'Terapi Pijat Batuk Pilek + Inhalasi Uap Nebulizer',
      time: getTodayAtHour(13, 30),
      rawChat: 'Mau reservasi terapi bapil + nebulizer untuk bayi Alika 4 bulan jam 13.30.',
      chatHistory: [
        { direction: 'INBOUND' as const, sender_type: 'CUSTOMER', content: 'Bidan, adek Alika nafasnya grok-grok dan pilek dari kemarin, bisa dibantu terapi uap?' },
        { direction: 'OUTBOUND' as const, sender_type: 'BOT', sender_name: 'Klinik Bot', content: 'Waalaikumsalam Bunda Alika. Bisa sekali bun, kami ada paket Terapi Bapil (Pijat Dada/Punggung + Nebulizer Steril + Sinar Infra Red) untuk mengencerkan lendir dan melegakan nafas si kecil.' },
        { direction: 'INBOUND' as const, sender_type: 'CUSTOMER', content: 'Tolong booked jam 13.30 ya bidan, kasian adek rewel terus.' },
        { direction: 'OUTBOUND' as const, sender_type: 'BOT', sender_name: 'Klinik Bot', content: 'Siap Bunda Alika! Jadwal jam 13:30 WIB telah kami jadwalkan bersama Bidan Yusi.' },
      ],
    },
    {
      name: 'TEST Bunda Dinda',
      phone: '085711110004',
      kelurahan: 'Sedati Agung',
      kecamatan: 'Sedati',
      kota: 'Sidoarjo',
      lat: -7.3822,
      lng: 112.7667,
      distance: 5.1,
      ongkir: 30000,
      purchaseValue: 175000,
      isLunas: false,
      childName: 'Rayyan',
      childAge: '8 bulan',
      category: 'BABY' as const,
      treatment: 'Pijat Pulih Ceria (Kembung, Kolik & Sembelit)',
      time: getTodayAtHour(15, 30),
      rawChat: 'Booking pijat perut kembung untuk adik Rayyan jam 15.30 Sedati Agung.',
      chatHistory: [
        { direction: 'INBOUND' as const, sender_type: 'CUSTOMER', content: 'Sore Bu Bidan, perut adik Rayyan keras kembung dan belum BAB 2 hari.' },
        { direction: 'OUTBOUND' as const, sender_type: 'BOT', sender_name: 'Klinik Bot', content: 'Sore Bunda Dinda. Gejala kembung & kolik bisa dibantu dengan Pijat Pulih Ceria (teknik I Love You massage & gowes kaki) dengan minyak herbal telon khusus.' },
        { direction: 'INBOUND' as const, sender_type: 'CUSTOMER', content: 'Oke bund ambil jam 15.30 sore ya di Sedati Agung Sidoarjo.' },
        { direction: 'OUTBOUND' as const, sender_type: 'BOT', sender_name: 'Klinik Bot', content: 'Jadwal jam 15:30 WIB terkonfirmasi ya Bunda Dinda. Nanti Bidan Yusi yang akan berkunjung.' },
      ],
    },
  ];

  for (let i = 0; i < dummyPatients.length; i++) {
    const item = dummyPatients[i];

    // 3. Upsert Customer dengan lat, lng, ongkir & is_sandbox_test: true
    const customer = await prisma.customer.upsert({
      where: { phone: item.phone },
      update: {
        name: item.name,
        kelurahan: item.kelurahan,
        kecamatan: item.kecamatan,
        kota: item.kota,
        lat: item.lat,
        lng: item.lng,
        distance_km: item.distance,
        ongkir: item.ongkir,
        is_sandbox_test: true,
      },
      create: {
        tenant_id: DEFAULT_TENANT_ID,
        phone: item.phone,
        name: item.name,
        kelurahan: item.kelurahan,
        kecamatan: item.kecamatan,
        kota: item.kota,
        lat: item.lat,
        lng: item.lng,
        distance_km: item.distance,
        ongkir: item.ongkir,
        is_sandbox_test: true,
      },
    });

    // 4. Upsert Child
    await prisma.child.upsert({
      where: {
        customer_id_name: {
          customer_id: customer.id,
          name: item.childName,
        },
      },
      update: {
        raw_age_text: item.childAge,
      },
      create: {
        tenant_id: DEFAULT_TENANT_ID,
        customer_id: customer.id,
        name: item.childName,
        raw_age_text: item.childAge,
      },
    });

    // 5. Create Conversation & Messages (jika ada chatHistory)
    if (item.chatHistory && item.chatHistory.length > 0) {
      let conversation = await prisma.conversation.findFirst({
        where: {
          tenant_id: DEFAULT_TENANT_ID,
          customer_id: customer.id,
        },
      });

      if (!conversation) {
        conversation = await prisma.conversation.create({
          data: {
            tenant_id: DEFAULT_TENANT_ID,
            customer_id: customer.id,
            current_state: 'COMPLETED',
            is_human_handling: false,
            last_message_at: new Date(),
          },
        });
      }

      await prisma.message.deleteMany({
        where: { conversation_id: conversation.id },
      });

      for (let m = 0; m < item.chatHistory.length; m++) {
        const msg = item.chatHistory[m];
        await prisma.message.create({
          data: {
            tenant_id: DEFAULT_TENANT_ID,
            conversation_id: conversation.id,
            direction: msg.direction,
            sender_type: msg.sender_type,
            sender_name: msg.sender_name,
            content: msg.content,
            created_at: new Date(Date.now() - (item.chatHistory.length - m) * 60000),
          },
        });
      }
    }

    // 6. Create Reservation assigned to Bidan Yusi
    await prisma.reservation.deleteMany({
      where: { customer_id: customer.id },
    });

    const reservation = await prisma.reservation.create({
      data: {
        tenant_id: DEFAULT_TENANT_ID,
        customer_id: customer.id,
        treatment_category: item.category,
        treatment_detail: item.treatment,
        booking_date: item.time,
        raw_text: item.rawChat,
        status: 'confirmed',
        assigned_staff_id: staffYusi.id,
        purchase_value: item.purchaseValue,
        purchase_occurred_at: item.isLunas ? new Date(Date.now() - 3600000) : null,
      },
    });

    const isToday = item.time.toDateString() === today.toDateString();
    console.log(
      `✅ [${i + 1}/${dummyPatients.length}] Reservasi ${item.name} (${item.childName}) - ${
        isToday ? 'Hari Ini' : item.time.toLocaleDateString('id-ID')
      } ${item.time.toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
      })} WIB | GPS: ${item.lat}, ${item.lng} -> Assigned to ${staffYusi.name}`
    );
  }

  console.log('\n🎉 Selesai! Data dummy tugas hari ini & jadwal mendatang telah berhasil dibuat.');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
