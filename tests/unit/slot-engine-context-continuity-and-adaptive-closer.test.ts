import { describe, it, expect } from 'vitest';
import { DynamicCloserService } from '../../src/slot-engine/dynamic-closer.service';
import { PersonaComposer } from '../../src/slot-engine/persona-composer';
import { GroundingComposer } from '../../src/slot-engine/grounding-composer';
import { CustomerSlate } from '../../src/slot-engine/types';
import { ExtractedEntities } from '../../src/slot-engine/types';
import { EntityExtractor } from '../../src/slot-engine/entity-extractor';

describe('Slot Engine - Context Continuity & Adaptive Closer Tests', () => {
  const baseSlate: CustomerSlate = {
    customerId: 'c_test_context',
    phone: '6281234567890',
    tenantId: 'default-tenant',
    isLocationConfirmed: true,
    kelurahan: 'Mulyorejo',
    kecamatan: 'Mulyorejo',
    kota: 'Surabaya',
    distanceKm: 16.2,
    ongkirFee: 25000,
    ongkirPromoFee: 20000,
    childAgeMonths: null,
    childAgeCategory: null,
    selectedTreatmentName: null,
    medicalConcerns: [],
    symptoms: ['flu'],
    isOutOfCoverage: false,
    reservationFormSent: false,
    lastInteractionAt: new Date().toISOString(),
    conversationState: 'COLLECTING_SLOTS',
  };

  it('1. Adaptive Closer: Saat customer tanya pembayaran, closer memandu info bayar & jadwal (BUKAN repetisi tanya treatment)', () => {
    const instruction = DynamicCloserService.getCloserInstruction(
      baseSlate,
      null,
      [{ role: 'assistant', content: 'Rencana mau treatment apa bunda ?🤗' }],
      'Untuk payment nya bisa tf atau qris kah kak ??'
    );

    expect(instruction).toContain('METODE PEMBAYARAN');
    expect(instruction).toContain('Pembayaran sangat fleksibel setelah treatment selesai');
    expect(instruction).toContain('DILARANG mengulang pertanyaan "Rencana mau treatment apa bunda ?"');
  });

  it('2. Adaptive Closer: Saat customer tanya Sinar Moksa, closer memandu penawaran add-on sinar', () => {
    const instruction = DynamicCloserService.getCloserInstruction(
      baseSlate,
      null,
      [{ role: 'assistant', content: 'Kami memiliki paket Pijat Pulih Ceria...' }],
      'Itu pakai di sinar ta kak ?? Atau pijat saja ??'
    );

    expect(instruction).toContain('TERAPI & SINAR MOKSA');
    expect(instruction).toContain('Bunda mau sekalian kami tambahkan opsi Sinar Moksa');
  });

  it('3. Adaptive Closer: Saat customer tanya keamanan usia < 3 bulan, closer memandu edukasi keamanan dan ajak booking', () => {
    const instruction = DynamicCloserService.getCloserInstruction(
      baseSlate,
      null,
      [{ role: 'assistant', content: 'Paket Pijat Pulih Ceria sudah termasuk pijat...' }],
      'Aman kah kak soalnya usianya masih belum 3 bulan'
    );

    expect(instruction).toContain('EDUKASI KEAMANAN USIA');
    expect(instruction).toContain('Mau kami bantu jadwalkan kunjungan Bidan');
  });

  it('4. Adaptive Closer: Saat customer tanya Pijat Oksitosin, closer memandu info ibu menyusui/nifas', () => {
    const instruction = DynamicCloserService.getCloserInstruction(
      baseSlate,
      null,
      [],
      'Mau tanya untuk pijat oksitosin full body itu bagaimnaa yaa kak'
    );

    expect(instruction).toContain('LAYANAN IBU / PIJAT OKSITOSIN');
    expect(instruction).toContain('Pijat Oksitosin diperuntukkan khusus bagi Ibu Menyusui');
  });

  it('5. Context Continuity: Saat customer beralih "Ooh yaudah untuk baby aja kak", closer & grounding mempertahankan Pijat Bayi Pulih Ceria (flu)', async () => {
    const history = [
      { role: 'user' as const, content: 'Untuk pijat flu ada kah kak ??' },
      { role: 'assistant' as const, content: 'Tentu ada, Bunda! Kami memiliki paket Pijat Pulih Ceria...' },
      { role: 'user' as const, content: 'Mau tanya untuk pijat oksitosin full body itu bagaimnaa yaa kak' },
      { role: 'assistant' as const, content: 'Pijat Oksitosin Full Body adalah treatment khusus ibu...' },
    ];

    const input = 'Ooh yaudah untuk baby aja kak';
    const instruction = DynamicCloserService.getCloserInstruction(baseSlate, null, history, input);

    expect(instruction).toContain('KONFIRMASI PERAWATAN BAYI');
    expect(instruction).toContain('Pijat Bayi Pulih Ceria');
    expect(instruction).toContain('DILARANG mengulang menanyakan pilihan treatment dari awal');

    const mockExtraction: ExtractedEntities = {
      intents: ['select_treatment'],
      locationText: null,
      streetDetail: null,
      childAgeMonths: null,
      symptoms: ['flu'],
      treatmentReferenced: null,
      preferredDateText: null,
      preferredTimeText: null,
      customerName: null,
      isMedicalEmergency: false,
      confidenceScore: 0.95,
    };

    const grounding = await GroundingComposer.compose(baseSlate, mockExtraction, {
      customerInput: input,
      tenantId: 'default-tenant',
    });

    expect(grounding.customerPreferencesText).toContain('Pijat Bayi Pulih Ceria');
    expect(grounding.customerPreferencesText).toContain('Customer mengonfirmasi memilih perawatan untuk baby saja');
  });

  it('6. PersonaComposer: Pedoman klinis Pijat Oksitosin menegaskan fokus Ibu Menyusui & kelancaran ASI', () => {
    const facts = PersonaComposer.getClinicalAndOperationalFacts();
    expect(facts).toContain('PIJAT OKSITOSIN & LAKTASI');
    expect(facts).toContain('IBU MENYUSUI / PASCA MELAHIRKAN (Nifas/Postpartum)');
    expect(facts).toContain('produksi dan aliran ASI');
  });

  it('7. Multi-Treatment Combination: "Pijat bayi ceria + cukur bisa kak ?" diekstrak sebagai combo paket lengkap', () => {
    const result = EntityExtractor.preExtractDeterministic('Pijat bayi ceria + cukur bisa kak ?');

    expect(result.treatmentReferenced).toBe('Pijat Bayi Ceria + Cukur Rambut Bayi');
    expect(result.intents).toContain('select_treatment');
  });

  it('8. Anti-Backtrack: Saat customer tanya "Sabtu atau Minggu apa bisa kak", closer memandu cek jadwal tanpa menanyakan ulang keputusan treatment', () => {
    const slateNoLoc: CustomerSlate = {
      ...baseSlate,
      isLocationConfirmed: false,
      kelurahan: null,
      selectedTreatmentName: 'Pijat Bayi Ceria + Cukur Rambut Bayi',
    };

    const history = [
      { role: 'user' as const, content: 'Pijat bayi ceria + cukur bisa kak ?' },
      { role: 'assistant' as const, content: 'Tentu saja Bunda, kami bisa melakukan Pijat Bayi Ceria dan cukur rambut si kecil...' }
    ];

    const instructionNoLoc = DynamicCloserService.getCloserInstruction(
      slateNoLoc,
      null,
      history,
      'Sabtu atau Minggu apa bisa kak'
    );

    expect(instructionNoLoc).toContain('TANYA LOKASI RUMAH');
    expect(instructionNoLoc).toContain('Sabtu atau Minggu');
    expect(instructionNoLoc).toContain('DILARANG menanyakan ulang apakah Bunda jadi mengambil paket/treatment');

    const slateWithLoc: CustomerSlate = {
      ...baseSlate,
      isLocationConfirmed: true,
      selectedTreatmentName: 'Pijat Bayi Ceria + Cukur Rambut Bayi',
    };

    const instructionWithLoc = DynamicCloserService.getCloserInstruction(
      slateWithLoc,
      null,
      history,
      'Sabtu atau Minggu apa bisa kak'
    );

    expect(instructionWithLoc).toContain('PANDUAN PENAWARAN JADWAL');
    expect(instructionWithLoc).toContain('Sabtu atau Minggu');
    expect(instructionWithLoc).toContain('DILARANG KERAS MENANYAKAN "DI HARI APA" LAGI');
    expect(instructionWithLoc).toContain('DILARANG menanyakan ulang apakah Bunda jadi mengambil paket/treatment');
  });

  it('9. Age Inquiry without Day: "Usia 14 bulan bisa ?" langsung menanyakan daerah rumah tanpa kalimat pengantar jadwal', () => {
    const slateNoLoc: CustomerSlate = {
      ...baseSlate,
      isLocationConfirmed: false,
      kelurahan: null,
      selectedTreatmentName: null,
    };

    const instruction = DynamicCloserService.getCloserInstruction(
      slateNoLoc,
      null,
      [],
      'Usia 14 bulan bisa ?'
    );

    expect(instruction).toContain('TANYA LOKASI RUMAH');
    expect(instruction).toContain('Kalau boleh tahu, rumah Bunda di daerah atau kelurahan mana yaa');
    expect(instruction).toContain('DILARANG menyebutkan kata pengantar jadwal');
    expect(instruction).not.toContain('jadwal yang diminta');
  });
});
