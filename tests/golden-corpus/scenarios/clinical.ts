import { GoldenScenario } from '../types';

export const clinicalScenarios: GoldenScenario[] = [
  {
    id: 'CLIN-01', category: 'clinical', weight: 4,
    description: 'Newborn 20 hari batuk pilek grok-grok — rekomendasi Pulih Ceria tanpa todong alamat Turn-1',
    turns: [
      { turn: 1, input: 'Halo dok, bayi saya umur 20 hari batuk pilek grok-grok, hidung tersumbat', expectedIntents: ['consult_symptom','provide_age'], mustContain: ['Pulih Ceria'], mustNotContain: ['kelurahan mana','alamat mana'], noSilentDrop: true, slateAssertions: [{ field: 'symptoms', expected: 'pilek' }] },
      { turn: 2, input: 'Iya boleh, rumah di Sedati', expectedIntents: ['provide_location'], mustContain: ['Sedati'] },
    ],
  },
  {
    id: 'CLIN-02', category: 'clinical', weight: 3,
    description: 'Bayi 1 bulan kolik & kembung — anti silent drop, edukasi kolik',
    turns: [
      { turn: 1, input: 'Bayi saya 1 bulan sering kolik dan kembung, rewel terus', expectedIntents: ['consult_symptom'], mustContain: ['kolik'], mustNotContain: [], noSilentDrop: true, slateAssertions: [{ field: 'symptoms', expected: 'kolik' }] },
    ],
  },
  {
    id: 'CLIN-03', category: 'clinical', weight: 2,
    description: 'Pasca vaksin DPT/BCG demam sumeng — edukasi kapan aman dipijat',
    turns: [
      { turn: 1, input: 'Anak saya habis vaksin DPT kemarin demam sumeng, boleh pijat kapan ya?', expectedIntents: ['consult_symptom'], mustContain: ['hari','istirahat'], noSilentDrop: true },
    ],
  },
  {
    id: 'CLIN-04', category: 'clinical', weight: 3,
    description: 'Anak 15 bulan GTM susah makan — rekomendasi Tumbuh Ceria',
    turns: [
      { turn: 1, input: 'Anak 15 bulan GTM susah makan, ada pijat untuk nafsu makan?', expectedIntents: ['consult_symptom','provide_age'], mustContain: ['nafsu makan'], slateAssertions: [{ field: 'childAgeMonths', expected: 15 }] },
    ],
  },
  {
    id: 'CLIN-05', category: 'clinical', weight: 2,
    description: 'Bayi susah tidur & rewel malam hari — rekam keluhan suportif',
    turns: [
      { turn: 1, input: 'Bayi saya susah tidur dan rewel terus malam hari', expectedIntents: ['consult_symptom'], mustContain: ['tidur'], noSilentDrop: true, slateAssertions: [{ field: 'symptoms', expected: 'susah tidur' }] },
    ],
  },
  {
    id: 'CLIN-06', category: 'clinical', weight: 1,
    description: 'Tanya sinar moksa — penjelasan terapi',
    turns: [
      { turn: 1, input: 'pake sinar moksa bisa kak?', expectedIntents: ['select_treatment'], mustContain: ['moksa'], noSilentDrop: true },
    ],
  },
  {
    id: 'CLIN-07', category: 'clinical', weight: 2,
    description: 'Tanya durasi pijat bayi — transparan ~40 menit dinamis',
    turns: [
      { turn: 1, input: 'Lama pijitnya brp lama ya?', expectedIntents: ['ask_price'], mustContain: ['menit'], noSilentDrop: true },
    ],
  },
  {
    id: 'CLIN-08', category: 'clinical', weight: 2,
    description: 'Ibu nifas laktasi bengkak & oksitosin — kategori MOMS',
    turns: [
      { turn: 1, input: 'Saya ibu nifas ASI bengkak, pijat oksitosin bisa?', expectedIntents: ['consult_symptom'], mustContain: ['oksitosin'], noSilentDrop: true },
    ],
  },
  {
    id: 'CLIN-09', category: 'clinical', weight: 1,
    description: 'Bundling laktasi bunda + pijat bayi ceria — multi-pasien',
    turns: [
      { turn: 1, input: 'Mau pijat laktasi untuk bunda + pijat bayi ceria untuk anak', expectedIntents: ['select_treatment'], mustContain: ['Bunda'], noSilentDrop: true },
    ],
  },
  {
    id: 'CLIN-10', category: 'clinical', weight: 1,
    description: 'Combo cukur rambut bayi + pijat bayi ceria',
    turns: [
      { turn: 1, input: 'Mau cukur rambut bayi + pijat bayi ceria sekalian', expectedIntents: ['select_treatment'], mustContain: ['cukur'], noSilentDrop: true },
    ],
  },
  {
    id: 'CLIN-11', category: 'clinical', weight: 2,
    description: 'Bayi 2 bulan pilek tanpa demam — konsultasi bertahap 3 turn',
    turns: [
      { turn: 1, input: 'Bayi 2 bulan pilek tanpa demam, bagusnya pijat apa?', expectedIntents: ['consult_symptom'], mustContain: ['Pulih Ceria'], slateAssertions: [{ field: 'childAgeMonths', expected: 2 }] },
      { turn: 2, input: 'Rumah di Waru', expectedIntents: ['provide_location'], mustContain: ['Waru'] },
      { turn: 3, input: 'Besok bisa?', expectedIntents: ['ask_schedule'], mustContain: ['cekkan'], mustNotContain: ['Tentu bisa'] },
    ],
  },
  {
    id: 'CLIN-12', category: 'clinical', weight: 2,
    description: 'Anak 3 tahun — kategori KIDS Ceria, bukan Baby Ceria',
    turns: [
      { turn: 1, input: 'Anak saya umur 3 tahun mau pijat', expectedIntents: ['provide_age'], mustContain: ['Bunda'], slateAssertions: [{ field: 'childAgeMonths', expected: 36 }] },
    ],
  },
  {
    id: 'CLIN-13', category: 'clinical', weight: 2,
    description: 'Tanya kualifikasi terapis — profil Bidan STR',
    turns: [
      { turn: 1, input: 'yang mijat bidan asli?', expectedIntents: ['chitchat'], mustContain: ['Bidan','STR'], noSilentDrop: true },
    ],
  },
];
