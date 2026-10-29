import { describe, it, expect, beforeEach } from 'vitest';
import { customerService } from '../../src/services/customer.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

describe('Customer Name Provenance & Hierarchy of Truth (A-012)', () => {
  beforeEach(() => {
    customerService.getMemoryCustomers().clear();
  });

  it('1. pushname non-vokal ("nndw") disimpan sebagai whatsapp_push_name, name tetap null', async () => {
    const cust = await customerService.getOrCreateCustomer('6285755934855', 'nndw', DEFAULT_TENANT_ID);
    expect(cust.name).toBeNull();
    expect(cust.whatsapp_push_name).toBe('nndw');
    expect(cust.name_source).toBeNull();
  });

  it('2. Reservasi pertama (source: reservation) mengeskalasi nama ke Bunda Nandawulan', async () => {
    const cust = await customerService.getOrCreateCustomer('6285755934855', 'nndw', DEFAULT_TENANT_ID);
    expect(cust.name).toBeNull();

    const updated = await customerService.updateCustomerName(
      cust.id,
      'Bunda Nandawulan',
      DEFAULT_TENANT_ID,
      { source: 'reservation' }
    );

    expect(updated.name).toBe('Bunda Nandawulan');
    expect(updated.name_source).toBe('reservation');
  });

  it('3. Reservasi kedua dengan nama berbeda (source: reservation) DITOLAK (anti-bajak anak ke-2)', async () => {
    const cust = await customerService.getOrCreateCustomer('6285755934855', 'nndw', DEFAULT_TENANT_ID);
    await customerService.updateCustomerName(
      cust.id,
      'Bunda Nandawulan',
      DEFAULT_TENANT_ID,
      { source: 'reservation' }
    );

    // Reservasi anak kedua mencoba memasukkan nama "Bunda Kenzo"
    const secondUpdate = await customerService.updateCustomerName(
      cust.id,
      'Bunda Kenzo',
      DEFAULT_TENANT_ID,
      { source: 'reservation' }
    );

    expect(secondUpdate.name).toBe('Bunda Nandawulan');
    expect(secondUpdate.name_source).toBe('reservation');
  });

  it('4. Reservasi kedua dengan nama sama beda kapitalisasi DITERIMA untuk merapikan format', async () => {
    const cust = await customerService.getOrCreateCustomer('6289515768807', 'bunda anggi zulfika', DEFAULT_TENANT_ID);
    // Jika customer sudah terlanjur berhuruf kecil
    cust.name = 'bunda anggi zulfika';
    cust.name_source = 'reservation';

    const updateRes = await customerService.updateCustomerName(
      cust.id,
      'Bunda Anggi Zulfika',
      DEFAULT_TENANT_ID,
      { source: 'reservation' }
    );

    expect(updateRes.name).toBe('Bunda Anggi Zulfika');
    expect(updateRes.name_source).toBe('reservation');
  });

  it('5. sync setelah reservation DITOLAK (turun kasta)', async () => {
    const cust = await customerService.getOrCreateCustomer('628123456789', 'Rina', DEFAULT_TENANT_ID);
    await customerService.updateCustomerName(
      cust.id,
      'Bunda Rina Wardani',
      DEFAULT_TENANT_ID,
      { source: 'reservation' }
    );

    // Sync WAHA mengirim pushName baru
    const syncResult = await customerService.updateCustomerName(
      cust.id,
      'Rina Olshop Murah',
      DEFAULT_TENANT_ID,
      { source: 'sync' }
    );

    expect(syncResult.name).toBe('Bunda Rina Wardani');
    expect(syncResult.name_source).toBe('reservation');
  });

  it('6. admin (force: true) setelah reservation DITERIMA', async () => {
    const cust = await customerService.getOrCreateCustomer('628123456789', 'Rina', DEFAULT_TENANT_ID);
    await customerService.updateCustomerName(
      cust.id,
      'Bunda Rina',
      DEFAULT_TENANT_ID,
      { source: 'reservation' }
    );

    const adminResult = await customerService.updateCustomerName(
      cust.id,
      'Bunda Rina Wardani S.Kep',
      DEFAULT_TENANT_ID,
      { force: true }
    );

    expect(adminResult.name).toBe('Bunda Rina Wardani S.Kep');
    expect(adminResult.name_source).toBe('admin');
  });

  it('7. Nama formulir tanpa vokal resmi ("Ng") tetap tersimpan (sumber resmi bypass zero-vowel)', async () => {
    const cust = await customerService.getOrCreateCustomer('6281999888777', null, DEFAULT_TENANT_ID);

    const resResult = await customerService.updateCustomerName(
      cust.id,
      'Bunda Ng',
      DEFAULT_TENANT_ID,
      { source: 'reservation' }
    );

    expect(resResult.name).toBe('Bunda Ng');
    expect(resResult.name_source).toBe('reservation');
  });

  it('8. pushname "Ng" (sumber non-resmi) ditolak, name tetap null', async () => {
    const cust = await customerService.getOrCreateCustomer('6281999888666', 'Ng', DEFAULT_TENANT_ID);
    expect(cust.name).toBeNull();
    expect(cust.whatsapp_push_name).toBe('Ng');
  });

  it('9. Data lama name_source=null + reservasi baru -> nama diperbaiki (self-heal)', async () => {
    const cust = await customerService.getOrCreateCustomer('6281999888555', 'bunda', DEFAULT_TENANT_ID);
    cust.name = 'Bunda';
    cust.name_source = null;

    const resResult = await customerService.updateCustomerName(
      cust.id,
      'Bunda Clarissa',
      DEFAULT_TENANT_ID,
      { source: 'reservation' }
    );

    expect(resResult.name).toBe('Bunda Clarissa');
    expect(resResult.name_source).toBe('reservation');
  });

  it('10. Emoji/flag/ZWJ: "Bunda 🇮🇩 ℍ𝕖𝕟𝕪 🫶" -> "Bunda Heny" tanpa residu', async () => {
    const cust = await customerService.getOrCreateCustomer('6281999888444', null, DEFAULT_TENANT_ID);

    const resResult = await customerService.updateCustomerName(
      cust.id,
      'Bunda 🇮🇩 ℍ𝕖𝕟𝕪 🫶',
      DEFAULT_TENANT_ID,
      { source: 'reservation' }
    );

    expect(resResult.name).toBe('Bunda Heny');
  });

  it('11. Nama kosong dari formulir -> nama lama tidak hilang (anti data-loss)', async () => {
    const cust = await customerService.getOrCreateCustomer('6281999888333', null, DEFAULT_TENANT_ID);
    await customerService.updateCustomerName(cust.id, 'Bunda Maya', DEFAULT_TENANT_ID, { source: 'reservation' });

    const blankResult = await customerService.updateCustomerName(cust.id, '  ', DEFAULT_TENANT_ID, { source: 'reservation' });
    expect(blankResult.name).toBe('Bunda Maya');
  });

  it('12. Tenant isolation: nama customer di tenant-B terisolasi dari tenant-A', async () => {
    const custA = await customerService.getOrCreateCustomer('6281999888222', null, 'tenant-alpha');
    const custB = await customerService.getOrCreateCustomer('6281999888222', null, 'tenant-beta');

    await customerService.updateCustomerName(custA.id, 'Bunda Alpha', 'tenant-alpha', { source: 'reservation' });
    await customerService.updateCustomerName(custB.id, 'Bunda Beta', 'tenant-beta', { source: 'reservation' });

    const fetchedA = await customerService.getCustomerById(custA.id, 'tenant-alpha');
    const fetchedB = await customerService.getCustomerById(custB.id, 'tenant-beta');

    expect(fetchedA.name).toBe('Bunda Alpha');
    expect(fetchedB.name).toBe('Bunda Beta');
  });
});
