import { describe, it, expect } from 'vitest';
import { isValidChildName, cleanSingleBabyName, formatBabyNamesForGreeting } from '../../src/utils/name-sanitizer';
import { parseReservationText, parseConversationalReservation } from '../../src/utils/reservation-text-parser';
import { formatContactName, buildContactNotes } from '../../src/services/google-contacts-formatter';
import { ChildService } from '../../src/services/child.service';

describe('Child Entity Validation & Ghost Error Prevention Suite', () => {
  describe('1. Canonical Semantics (isValidChildName)', () => {
    it('accepts authentic human names including Indonesian nicknames with balanced parentheses', () => {
      expect(isValidChildName('Arash')).toBe(true);
      expect(isValidChildName('Kenzo')).toBe(true);
      expect(isValidChildName('Chiara')).toBe(true);
      expect(isValidChildName('Cio')).toBe(true);
      expect(isValidChildName('Brea Sheeza Alrescha')).toBe(true);
      expect(isValidChildName('Azmy Nur Rahmaniyah (Ara)')).toBe(true);
      expect(isValidChildName('Alessia')).toBe(true);
    });

    it('strictly rejects temporal conversational adverbs (e.g. Bunda Nisa incident)', () => {
      expect(isValidChildName('belakangan ini')).toBe(false);
      expect(isValidChildName('Belakangan Ini')).toBe(false);
      expect(isValidChildName('saat ini')).toBe(false);
      expect(isValidChildName('sekarang')).toBe(false);
      expect(isValidChildName('kemarin')).toBe(false);
      expect(isValidChildName('tadi pagi')).toBe(false);
      expect(isValidChildName('tadi malam')).toBe(false);
      expect(isValidChildName('besok')).toBe(false);
      expect(isValidChildName('lusa')).toBe(false);
      expect(isValidChildName('hari ini')).toBe(false);
    });

    it('strictly rejects broken parentheses from split decimal ages (e.g. Bunda Nanda, Indra, Khusnul)', () => {
      expect(isValidChildName('5 tahun)')).toBe(false);
      expect(isValidChildName('4 tahun)')).toBe(false);
      expect(isValidChildName('5 bulan)')).toBe(false);
      expect(isValidChildName('newborn)')).toBe(false);
      expect(isValidChildName('Cio (3')).toBe(false);
      expect(isValidChildName('Alessia (0 bulan')).toBe(false);
    });

    it('strictly rejects leaked form headers, colons and labels', () => {
      expect(isValidChildName('Usia Bayi/Anak :')).toBe(false);
      expect(isValidChildName('Nama Bayi :')).toBe(false);
      expect(isValidChildName('Alamat :')).toBe(false);
      expect(isValidChildName('Treatment :')).toBe(false);
      expect(isValidChildName('Jadwal Treatment :')).toBe(false);
    });

    it('strictly rejects self-referential, third-party phrases and naked ages', () => {
      expect(isValidChildName('saya sendiri')).toBe(false);
      expect(isValidChildName('anak saya')).toBe(false);
      expect(isValidChildName('bayi saya')).toBe(false);
      expect(isValidChildName('anak tetangga')).toBe(false);
      expect(isValidChildName('5 bulan')).toBe(false);
      expect(isValidChildName('3 thn')).toBe(false);
      expect(isValidChildName('1,5 tahun')).toBe(false);
    });

    it('strictly rejects generic parent greetings leaking as child name (Fase 0)', () => {
      expect(isValidChildName('Bunda')).toBe(false);
      expect(isValidChildName('bunda')).toBe(false);
      expect(isValidChildName('Ibu')).toBe(false);
      expect(isValidChildName('Mama')).toBe(false);
      expect(isValidChildName('Ayah')).toBe(false);
    });
  });

  describe('2. Text Parser Decimal Comma Protection (Anti Multi-Patient Fee Inflation)', () => {
    it('parses decimal comma age without creating phantom "Bayi 2"', () => {
      const formText = `Nama Bunda: Nanda
Alamat : Bratang Gede
No. Hp : 082186222568
Pilihan treatment (Baby & Kids)
Nama Bayi : Brea Sheeza Alrescha
Usia Bayi/Anak : 3,5 bulan
Treatment : pijat pulih ceria`;

      const res = parseReservationText(formText);
      expect(res.success).toBe(true);
      expect(res.reservation!.babies).toHaveLength(1);
      expect(res.reservation!.babies[0].name).toBe('Brea Sheeza Alrescha');
      expect(res.reservation!.babies[0].age).toBe('3,5 bulan');
    });

    it('parses twins with decimal comma ages cleanly without split-age pollution', () => {
      const formText = `Nama Bunda: Indra
Alamat : Sambikerep
No. Hp : 085692444298
Pilihan treatment (Baby & Kids)
Nama Bayi : Chiara & Cio
Usia Bayi/Anak : 10 bulan & 3,5 tahun
Treatment : Pijat Bayi`;

      const res = parseReservationText(formText);
      expect(res.success).toBe(true);
      expect(res.reservation!.babies).toHaveLength(2);
      expect(res.reservation!.babies[0].name).toBe('Chiara');
      expect(res.reservation!.babies[0].age).toBe('10 bulan');
      expect(res.reservation!.babies[1].name).toBe('Cio');
      expect(res.reservation!.babies[1].age).toBe('3,5 tahun');
    });

    it('does not capture conversational adverbs as child name in natural messages', () => {
      const conversationalMsg = 'Halo bidan, anak saya belakangan ini sering rewel dan batuk pilek nih bun, mau reservasi pijat batuk pilek dong';
      const parsed = parseConversationalReservation(conversationalMsg);

      // Pastikan kata "belakangan ini" tidak terambil sebagai babyName
      if (parsed) {
        expect(parsed.babyName).toBeUndefined();
      }
    });

    it('rejects pronoun-only mom names in conversational parser (Fase 3)', () => {
      const parsed = parseConversationalReservation(
        'Nama: saya, alamat Wonokromo no 12, besok rabu jam 10, anak saya Raffa 1 th'
      );
      if (parsed) {
        expect(parsed.name.trim().toLowerCase()).not.toBe('saya');
      }
    });
  });

  describe('3. Downstream Formatter & Google Contacts Safety', () => {
    it('formatBabyNamesForGreeting falls back to "si kecil" if DB row contains ghost error', () => {
      expect(formatBabyNamesForGreeting([{ name: 'belakangan ini' }])).toBe('si kecil');
      expect(formatBabyNamesForGreeting([{ name: '5 tahun)' }])).toBe('si kecil');
      expect(formatBabyNamesForGreeting([{ name: 'Usia Bayi/Anak :' }])).toBe('si kecil');
    });

    it('formatContactName strips placeholder cleanly when child name is ghost error', () => {
      const res = formatContactName({
        name: 'Bunda Nisamahardilla',
        phone: '081234567890',
        children: [{ name: 'belakangan ini' }],
      });
      expect(res.displayName).toBe('Bunda Nisamahardilla');
      expect(res.displayName).not.toContain('belakangan ini');
      expect(res.givenName).toBe('Bunda');
      expect(res.familyName).toBe('Nisamahardilla');
    });

    it('buildContactNotes omits invalid child names completely', () => {
      const notes = buildContactNotes({
        name: 'Bunda Nisamahardilla',
        phone: '081234567890',
        children: [{ name: 'belakangan ini' }],
      });
      expect(notes).not.toContain('Data Anak:');
      expect(notes).not.toContain('belakangan ini');
    });

    it('row-formatter hides ghost child name in Sheet column E (Fase 2)', async () => {
      const { formatReservationToRow } = await import('../../src/services/sheets/row-formatter');
      const row = formatReservationToRow({
        reservation: { booking_date: new Date('2026-08-13T02:00:00Z'), treatment_detail: 'Pijat Bayi', purchase_value: 70000 } as any,
        customer: { name: 'Bunda Nisa', kelurahan: 'Wonokromo' } as any,
        child: { name: 'belakangan ini', raw_age_text: '1 tahun' } as any,
      });
      expect(String(row[4])).not.toContain('belakangan ini');
    });
  });

  describe('4. ChildService Ingestion Defense-in-Depth', () => {
    it('ChildService.upsertChildrenFromBabies filters out invalid baby names and safely ignores them', async () => {
      const childService = new ChildService();
      // When all babies are invalid, it returns early without doing any DB work
      await expect(
        childService.upsertChildrenFromBabies({
          tenantId: 'default-tenant',
          customerId: 'dummy-cust-id',
          babies: [
            { name: 'belakangan ini', age: '1 tahun' },
            { name: '5 tahun)', age: '5 tahun' },
            { name: 'Usia Bayi/Anak :', age: '' },
          ],
        })
      ).resolves.not.toThrow();
    });
  });

  describe('5. Healing Script Anti-Hardcode Guard (Fase 4)', () => {
    it('heal script contains no hardcoded customer/child names', async () => {
      const { readFileSync } = await import('fs');
      const { join } = await import('path');
      const src = readFileSync(join(process.cwd(), 'src/scripts/heal-corrupted-children-and-customers.ts'), 'utf8');
      for (const banned of ['Arash', 'Brea Sheeza', 'Nisamahardilla', 'Khusnul', 'Devia', 'Alessia', 'Fitria Febriani']) {
        expect(src.includes(`'${banned}'`) || src.includes(`"${banned}"`)).toBe(false);
      }
    });
  });
});
