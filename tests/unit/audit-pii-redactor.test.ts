import { describe, it, expect } from 'vitest';
import {
  REDACTED,
  maskName,
  maskPhone,
  maskPhonesInText,
  redactAuditPayload,
} from '../../scripts/redact-audit-pii-history.mjs';

/**
 * D1 (keputusan 2026-11-19): redaksi PII historis pada audit_logs.
 * Kontrak: PII disamarkan/dihapus, data komersial tetap utuh, dan idempoten.
 */
describe('audit-pii redactor historis', () => {
  describe('maskPhone', () => {
    it('menyamarkan nomor 62/08 dengan format 4 + **** + 4', () => {
      expect(maskPhone('6281234567890')).toBe('6281****7890');
      expect(maskPhone('081234567890')).toBe('0812****7890');
    });

    it('mempertahankan suffix tenant dan menangani nomor pendek', () => {
      expect(maskPhone('6281234567890:tenant-a')).toBe('6281****7890:tenant-a');
      expect(maskPhone('1234')).toBe('****');
      expect(maskPhone('')).toBe('(no-phone)');
    });

    it('idempoten untuk nomor yang sudah tersamar', () => {
      const once = maskPhone('6281234567890');
      expect(maskPhone(once)).toBe(once);
    });
  });

  describe('maskName', () => {
    it('menyisakan inisial dan huruf akhir, idempoten', () => {
      const masked = maskName('Bunda Sinta');
      expect(masked).toBe('B***a S***a');
      expect(maskName(masked)).toBe(masked);
    });

    it('nama kosong menjadi (no-name)', () => {
      expect(maskName('   ')).toBe('(no-name)');
    });
  });

  describe('maskPhonesInText', () => {
    it('menyamarkan nomor HP di dalam JID dan teks bebas', () => {
      expect(maskPhonesInText('false_6281234567890@c.us_ABC123')).toContain('*****@c.us');
      expect(maskPhonesInText('hubungi 0812-3456-7890 ya')).not.toContain('3456');
    });

    it('tidak merusak nominal rupiah atau jam', () => {
      expect(maskPhonesInText('Total Rp 150.000 jam 08:00')).toBe('Total Rp 150.000 jam 08:00');
    });
  });

  describe('redactAuditPayload', () => {
    const basePayload = {
      phone: '6281234567890',
      customerPhone: '628111222333',
      name: 'Bunda Sinta',
      address: 'Jl. Melati No. 5',
      landmark: 'Depan masjid',
      notes: 'catatan bebas berisi nama',
      textPreview: 'pesan customer',
      rawText: 'form mentah',
      apiKey: 'super-secret-key',
      customerEmail: 'bunda@example.com',
      ipAddress: '103.45.67.89',
      lat: -7.345678,
      lng: 112.7654321,
      babies: [{ name: 'Rayyan', ageText: '7 hari' }],
      value: 150000,
      purchaseValue: 200000,
      discountAmount: 50000,
      currency: 'IDR',
      event_id: 'pur_default-tenant_res-1',
      fbtrace_id: 'AbCdEf123',
      status: 'approved',
    };

    it('meredaksi PII dan menyamarkan nama/anak', () => {
      const { value } = redactAuditPayload(JSON.stringify(basePayload));
      const out = JSON.parse(value as string);

      expect(out.phone).toBe('6281****7890');
      expect(out.customerPhone).toBe('6281****2333');
      expect(out.name).toBe('B***a S***a');
      expect(out.address).toBe(REDACTED);
      expect(out.landmark).toBe(REDACTED);
      expect(out.notes).toBe(REDACTED);
      expect(out.textPreview).toBe(REDACTED);
      expect(out.rawText).toBe(REDACTED);
      expect(out.apiKey).toBe(REDACTED);
      expect(out.customerEmail).toBe(REDACTED);
      expect(out.ipAddress).toBe('103.45.*.*');
      expect(out.lat).toBe(-7.35);
      expect(out.lng).toBe(112.77);
      expect(out.babies[0].name).toBe('R****n');
      expect(out.babies[0].ageText).toBe('7 hari');
    });

    it('TIDAK menyentuh data komersial dan atribusi', () => {
      const { value } = redactAuditPayload(JSON.stringify(basePayload));
      const out = JSON.parse(value as string);

      expect(out.value).toBe(150000);
      expect(out.purchaseValue).toBe(200000);
      expect(out.discountAmount).toBe(50000);
      expect(out.currency).toBe('IDR');
      expect(out.event_id).toBe('pur_default-tenant_res-1');
      expect(out.fbtrace_id).toBe('AbCdEf123');
      expect(out.status).toBe('approved');
    });

    it('nilai nominal besar yang mirip nomor HP tidak terkena phone-in-text', () => {
      const { value } = redactAuditPayload(
        JSON.stringify({ value: 6281234567, amount: '6281234567', phone: '6281234567' })
      );
      const out = JSON.parse(value as string);
      expect(out.value).toBe(6281234567);
      expect(out.amount).toBe('6281234567');
      expect(out.phone).toBe('6281****4567');
    });

    it('menyamarkan nomor HP yang tersembunyi di waMessageId', () => {
      const { value } = redactAuditPayload(
        JSON.stringify({ waMessageId: 'false_6281234567890@c.us_3EB0ABC' })
      );
      const out = JSON.parse(value as string);
      expect(out.waMessageId).not.toContain('6281234567890');
      expect(out.waMessageId).toContain('@c.us');
    });

    it('idempoten: pass kedua tidak mengubah apa pun', () => {
      const first = redactAuditPayload(JSON.stringify(basePayload));
      const second = redactAuditPayload(first.value as string);
      expect(second.changed).toBe(false);
    });

    it('nama staf internal (adminName/staffName) TIDAK disamarkan demi akuntabilitas audit', () => {
      const { value } = redactAuditPayload(
        JSON.stringify({ adminName: 'Bidan Rina', staffName: 'Bidan Ani', name: 'Bunda Sinta' })
      );
      const out = JSON.parse(value as string);
      expect(out.adminName).toBe('Bidan Rina');
      expect(out.staffName).toBe('Bidan Ani');
      expect(out.name).toBe('B***a S***a');
    });

    it('nama beremoji tidak menghasilkan lone surrogate (payload tetap valid untuk jsonb)', () => {
      const payload = JSON.stringify({ oldName: '노을 🦊', name: 'Bunda 🦊 Sinta', babies: [{ name: '🦊' }] });
      const { value } = redactAuditPayload(payload);
      const out = value as string;

      // Tidak ada escape lone surrogate di JSON hasil (ditolak jsonb PostgreSQL).
      expect(out).not.toMatch(/\\ud[89ab][0-9a-f]{2}(?!\\ud[c-f])/i);
      expect(out).not.toMatch(/(?<!\\ud[89ab][0-9a-f]{2})\\ud[c-f][0-9a-f]{2}/i);
      // Pass kedua stabil dan jsonb round-trip aman (JSON.parse tidak error).
      expect(redactAuditPayload(out).changed).toBe(false);
      expect(() => JSON.parse(out)).not.toThrow();
    });

    it('nama yang sudah tersamar penuh (hanya bintang) tetap idempoten', () => {
      expect(maskName('*')).toBe('*');
      expect(maskName('***')).toBe('***');
      expect(maskName('B***a *')).toBe('B***a *');
    });

    it('payload non-JSON / kosong dikembalikan apa adanya', () => {
      expect(redactAuditPayload('bukan json').changed).toBe(false);
      expect(redactAuditPayload(null).changed).toBe(false);
      expect(redactAuditPayload('"teks"').changed).toBe(false);
    });

    it('objek bersarang dalam (array/objek) tetap diproses tanpa error', () => {
      const nested = {
        level1: { level2: [{ phone: '628999888777', name: 'Bunda Nested' }] },
      };
      const { value } = redactAuditPayload(JSON.stringify(nested));
      const out = JSON.parse(value as string);
      expect(out.level1.level2[0].phone).toBe('6289****8777');
      expect(out.level1.level2[0].name).toBe('B***a N****d');
    });
  });
});
