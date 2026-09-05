import { describe, it, expect } from 'vitest';
import { DynamicCloserService } from '../../src/slot-engine/dynamic-closer.service';
import { ConversationStateSummarizer } from '../../src/slot-engine/conversation-summarizer';
import { CustomerSlate, ExtractedEntities } from '../../src/slot-engine/types';

describe('Dynamic Closer Pacing & Cool-Off Tests', () => {
  const baseSlate: CustomerSlate = {
    customerId: 'cust-pacing-test',
    phone: '628113399397',
    tenantId: 'default-tenant',
    isLocationConfirmed: false,
    kelurahan: null,
    kecamatan: null,
    kota: null,
    distanceKm: null,
    ongkirFee: null,
    ongkirPromoFee: null,
    childAgeMonths: 4,
    childAgeCategory: 'BABY',
    selectedTreatmentName: 'Pijat Bayi Pulih Ceria',
    medicalConcerns: [],
    symptoms: ['batuk', 'pilek', 'grok'],
    isOutOfCoverage: false,
    reservationFormSent: false,
    lastInteractionAt: new Date().toISOString(),
    conversationState: 'COLLECTING_SLOTS',
  };

  it('1. hasAskedLocationRecently mendeteksi pertanyaan lokasi dalam 2 balasan terakhir', () => {
    const historyWithLoc = [
      { role: 'user', content: 'Mau tanya pijat bayi batuk pilek' },
      { role: 'assistant', content: 'Tentu Bunda, kalau boleh tahu rumah Bunda di daerah atau kelurahan mana ya? 😊' },
    ];
    expect(DynamicCloserService.hasAskedLocationRecently(historyWithLoc, 2)).toBe(true);

    const historyWithoutLoc = [
      { role: 'user', content: 'Halo' },
      { role: 'assistant', content: 'Waalaikumsalam Bunda! Ada yang bisa kami bantu? 😊' },
    ];
    expect(DynamicCloserService.hasAskedLocationRecently(historyWithoutLoc, 2)).toBe(false);
  });

  it('2. hasAskedScheduleRecently mendeteksi pertanyaan jadwal dalam 2 balasan terakhir', () => {
    const historyWithSched = [
      { role: 'user', content: 'Bisa pijat bayi?' },
      { role: 'assistant', content: 'Bisa Bunda, rencana mau kami bantu jadwalkan di hari apa ya Bunda? 🙏😊' },
    ];
    expect(DynamicCloserService.hasAskedScheduleRecently(historyWithSched, 2)).toBe(true);
  });

  it('3. isSymptomExploration mendeteksi keluhan/gejala fisik lanjutan si kecil', () => {
    expect(DynamicCloserService.isSymptomExploration('Nggk mbeler tp kyk cuman kyk basah trus kdng suka bunyi grr grr😅')).toBe(true);
    expect(DynamicCloserService.isSymptomExploration('tp skrng sdh nggk bunyi sih🤭')).toBe(true);
    expect(DynamicCloserService.isSymptomExploration('iya ada lendir sedikit')).toBe(true);
    expect(DynamicCloserService.isSymptomExploration('daerah mulyorejo')).toBe(false);
  });

  it('4. Saat asisten baru saja menanyakan lokasi dan customer curhat gejala, closer melarang pengulangan tanya lokasi dan mengarahkan ke empati/doa penenang', () => {
    const history = [
      { role: 'user', content: 'Untuk anak 4 bulan yg pilek itu pijat yg mana ya' },
      { role: 'assistant', content: 'Untuk si kecil, kami rekomendasikan Pijat Bayi Pulih Ceria... Kalau boleh tahu rumah Bunda di daerah atau kelurahan mana ya? ✨' },
    ];

    const customerInput = 'Nggk mbeler tp kyk cuman kyk basah trus kdng suka bunyi grr grr😅';
    const instruction = DynamicCloserService.getCloserInstruction(baseSlate, null, history, customerInput);

    expect(instruction).toContain('EDUKASI MEDIS & EMPATI');
    expect(instruction).toContain('DILARANG MENANYAKAN ALAMAT, KELURAHAN, ATAU LOKASI RUMAH LAGI');
    expect(instruction).toContain('DILARANG MENODONG JADWAL KUNJUNGAN');
  });

  it('5. Saat customer mengeksplorasi gejala dan belum dijawab lokasinya, getCloserText memberikan kalimat penenang tanpa menodong lokasi', () => {
    const history = [
      { role: 'user', content: 'Pijat batuk pilek' },
      { role: 'assistant', content: 'Rumah Bunda di kelurahan mana ya? 😊' },
    ];
    const text = DynamicCloserService.getCloserText(baseSlate, history, 'suaranya grok grok bun');
    expect(text).toContain('Semoga si kecil lekas nyaman dan sehat kembali yaa Bunda');
  });

  it('6. Saat customer secara eksplisit ingin booking/jadwal, closer tetap memandu pengecekan jadwal', () => {
    const history = [
      { role: 'user', content: 'Pijat flu' },
      { role: 'assistant', content: 'Ada Bunda, Pijat Pulih Ceria...' },
    ];
    const customerInput = 'Mau booking untuk besok pagi bisa?';
    const instruction = DynamicCloserService.getCloserInstruction(baseSlate, null, history, customerInput);

    expect(instruction).toContain('PANDUAN PENUTUP (TANYA LOKASI RUMAH)');
    expect(instruction).toContain('akan kami bantu cekkan ketersediaan jadwal Bidan');
  });

  it('7. ConversationStateSummarizer menambahkan larangan mengulang tanya alamat ke janganDiulang saat baru ditanyakan', () => {
    const history = [
      { role: 'user' as const, content: 'Tanya pijat' },
      { role: 'assistant' as const, content: 'Bisa Bunda, rumah Bunda di daerah atau kelurahan mana ya? 😊' },
    ];
    const extraction: ExtractedEntities = {
      intents: ['consult_symptom'],
      symptoms: ['grok-grok', 'lendir'],
      locationText: null,
      streetDetail: null,
      childAgeMonths: 4,
      childAgeCategory: 'BABY',
      preferredDateText: null,
      treatmentName: null,
    };

    const summary = ConversationStateSummarizer.summarize(baseSlate, extraction, {
      history,
      customerInput: 'Nafasnya bunyi grr grr',
    });

    expect(summary).toContain('Menanyakan alamat/kelurahan rumah Bunda lagi');
    expect(summary).toContain('DILARANG menodong jadwal/lokasi jika Bunda masih mendalami gejalanya');
  });
});
