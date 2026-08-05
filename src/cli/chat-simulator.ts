import readline from 'readline';
import { prisma } from '../db/client';
import { MockWAHAClient } from './mock-waha-client';
import { TypingService } from '../services/typing.service';
import { ConversationStateMachine } from '../state-machine/machine';
import { customerService } from '../services/customer.service';
import { conversationService } from '../services/conversation.service';
import { DEFAULT_TENANT_ID } from '../config/tenant';

async function startSimulator() {
  const mockClient = new MockWAHAClient();
  const cliTypingService = new TypingService(mockClient);
  const cliStateMachine = new ConversationStateMachine(cliTypingService);

  const dummyPhone = '6281234567890';
  const dummyChatId = '6281234567890@c.us';
  let msgCounter = 1;

  // Tandai customer test sebagai QA TEST (is_sandbox_test=true) — wajib agar data
  // simulasi tidak mencemari pelanggan asli (lihat .agents/skills/qa-test-labeling/SKILL.md).
  const markSandboxTest = async (customer: any): Promise<any> => {
    try {
      if (!customer.is_sandbox_test) {
        await prisma.customer.update({
          where: { id: customer.id },
          data: { is_sandbox_test: true },
        });
      }
    } catch (e) {
      // best-effort — jangan menggagalkan simulasi bila DB offline
    }
    return customer;
  };

  console.clear();
  console.log('\x1b[36m\x1b[1m===============================================================');
  console.log('   🏥 WAHA CLINIC BOT - CLI CHAT SIMULATOR (INTERACTIVE)');
  console.log('===============================================================\x1b[0m');
  console.log('\x1b[90mCommand interaktif:');
  console.log('  /location <lat>,<lng>  : Simulasikan share lokasi WhatsApp (contoh: /location -7.2574,112.7520)');
  console.log('  /speed <faktor>        : Atur kecepatan simulasi delay (contoh: /speed 2 untuk 2x lebih cepat)');
  console.log('  exit / quit            : Keluar dari simulator CLI\x1b[0m\n');
  console.log('\x1b[90mPerintah yang diketik juga mengalir lewat state machine, jadi command customer asli');
  console.log('  (/reset, /state, /mulai) ikut diuji di sini sama seperti di WhatsApp.\x1b[0m\n');
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

    if (input === '/reset' || input === '/state' || input === '/mulai' || input === '/start') {
      // Command customer asli (/reset, /state, /mulai) dibiarkan mengalir lewat state machine
      // supaya parity dgn WhatsApp. markSandboxTest memastikan customer simulasi diberi tag
      // QA TEST (is_sandbox_test=true) supaya tidak mencemari data pelanggan asli.
      await markSandboxTest(
        await customerService.getOrCreateCustomer(dummyPhone, 'CLI Tester', DEFAULT_TENANT_ID)
      );
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
      const customer = await markSandboxTest(
        await customerService.getOrCreateCustomer(dummyPhone, 'CLI Tester', DEFAULT_TENANT_ID)
      );
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
