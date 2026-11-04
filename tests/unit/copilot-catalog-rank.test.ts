import { describe, it, expect } from 'vitest';
import { rankCatalogAndPolicyRows } from '../../src/services/copilot/copilot-tools';

describe('Copilot catalog deterministic ranking (Fase 4)', () => {
  it('"pijat lahap" wajib memunculkan 2 baris Lahap di 3 teratas, di antara 20 baris "pijat" lain', () => {
    // 20 layanan lain yang semuanya memakai kata "Pijat"
    const noiseServices = [
      'Pijat Bayi Baru Lahir (Newborn)',
      'Pijat Batuk Pilek Bayi',
      'Pijat Kolik & Sembelit',
      'Pijat Relaksasi Bayi',
      'Pijat Tumbuh Kembang',
      'Pijat Bayi Prematur',
      'Pijat Terapi Kembung',
      'Pijat Stimulasi Sensori',
      'Pijat Balita Ceria',
      'Pijat Anak Pra-Sekolah',
      'Pijat Spa Bayi Bubble',
      'Pijat Limfatik Anak',
      'Pijat Tradisional Bayi',
      'Pijat Flu & Masuk Angin',
      'Pijat Anak Aktif',
      'Pijat Sehat Bugar',
      'Pijat Bayi Hydrotherapy',
      'Pijat Aromaterapi Bayi',
      'Pijat Bayi Tidur Nyenyak',
      'Pijat Imunitas Anak',
    ].map((name, i) => ({
      kind: 'TREATMENT',
      source: `ClinicService:noise-${i}`,
      title: name,
      category: 'BABY',
      ageLabel: '0 - 12 bulan',
      durationMinutes: 60,
      originalPrice: 100000,
      promoPrice: 85000,
      body: `Layanan ${name} membantu relaksasi bayi.`,
    }));

    // 2 layanan resmi "Pijat Lahap"
    const targetService1 = {
      kind: 'TREATMENT',
      source: 'ClinicService:baby-massage-lahap-juara',
      title: 'Kala Baby - Pijat Lahap',
      category: 'BABY',
      ageLabel: '6 - 24 bulan',
      durationMinutes: 60,
      originalPrice: 120000,
      promoPrice: 95000,
      body: 'Pijat khusus stimulasi nafsu makan dan mengatasi GTM pada bayi.',
    };

    const targetService2 = {
      kind: 'TREATMENT',
      source: 'ClinicService:baby-massage-lahap-juara-gt2',
      title: 'Kala Kids - Pijat Lahap',
      category: 'KIDS',
      ageLabel: '2 - 5 tahun',
      durationMinutes: 60,
      originalPrice: 130000,
      promoPrice: 105000,
      body: 'Pijat nafsu makan untuk balita dan anak yang susah makan.',
    };

    // Gabungkan dengan target berada di tengah dan di akhir (simulasi urutan DB tanpa ranking)
    const mixedRows = [
      ...noiseServices.slice(0, 10),
      targetService1,
      ...noiseServices.slice(10),
      targetService2,
    ];

    expect(mixedRows.length).toBe(22);

    const ranked = rankCatalogAndPolicyRows(mixedRows, 'pijat lahap');

    // 2 baris Lahap wajib berada di 3 teratas (bahkan di posisi 1 & 2)
    const topThreeTitles = ranked.slice(0, 3).map((r) => r.title);
    expect(topThreeTitles).toContain('Kala Baby - Pijat Lahap');
    expect(topThreeTitles).toContain('Kala Kids - Pijat Lahap');

    // Cek matchQuality
    const lahapBaby = ranked.find((r) => r.title === 'Kala Baby - Pijat Lahap');
    const lahapKids = ranked.find((r) => r.title === 'Kala Kids - Pijat Lahap');
    expect(lahapBaby?.matchQuality).toBe('exact');
    expect(lahapKids?.matchQuality).toBe('exact');

    // Layanan yang hanya cocok 1 kata ("Pijat") memiliki status partial
    const noiseSample = ranked.find((r) => r.title === 'Pijat Batuk Pilek Bayi');
    expect(noiseSample?.matchQuality).toBe('partial');
  });
});
