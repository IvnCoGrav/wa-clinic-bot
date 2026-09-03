import { GoldenScenario } from '../types';

export const locationScenarios: GoldenScenario[] = [
  { id: 'LOC-01', category: 'location', weight: 3, description: 'Kecamatan ambigu Rungkut/Waru tanpa kelurahan — minta kelurahan', turns: [{ turn: 1, input: 'Rungkut', expectedIntents: ['provide_location'], mustContain: ['kelurahan'], noSilentDrop: true }] },
  { id: 'LOC-02', category: 'location', weight: 3, description: 'Kelurahan spesifik Sedati — langsung ongkir promo', turns: [{ turn: 1, input: 'Sedati', expectedIntents: ['provide_location'], mustContain: ['ongkir'] }] },
  { id: 'LOC-03', category: 'location', weight: 1, description: 'Patokan masjid al akbar — tidak salah geocode', turns: [{ turn: 1, input: 'dekat masjid al akbar, lurus mentok belok lagi', expectedIntents: ['provide_location'], mustNotContain: ['RT RW tidak valid'], noSilentDrop: true }] },
  { id: 'LOC-04', category: 'location', weight: 2, description: 'Jalan komplit Platuk tauladan 19a Sidotopo Wetan — pisah streetDetail', turns: [{ turn: 1, input: 'Platuk tauladan 19a, Sidotopo Wetan, Kenjeran', expectedIntents: ['provide_location'], mustContain: ['Bunda'] }] },
  { id: 'LOC-05', category: 'location', weight: 2, description: 'Koreksi lokasi Wonokromo -> Berbek', turns: [{ turn: 1, input: 'Wonokromo', mustContain: ['kelurahan'] }, { turn: 2, input: 'gak jadi di Wonokromo, di Berbek aja', expectedIntents: ['provide_location'], mustContain: ['Bunda'] }] },
  { id: 'LOC-06', category: 'location', weight: 2, description: 'Luar coverage Tuban >30km — penolakan sopan', turns: [{ turn: 1, input: 'Tuban', expectedIntents: ['provide_location'], mustContain: ['Bunda'], noSilentDrop: true }] },
  { id: 'LOC-07', category: 'location', weight: 1, description: 'Pin GPS [LOCATION/MEDIA] lat/lng', turns: [{ turn: 1, input: 'shareloc', expectedIntents: ['provide_location'], mustNotContain: ['kelurahan mana'] }] },
  { id: 'LOC-08', category: 'location', weight: 2, description: 'Perbatasan Surabaya-Sidoarjo tier ongkir tepat', turns: [{ turn: 1, input: 'Wadungasri dalam', expectedIntents: ['provide_location'], mustContain: ['ongkir'] }] },
  { id: 'LOC-09', category: 'location', weight: 2, description: 'Asal klinik mana — Waru Sidoarjo', turns: [{ turn: 1, input: 'ini pijat daerah mana ya / klinik mana', expectedIntents: ['ask_clinic_origin'], mustContain: ['Waru','Sidoarjo'], noSilentDrop: true }] },
];
