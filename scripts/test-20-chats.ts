import { MockWAHAClient } from '../src/cli/mock-waha-client';
import { TypingService } from '../src/services/typing.service';
import { ConversationStateMachine } from '../src/state-machine/machine';
import { customerService } from '../src/services/customer.service';
import { conversationService } from '../src/services/conversation.service';
import { ConversationState } from '@prisma/client';
import { DEFAULT_TENANT_ID } from '../src/config/tenant';

class CustomCaptureClient extends MockWAHAClient {
  public lastReply: string = '';
  public allReplies: string[] = [];

  async sendTextMessage(chatId: string, text: string): Promise<any> {
    this.lastReply = text;
    this.allReplies.push(text);
    return super.sendTextMessage(chatId, text);
  }
}

async function run20ChatsTest() {
  const mockClient = new CustomCaptureClient();
  const typingService = new TypingService(mockClient);
  typingService.setSpeedFactor(100); // Super fast execution for test
  const stateMachine = new ConversationStateMachine(typingService);

  const phone = '628999888777';
  const chatId = `${phone}@c.us`;

  // Reset State & Customer
  const customer = await customerService.getOrCreateCustomer(phone, 'Customer Testing', DEFAULT_TENANT_ID);
  const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
  
  await conversationService.updateConversationState(
    conversation.id,
    {
      currentState: ConversationState.INITIAL,
      previousState: null,
      locationAttempts: 0,
      isHumanHandling: false,
      humanHandlingSince: null,
    },
    DEFAULT_TENANT_ID
  );
  await customerService.resetFullLocation(customer.id, DEFAULT_TENANT_ID);

  const messages20 = [
    // Chat 1: Greeting awal
    { label: 'Chat 1 (Greeting)', text: 'Halo, selamat siang mba admin' },
    
    // Chat 2: Pengiriman Lokasi (Kelurahan di Surabaya)
    { label: 'Chat 2 (Kirim Lokasi)', text: 'Lokasi saya di Kelurahan Gubeng, Surabaya' },
    
    // Chat 3: Konfirmasi Lokasi & Ongkir
    { label: 'Chat 3 (Konfirmasi Lokasi)', text: 'Wah gratis ongkir ya, sip bener Gubeng Surabaya' },

    // Chat 4: Pertanyaan Layanan Umum
    { label: 'Chat 4 (Tanya Layanan)', text: 'Klinik ini melayani treatment apa saja ya untuk baby dan bunda?' },

    // Chat 5: Pertanyaan FAQ Spesifik (Baby Spa)
    { label: 'Chat 5 (FAQ Baby Spa)', text: 'Kalau Baby Spa itu durasinya berapa lama dan manfaatnya apa ya kak?' },

    // Chat 6: Pertanyaan Tarif / Biaya
    { label: 'Chat 6 (Tanya Biaya)', text: 'Berapa biaya untuk massage bayi dan facial glowing bunda?' },

    // Chat 7: Pertanyaan Usia Bayi
    { label: 'Chat 7 (Syarat Usia)', text: 'Bayi saya usia 4 bulan, apakah sudah aman untuk di-spa?' },

    // Chat 8: Menyampaikan Minat Booking
    { label: 'Chat 8 (Tertarik Booking)', text: 'Saya tertarik mau booking buat baby spa dan facial glowing bunda' },

    // Chat 9: Form Reservasi
    { 
      label: 'Chat 9 (Form Reservasi)', 
      text: `Berikut list untuk reservasi:
- Nama Bunda: Bunda Rina
- Nama Dekbay: Dek Kenzo (4 bulan)
- Alamat: Jl. Gubeng Jaya No. 15, Surabaya
- Pilihan Treatment: Baby Spa + Facial Glowing
- Tanggal & Jam: Sabtu, 10 Agustus 2026 jam 10.00` 
    },

    // Chat 10: Pertanyaan Jadwal / Slot
    { label: 'Chat 10 (Cek Slot)', text: 'Apakah jam 10.00 di hari Sabtu itu masih ada slot kosong ya admin?' },

    // Chat 11: Pertanyaan Persiapan
    { label: 'Chat 11 (Persiapan)', text: 'Apakah harus bawa handuk atau perlengkapan sendiri dari rumah?' },

    // Chat 12: Pertanyaan Metode Pembayaran
    { label: 'Chat 12 (Metode Pembayaran)', text: 'Untuk pembayarannya apakah bisa bayar di tempat setelah selesai atau harus DP dulu?' },

    // Chat 13: Pertanyaan Sertifikasi Terapis
    { label: 'Chat 13 (Profil Terapis)', text: 'Terapis yang menangani baby apakah bidan bersertifikat resmi?' },

    // Chat 14: Konfirmasi Homecare
    { label: 'Chat 14 (Konfirmasi Homecare)', text: 'Ini layanannya terapis yang datang langsung ke rumah kan ya?' },

    // Chat 15: Penambahan Treatment (Pijat GTM)
    { label: 'Chat 15 (Tambah Treatment)', text: 'Oh ya bund, dekbay lagi agak susah makan, bisa sekalian tambah Pijat GTM / Nafsu Makan?' },

    // Chat 16: Estimasi Kedatangan Terapis
    { label: 'Chat 16 (Kedatangan Terapis)', text: 'Terapis biasanya datang berapa menit sebelum jam perawatan ya?' },

    // Chat 17: Catatan Patokan Alamat
    { label: 'Chat 17 (Patokan Rumah)', text: 'Patokan rumah saya di sebelah toko kelontong pagar hijau ya kak' },

    // Chat 18: Ucapan Terima Kasih
    { label: 'Chat 18 (Apresiasi)', text: 'Baik kak, terima kasih banyak informasinya sangat jelas' },

    // Chat 19: Kontak CS
    { label: 'Chat 19 (Tanya Kontak)', text: 'Kalau nanti ada perubahan jam saya bisa hubungi nomor WA ini lagi kan?' },

    // Chat 20: Closing
    { label: 'Chat 20 (Closing)', text: 'Oke terimakasih admin, selamat siang!' }
  ];

  console.log('================================================================================');
  console.log('🧪 MULAI SIMULASI PENGUJIAN PERCAKAPAN 20 CHAT SYSTEM CHATBOT CLINIC WAHA');
  console.log('================================================================================\n');

  let step = 1;
  const results = [];

  for (const msg of messages20) {
    mockClient.allReplies = [];
    mockClient.lastReply = '';

    const currentCustomer = await customerService.getOrCreateCustomer(phone, 'Customer Testing', DEFAULT_TENANT_ID);
    const currentConv = await conversationService.getOrCreateConversation(currentCustomer.id, DEFAULT_TENANT_ID);
    const stateBefore = currentConv.current_state;
    const isHumanBefore = currentConv.is_human_handling;

    const incomingPayload = {
      id: `sim_msg_${Date.now()}_${step}`,
      chatId,
      from: phone,
      type: 'text',
      text: { body: msg.text },
      timestamp: Math.floor(Date.now() / 1000),
    };

    const res = await stateMachine.processMessage({
      tenantId: DEFAULT_TENANT_ID,
      customer: currentCustomer,
      conversation: currentConv,
      incomingMessage: incomingPayload,
    });

    const updatedCustomer = await customerService.getOrCreateCustomer(phone, 'Customer Testing', DEFAULT_TENANT_ID);
    const updatedConv = await conversationService.getOrCreateConversation(updatedCustomer.id, DEFAULT_TENANT_ID);
    const stateAfter = updatedConv.current_state;
    const isHumanAfter = updatedConv.is_human_handling;
    const replies = mockClient.allReplies.length > 0 ? mockClient.allReplies.join('\n\n--- [Bubble Separator] ---\n\n') : (res.replyText || '(Tidak ada balasan otomatis / Human Handling)');

    console.log(`--------------------------------------------------------------------------------`);
    console.log(`📱 CHAT #${step}: ${msg.label}`);
    console.log(`👤 Customer: "${msg.text.replace(/\n/g, ' ')}"`);
    console.log(`🔄 Transisi State: [${stateBefore}${isHumanBefore ? ' (HUMAN)' : ''}] ➔ [${stateAfter}${isHumanAfter ? ' (HUMAN)' : ''}]`);
    console.log(`🤖 Respon AI/Bot:\n${replies}`);
    console.log(`--------------------------------------------------------------------------------\n`);

    results.push({
      step,
      label: msg.label,
      userMessage: msg.text,
      stateBefore: `${stateBefore}${isHumanBefore ? ' (HUMAN)' : ''}`,
      stateAfter: `${stateAfter}${isHumanAfter ? ' (HUMAN)' : ''}`,
      botReply: replies,
      shouldSendReply: res.shouldSendReply,
      isHumanHandling: isHumanAfter,
    });

    step++;
  }

  console.log('================================================================================');
  console.log('✅ SIMULASI 20 CHAT SELESAI!');
  console.log('================================================================================');
}

run20ChatsTest().catch((err) => {
  console.error('Fatal error in simulation test:', err);
  process.exit(1);
});
