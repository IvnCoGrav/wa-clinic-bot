import readline from 'readline';
import { MockWAHAClient } from './mock-waha-client';
import { TypingService } from '../services/typing.service';
import { ConversationStateMachine } from '../state-machine/machine';
import { customerService } from '../services/customer.service';
import { conversationService } from '../services/conversation.service';
import { ConversationState } from '@prisma/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';

async function startSimulator() {
  const mockClient = new MockWAHAClient();
  const cliTypingService = new TypingService(mockClient);
  const cliStateMachine = new ConversationStateMachine(cliTypingService);

  const dummyPhone = '6281234567890';
  const dummyChatId = '6281234567890@c.us';
  let msgCounter = 1;

  console.clear();
  console.log('\x1b[36m\x1b[1m===============================================================');
  console.log('   🏥 WAHA CLINIC BOT - CLI CHAT SIMULATOR (INTERACTIVE)');
  console.log('===============================================================\x1b[0m');
  console.log('\x1b[90mCommand interaktif:');
  console.log('  /location <lat>,<lng>  : Simulasikan share lokasi WhatsApp (contoh: /location -7.2574,112.7520)');
  console.log('  /reset                 : Reset percakapan ke state awal (INITIAL) + hapus lokasi customer');
  console.log('  /state                 : Lihat state internal percakapan (current_state, attempts, dll)');
  console.log('  /speed <faktor>        : Atur kecepatan simulasi delay (contoh: /speed 2 untuk 2x lebih cepat)');
  console.log('  exit / quit            : Keluar dari simulator CLI\x1b[0m\n');
  console.log('\x1b[90mUntuk form reservasi multi-line: mulai ketik "Berikut list untuk reservasi",\n  lalu paste baris-baris form, akhiri dengan BARIS KOSONG.\x1b[0m\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // State untuk mode input multi-line (form reservasi yang panjang)
  let multilineBuffer: string[] | null = null;

  const processInput = async (raw: string) => {
    const input = raw.trim();
    if (!input) {
      // Baris kosong di luar mode multi-line -> abaikan, prompt ulang
      if (multilineBuffer === null) promptUser();
      return;
    }

    if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
      console.log('\n\x1b[36mExiting CLI Chat Simulator. Sampai jumpa! 👋\x1b[0m\n');
      process.exit(0);
    }

    // --- Mode multi-line: kumpulkan baris sampai baris kosong ---
    if (multilineBuffer !== null) {
      if (input === '') {
        // Akhiri mode multi-line, proses seluruh buffer sebagai satu pesan
        const fullMessage = multilineBuffer.join('\n');
        multilineBuffer = null;
        console.log('\x1b[2m[SYSTEM] Multi-line input selesai. Proses sebagai 1 pesan...\x1b[0m\n');
        await processInput(fullMessage);
        return;
      }
      multilineBuffer.push(input);
      rl.question('\x1b[2m└ ... (baris berikutnya / kosong utk selesai)\x1b[0m ', async (nextLine) => {
        await processInput(nextLine);
      });
      return;
    }

    // --- Deteksi awal form reservasi multi-line ---
    if (input.toLowerCase().includes('berikut list untuk reservasi')) {
      multilineBuffer = [input];
      console.log('\x1b[2m[SYSTEM] Mode multi-line aktif. Paste baris-baris form, akhiri dengan baris kosong.\x1b[0m');
      rl.question('\x1b[2m└ ... (baris berikutnya / kosong utk selesai)\x1b[0m ', async (nextLine) => {
        await processInput(nextLine);
      });
      return;
    }

    if (input === '/reset') {
      const customer = await customerService.getOrCreateCustomer(dummyPhone, 'CLI Tester', DEFAULT_TENANT_ID);
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
      // Reset penuh lokasi customer (pending + confirmed) supaya simulasi mulai dari nol
      await customerService.resetFullLocation(customer.id, DEFAULT_TENANT_ID);
      console.log('\x1b[32m[SYSTEM] State percakapan berhasil di-reset ke INITIAL (termasuk lokasi customer).\x1b[0m\n');
      promptUser();
      return;
    }

    if (input === '/state') {
      const customer = await customerService.getOrCreateCustomer(dummyPhone, 'CLI Tester', DEFAULT_TENANT_ID);
      const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
      console.log('\x1b[35m\n--- [INTERNAL STATE DEBUG] ---');
      console.log(`Customer Phone    : ${customer.phone}`);
      console.log(`Current State     : ${conversation.current_state}`);
      console.log(`Previous State    : ${conversation.previous_state || 'null'}`);
      console.log(`Location Attempts : ${conversation.location_attempts}`);
      console.log(`Is Human Handling : ${conversation.is_human_handling}`);
      console.log(`Coverage Status   : ${customer.is_out_of_coverage ? 'OUT OF COVERAGE' : 'IN COVERAGE'}`);
      console.log(`Speed Factor      : ${cliTypingService.getSpeedFactor()}x\x1b[0m\n`);
      promptUser();
      return;
    }

    if (input.startsWith('/speed')) {
      const parts = input.split(/\s+/);
      const factor = parseFloat(parts[1] || '1');
      if (isNaN(factor) || factor <= 0) {
        console.log('\x1b[31m[SYSTEM] Format speed tidak valid. Gunakan: /speed <angka> (contoh: /speed 2)\x1b[0m\n');
      } else {
        cliTypingService.setSpeedFactor(factor);
        console.log(`\x1b[32m[SYSTEM] Kecepatan simulasi diubah ke ${factor}x.\x1b[0m\n`);
      }
      promptUser();
      return;
    }

    // Build incoming message payload
    let incomingMessage: any;
    if (input.startsWith('/location')) {
      const coordsStr = input.replace('/location', '').trim();
      const coords = coordsStr.split(',');
      const lat = parseFloat(coords[0]);
      const lng = parseFloat(coords[1]);

      if (isNaN(lat) || isNaN(lng)) {
        console.log('\x1b[31m[SYSTEM] Format koordinat tidak valid. Gunakan: /location <lat>,<lng> (contoh: /location -7.2574,112.7520)\x1b[0m\n');
        promptUser();
        return;
      }

      incomingMessage = {
        id: `cli_msg_${Date.now()}_${msgCounter++}`,
        chatId: dummyChatId,
        from: dummyPhone,
        type: 'location',
        location: {
          latitude: lat,
          longitude: lng,
          name: 'CLI Shared Location',
        },
        timestamp: Math.floor(Date.now() / 1000),
      };
    } else {
      incomingMessage = {
        id: `cli_msg_${Date.now()}_${msgCounter++}`,
        chatId: dummyChatId,
        from: dummyPhone,
        type: 'text',
        text: {
          body: input,
        },
        timestamp: Math.floor(Date.now() / 1000),
      };
    }

    try {
      const customer = await customerService.getOrCreateCustomer(dummyPhone, 'CLI Tester', DEFAULT_TENANT_ID);
      const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

      // Process state machine message
      await cliStateMachine.processMessage({
        tenantId: DEFAULT_TENANT_ID,
        customer,
        conversation,
        incomingMessage,
      });
    } catch (err: any) {
      console.error('\x1b[31m[CLI ERROR] Error processing input:\x1b[0m', err?.message || err);
    }

    promptUser();
  };

  const promptUser = () => {
    rl.question('\x1b[33m\x1b[1mYou: \x1b[0m', async (line) => {
      await processInput(line);
    });
  };

  promptUser();
}

startSimulator();
