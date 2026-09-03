import { GoldenScenario } from '../types';

export const pricingScenarios: GoldenScenario[] = [
  { id: 'PRIC-01', category: 'pricing', weight: 2, description: 'Minta pricelist umum di awal', turns: [{ turn: 1, input: 'Minta pricelistnya kak', expectedIntents: ['ask_price'], mustContain: ['Pijat'], mustNotContain: ['kelurahan mana'], noSilentDrop: true }] },
  { id: 'PRIC-02', category: 'pricing', weight: 2, description: 'Tanya harga spesifik 60rb / Pijat Bayi Ceria berapa', turns: [{ turn: 1, input: 'Pijat Bayi Ceria berapa?', expectedIntents: ['ask_price'], mustContain: ['Rp'], noSilentDrop: true }] },
  { id: 'PRIC-03', category: 'pricing', weight: 2, description: 'Komparasi paket ceria vs pulih biaya', turns: [{ turn: 1, input: 'Bedanya paket ceria sama pulih berapa biayanya?', expectedIntents: ['ask_price'], mustContain: ['Ceria','Pulih'], noSilentDrop: true }] },
];
