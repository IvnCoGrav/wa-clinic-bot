import { describe, it, expect, beforeEach } from 'vitest';
import { isGenericCustomerName } from '../../src/utils/name-sanitizer';
import { parseReservationText } from '../../src/utils/reservation-text-parser';
import { customerService } from '../../src/services/customer.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

describe('Customer Name Protection & Identity Integrity Tests', () => {
  beforeEach(() => {
    // Bersihkan in-memory customer store sebelum tiap test
    customerService.getMemoryCustomers().clear();
  });

  describe('Skenario 1: Anti-Pembajakan Nama Bayi di Form Terstruktur', () => {
    it('tidak menugaskan nama bayi ke parsed.name saat Nama Bunda kosong/placeholder', () => {
      const rawForm = `
*FORMULIR RESERVASI*
Nama Bunda: (Mohon diisi Bunda 😊)
No WhatsApp: 081234567890
Alamat: Jl. Mawar No. 12, Waru, Sidoarjo
Hari/Tanggal: Senin, 28 Oktober 2026
Jam: 10:00

*Pilihan Treatment (Baby & Kids)*
Nama Bayi/Anak: Kenzo
Usia: 6 bulan
Treatment: Pijat Bayi Ceria
`;

      const result = parseReservationText(rawForm);
      expect(result.success).toBe(true);
      expect(result.reservation).toBeDefined();

      // Nama pemesan tidak boleh dibajak nama bayi
      expect(result.reservation?.name).toBeFalsy();

      // Data bayi tetap tersimpan rapi pada array babies
      expect(result.reservation?.babies).toHaveLength(1);
      expect(result.reservation?.babies[0].name).toBe('Kenzo');
      expect(result.reservation?.babies[0].age).toBe('6 bulan');
    });

    it('tidak menugaskan nama bayi saat Nama Bunda hanya tanda strip (-)', () => {
      const rawForm = `
Nama Bunda : -
No WA : 081234567890
Alamat : Jl. Melati No. 5
Kecamatan : Sukodono
Kota : Sidoarjo
Nama Bayi : Arka
Treatment : Pijat Bayi
`;
      const result = parseReservationText(rawForm);
      expect(result.success).toBe(true);
      expect(result.reservation?.name).toBeFalsy();
      expect(result.reservation?.babies[0]?.name).toBe('Arka');
    });
  });

  describe('Skenario 2: Proteksi Nama Valid Lintas Reservasi (Anti-Penimpaan Otomatis)', () => {
    it('menolak menimpa nama customer yang sudah sah jika force !== true', async () => {
      const phone = '628111222333';
      const cust = await customerService.getOrCreateCustomer(phone, 'Bunda Rina', DEFAULT_TENANT_ID);
      expect(cust.name).toBe('Bunda Rina');

      // Reservasi kedua mencoba mengirim nama anak kedua "Aisyah" atau nama baru tanpa flag force
      const updateResult = await customerService.updateCustomerName(cust.id, 'Bunda Aisyah', DEFAULT_TENANT_ID);

      // Nama tetap dipertahankan nama sah semula
      expect(updateResult.name).toBe('Bunda Rina');

      const checked = await customerService.getCustomerById(cust.id, DEFAULT_TENANT_ID);
      expect(checked.name).toBe('Bunda Rina');
    });
  });

  describe('Skenario 3: Backfill Sah pada Nama Generic/Placeholder', () => {
    it('mengizinkan update nama bila nama customer saat ini masih generic "Bunda"', async () => {
      const phone = '628222333444';
      const cust = await customerService.getOrCreateCustomer(phone, 'Bunda', DEFAULT_TENANT_ID);
      expect(isGenericCustomerName(cust.name)).toBe(true);

      // Customer pertama kali mengisi form reservasi dengan nama "Bunda Sari"
      const updateResult = await customerService.updateCustomerName(cust.id, 'Bunda Sari', DEFAULT_TENANT_ID);
      expect(updateResult.name).toBe('Bunda Sari');

      const checked = await customerService.getCustomerById(cust.id, DEFAULT_TENANT_ID);
      expect(checked.name).toBe('Bunda Sari');
    });

    it('mengizinkan update nama bila nama customer berformat default sistem "Customer 0812"', async () => {
      const phone = '628333444555';
      const cust = await customerService.getOrCreateCustomer(phone, 'Customer 08333444555', DEFAULT_TENANT_ID);
      expect(isGenericCustomerName(cust.name)).toBe(true);

      const updateResult = await customerService.updateCustomerName(cust.id, 'Bunda Maya', DEFAULT_TENANT_ID);
      expect(updateResult.name).toBe('Bunda Maya');
    });
  });

  describe('Skenario 4: Anti Penimpaan WAHA History Sync', () => {
    it('mengabaikan nama toko / pushName WAHA jika customer di DB sudah bernama sah', async () => {
      const phone = '628444555666';
      const cust = await customerService.getOrCreateCustomer(phone, 'Bunda Rina', DEFAULT_TENANT_ID);

      // Pushname WAHA masuk dengan nama olshop
      const wahaPushName = 'Rina Kosmetik Grosir';

      // Simulasi logika sync WAHA yang telah diperbaiki
      const isCurrentGeneric = !cust.name || isGenericCustomerName(cust.name);
      if (wahaPushName && isCurrentGeneric && !isGenericCustomerName(wahaPushName)) {
        await customerService.updateCustomerName(cust.id, wahaPushName, DEFAULT_TENANT_ID);
      }

      const checked = await customerService.getCustomerById(cust.id, DEFAULT_TENANT_ID);
      expect(checked.name).toBe('Bunda Rina');
    });
  });

  describe('Skenario 5: Admin Force Override', () => {
    it('mengizinkan perubahan nama bila dipanggil dengan opsi { force: true }', async () => {
      const phone = '628555666777';
      const cust = await customerService.getOrCreateCustomer(phone, 'Bunda Rina', DEFAULT_TENANT_ID);

      // Admin di dashboard secara sengaja mengedit nama via quick-hold / force update
      const updated = await customerService.updateCustomerName(
        cust.id,
        'Bunda Rina Wardani',
        DEFAULT_TENANT_ID,
        { force: true }
      );

      expect(updated.name).toBe('Bunda Rina Wardani');

      const checked = await customerService.getCustomerById(cust.id, DEFAULT_TENANT_ID);
      expect(checked.name).toBe('Bunda Rina Wardani');
    });
  });

  describe('Skenario 6: Format Gelar Pria (Ayah Rudi) Pasca-Reservasi', () => {
    it('menghormati panggilan Ayah bila pemesan terdeteksi laki-laki/ayah', () => {
      const targetName = 'Ayah Rudi';
      const isMale = /^(?:ayah|pak|bapak|mas)\s+/i.test(targetName);
      const cleanName = targetName.replace(/^(?:ayah|pak|bapak|bunda|ibu|mama|mom|mbak|mas|kak|kakak|ny|ny\.)\s+/i, '').trim();

      const formatted = isMale ? `Ayah ${cleanName}`.trim() : `Bunda ${cleanName}`.trim();
      expect(formatted).toBe('Ayah Rudi');
    });

    it('memformat pemesan umum/wanita menjadi Bunda', () => {
      const targetName = 'Siti Rahma';
      const isMale = /^(?:ayah|pak|bapak|mas)\s+/i.test(targetName);
      const cleanName = targetName.replace(/^(?:ayah|pak|bapak|bunda|ibu|mama|mom|mbak|mas|kak|kakak|ny|ny\.)\s+/i, '').trim();

      const formatted = isMale ? `Ayah ${cleanName}`.trim() : `Bunda ${cleanName}`.trim();
      expect(formatted).toBe('Bunda Siti Rahma');
    });
  });

  describe('Skenario 7: Helper Kanonis isGenericCustomerName', () => {
    it('mengenali nama placeholder dan sapaan tunggal sebagai generic (true)', () => {
      expect(isGenericCustomerName('')).toBe(true);
      expect(isGenericCustomerName(' ')).toBe(true);
      expect(isGenericCustomerName('-')).toBe(true);
      expect(isGenericCustomerName('--')).toBe(true);
      expect(isGenericCustomerName('null')).toBe(true);
      expect(isGenericCustomerName('undefined')).toBe(true);
      expect(isGenericCustomerName('Bunda')).toBe(true);
      expect(isGenericCustomerName('bunda')).toBe(true);
      expect(isGenericCustomerName('Ibu')).toBe(true);
      expect(isGenericCustomerName('bu')).toBe(true);
      expect(isGenericCustomerName('Ayah')).toBe(true);
      expect(isGenericCustomerName('ayah')).toBe(true);
      expect(isGenericCustomerName('Pak')).toBe(true);
      expect(isGenericCustomerName('Bapak')).toBe(true);
      expect(isGenericCustomerName('Kak')).toBe(true);
      expect(isGenericCustomerName('Sandbox Customer')).toBe(true);
      expect(isGenericCustomerName('Customer 08123456')).toBe(true);
      expect(isGenericCustomerName('Pelanggan 9999')).toBe(true);
      expect(isGenericCustomerName('Bu***')).toBe(true);
    });

    it('mengenali nama orang asli yang sah sebagai non-generic (false)', () => {
      expect(isGenericCustomerName('Rina')).toBe(false);
      expect(isGenericCustomerName('Bunda Dewi')).toBe(false);
      expect(isGenericCustomerName('Ayah Rudi')).toBe(false);
      expect(isGenericCustomerName('Ibu Siti Rahma')).toBe(false);
      expect(isGenericCustomerName('Pak Hendra')).toBe(false);
      expect(isGenericCustomerName('Bapak Ahmad')).toBe(false);
      expect(isGenericCustomerName('dr. Annisa')).toBe(false);
    });
  });
});
