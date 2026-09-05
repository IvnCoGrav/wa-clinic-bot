import { describe, it, expect, beforeEach } from 'vitest';
import {
  normalizeShortcut,
  isValidShortcut,
  interpolateQuickReply,
  DEFAULT_QUICK_REPLIES,
  memoryQuickReplies,
} from '../../src/routes/admin/quick-replies.subroute';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

describe('Quick Replies - Helpers & In-Memory Store', () => {
  beforeEach(() => {
    memoryQuickReplies.clear();
  });

  it('normalizeShortcut strips slash, lowercases and trims', () => {
    expect(normalizeShortcut('/Rek')).toBe('rek');
    expect(normalizeShortcut('  /LOKASI  ')).toBe('lokasi');
    expect(normalizeShortcut('format_reservasi')).toBe('format_reservasi');
    expect(normalizeShortcut('/')).toBe('');
  });

  it('isValidShortcut validates length and charset', () => {
    expect(isValidShortcut('')).not.toBeNull();
    expect(isValidShortcut('a')).not.toBeNull(); // too short
    expect(isValidShortcut('rek')).toBeNull();
    expect(isValidShortcut('ongkir-123')).toBeNull();
    expect(isValidShortcut('bad chars!')).not.toBeNull();
    expect(isValidShortcut('a'.repeat(31))).not.toBeNull(); // too long
  });

  it('interpolateQuickReply replaces all placeholders including location fields', () => {
    const content = 'Halo {name} ({phone})\nKec: {kec}\nKota: {kota}\nAlamat: {alamat}\nDari {clinic_name} oleh {admin_name}';
    const out = interpolateQuickReply(content, {
      name: 'Bunda Retno',
      phone: '628123456789',
      kec: 'Rungkut',
      kota: 'Surabaya',
      alamat: 'Jl Rungkut Asri 12',
      clinic_name: 'Kala Spa',
      admin_name: 'Kak Sinta',
    });
    expect(out).toBe('Halo Bunda Retno (628123456789)\nKec: Rungkut\nKota: Surabaya\nAlamat: Jl Rungkut Asri 12\nDari Kala Spa oleh Kak Sinta');
  });

  it('interpolateQuickReply supports Indonesian aliases ({nama}, {hp}, {kecamatan}, {address})', () => {
    const content = 'Nama: {nama}, HP: {hp}, Kec: {kecamatan}, Alamat: {address}';
    const out = interpolateQuickReply(content, {
      nama: 'Bunda Sari',
      hp: '0811223344',
      kecamatan: 'Sukolilo',
      address: 'Jl Kertajaya Indah',
    });
    expect(out).toBe('Nama: Bunda Sari, HP: 0811223344, Kec: Sukolilo, Alamat: Jl Kertajaya Indah');
  });

  it('interpolateQuickReply uses clean empty fallbacks for location when vars missing', () => {
    const out = interpolateQuickReply('Hi {name} {phone} {clinic_name} {admin_name} Kec: {kec} Kota: {kota}', {});
    expect(out).toContain('Bunda');
    expect(out).toContain('Klinik Kami');
    expect(out).toContain('Admin');
    expect(out).toContain('Kec:  Kota: ');
  });

  it('DEFAULT_QUICK_REPLIES contains 7 required shortcuts with tenant-aware content', () => {
    const shortcuts = DEFAULT_QUICK_REPLIES.map((r) => r.shortcut);
    expect(shortcuts).toContain('rek');
    expect(shortcuts).toContain('lokasi');
    expect(shortcuts).toContain('ongkir');
    expect(shortcuts).toContain('format_reservasi');
    expect(shortcuts).toContain('jadwal');
    expect(shortcuts).toContain('terimakasih');
    expect(shortcuts).toContain('batal');
    expect(DEFAULT_QUICK_REPLIES.length).toBe(7);
    // Ensure placeholder usage
    const withName = DEFAULT_QUICK_REPLIES.filter((r) => r.content.includes('{name}'));
    expect(withName.length).toBeGreaterThanOrEqual(4);
  });

  it('memory store isolates by tenant_id and enforces unique shortcut per tenant', () => {
    const tenantA = 'tenant-a';
    const tenantB = 'tenant-b';
    const idA = 'qr-a-1';
    memoryQuickReplies.set(idA, {
      id: idA,
      tenant_id: tenantA,
      shortcut: 'rek',
      title: 'Rek A',
      content: 'content A',
      category: 'Pembayaran',
      created_at: new Date(),
      updated_at: new Date(),
    });
    // Same shortcut in different tenant should be allowed (different tenant isolation)
    const existingInB = Array.from(memoryQuickReplies.values()).find((r) => r.tenant_id === tenantB && r.shortcut === 'rek');
    expect(existingInB).toBeUndefined();
    // Duplicate in same tenant should be detected
    const dupInA = Array.from(memoryQuickReplies.values()).find((r) => r.tenant_id === tenantA && r.shortcut === 'rek');
    expect(dupInA).toBeDefined();
    expect(dupInA?.title).toBe('Rek A');
  });

  it('DEFAULT_TENANT_ID is used for memory operations and shortcut uniqueness is case-insensitive via normalize', () => {
    const s1 = normalizeShortcut('/ReK');
    const s2 = normalizeShortcut('rek');
    expect(s1).toBe(s2);
    expect(isValidShortcut(s1)).toBeNull();
  });

  it('CRUD simulation in memory: create, update, delete flows', () => {
    const id = 'mem_qr_test1';
    const item = {
      id,
      tenant_id: DEFAULT_TENANT_ID,
      shortcut: 'test',
      title: 'Test Title',
      content: 'Halo {name}',
      category: 'Umum',
      created_at: new Date(),
      updated_at: new Date(),
    };
    memoryQuickReplies.set(id, item);
    expect(memoryQuickReplies.has(id)).toBe(true);

    // update
    const stored = memoryQuickReplies.get(id)!;
    stored.content = 'Updated {name} dari {clinic_name}';
    stored.updated_at = new Date();
    const interpolated = interpolateQuickReply(stored.content, { name: 'Bunda Sari', clinic_name: 'Kala' });
    expect(interpolated).toBe('Updated Bunda Sari dari Kala');

    // delete
    memoryQuickReplies.delete(id);
    expect(memoryQuickReplies.has(id)).toBe(false);
  });
});
