import { google } from 'googleapis';
import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { googleOAuthClientManager } from '../integrations/google-contacts/google-oauth.client';
import {
  formatContactName,
  normalizePhoneForGoogle,
  buildContactNotes,
  CustomerContactContext,
} from './google-contacts-formatter';

export interface GoogleIntegrationStatus {
  isConfiguredOnPlatform: boolean;
  isConnected: boolean;
  isEnabled: boolean;
  connectedEmail: string | null;
  autoSyncOnChat: boolean;
  autoSyncOnReserve: boolean;
  namingTemplate: string;
  contactLabel: string | null;
  lastSyncedAt: Date | null;
  totalSyncedCustomers: number;
}

export class GoogleContactsService {
  /**
   * Mengambil status integrasi Google Contacts untuk tenant tertentu
   */
  public async getIntegrationStatus(
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<GoogleIntegrationStatus> {
    const isConfiguredOnPlatform = googleOAuthClientManager.isPlatformConfigured();

    let integration = null;
    let totalSynced = 0;

    try {
      integration = await prisma.tenantGoogleIntegration.findUnique({
        where: { tenant_id: tenantId },
      });

      totalSynced = await prisma.customer.count({
        where: {
          tenant_id: tenantId,
          google_resource_name: { not: null },
        },
      });
    } catch (err: any) {
      console.warn(`[GoogleContactsService] Gagal query status untuk tenant ${tenantId}:`, err?.message);
    }

    const isConnected = Boolean(integration && integration.refresh_token);

    return {
      isConfiguredOnPlatform,
      isConnected,
      isEnabled: Boolean(integration?.is_enabled && isConnected),
      connectedEmail: integration?.connected_email || null,
      autoSyncOnChat: integration?.auto_sync_on_chat ?? true,
      autoSyncOnReserve: integration?.auto_sync_on_reserve ?? true,
      namingTemplate: integration?.naming_template || '{{name}} - {{child_name}}',
      contactLabel: integration?.contact_label || 'Pasien Klinik',
      lastSyncedAt: integration?.last_synced_at || null,
      totalSyncedCustomers: totalSynced,
    };
  }

  /**
   * Simpan token dari OAuth Callback ke DB
   */
  public async saveOAuthTokens(
    tenantId: string,
    tokens: {
      accessToken: string | null;
      refreshToken: string | null;
      expiryDate: number | null;
      email: string | null;
    }
  ): Promise<void> {
    await prisma.tenantGoogleIntegration.upsert({
      where: { tenant_id: tenantId },
      create: {
        tenant_id: tenantId,
        is_enabled: true,
        connected_email: tokens.email,
        refresh_token: tokens.refreshToken,
        access_token: tokens.accessToken,
        token_expiry: tokens.expiryDate ? new Date(tokens.expiryDate) : null,
        auto_sync_on_chat: true,
        auto_sync_on_reserve: true,
        naming_template: '{{name}} - {{child_name}}',
        contact_label: 'Pasien Klinik',
      },
      update: {
        is_enabled: true,
        connected_email: tokens.email || undefined,
        refresh_token: tokens.refreshToken || undefined,
        access_token: tokens.accessToken || undefined,
        token_expiry: tokens.expiryDate ? new Date(tokens.expiryDate) : undefined,
      },
    });
  }

  /**
   * Update preferensi / setting integrasi Google Contacts
   */
  public async updateSettings(
    tenantId: string,
    settings: {
      isEnabled?: boolean;
      namingTemplate?: string;
      contactLabel?: string;
      autoSyncOnChat?: boolean;
      autoSyncOnReserve?: boolean;
    }
  ): Promise<any> {
    const existing = await prisma.tenantGoogleIntegration.findUnique({
      where: { tenant_id: tenantId },
    });

    if (!existing) {
      return await prisma.tenantGoogleIntegration.create({
        data: {
          tenant_id: tenantId,
          is_enabled: settings.isEnabled ?? false,
          naming_template: settings.namingTemplate || '{{name}} - {{child_name}}',
          contact_label: settings.contactLabel || 'Pasien Klinik',
          auto_sync_on_chat: settings.autoSyncOnChat ?? true,
          auto_sync_on_reserve: settings.autoSyncOnReserve ?? true,
        },
      });
    }

    return await prisma.tenantGoogleIntegration.update({
      where: { tenant_id: tenantId },
      data: {
        is_enabled: settings.isEnabled !== undefined ? settings.isEnabled : undefined,
        naming_template: settings.namingTemplate !== undefined ? settings.namingTemplate : undefined,
        contact_label: settings.contactLabel !== undefined ? settings.contactLabel : undefined,
        auto_sync_on_chat: settings.autoSyncOnChat !== undefined ? settings.autoSyncOnChat : undefined,
        auto_sync_on_reserve: settings.autoSyncOnReserve !== undefined ? settings.autoSyncOnReserve : undefined,
      },
    });
  }

  /**
   * Cari kontak di Google People API berdasarkan nomor telepon
   */
  public async searchContactByPhone(
    peopleService: any,
    phone: string
  ): Promise<{ resourceName: string; etag: string } | null> {
    const normalizedPhone = normalizePhoneForGoogle(phone);
    if (!normalizedPhone) return null;

    try {
      const res = await peopleService.people.searchContacts({
        query: normalizedPhone,
        readMask: 'names,phoneNumbers,metadata',
      });

      const results = res.data.results;
      if (results && results.length > 0) {
        for (const item of results) {
          const person = item.person;
          const phoneNumbers = person?.phoneNumbers || [];
          const match = phoneNumbers.some((p: any) => {
            const cleanVal = normalizePhoneForGoogle(p.value || '');
            return cleanVal === normalizedPhone;
          });

          if (match && person?.resourceName) {
            return {
              resourceName: person.resourceName,
              etag: person.etag || '',
            };
          }
        }
      }
    } catch (err: any) {
      console.warn(`[GoogleContacts] Gagal searchContactByPhone (${phone}):`, err?.message);
    }

    return null;
  }

  /**
   * Buat kontak baru di Google Contacts
   */
  public async createGoogleContact(
    peopleService: any,
    context: CustomerContactContext,
    template: string = '{{name}} - {{child_name}}'
  ): Promise<{ resourceName: string; etag: string } | null> {
    const { givenName, familyName } = formatContactName(context, null, template);
    const normalizedPhone = normalizePhoneForGoogle(context.phone);
    const notes = buildContactNotes(context);

    try {
      const res = await peopleService.people.createContact({
        requestBody: {
          names: [
            {
              givenName,
              familyName: familyName || undefined,
            },
          ],
          phoneNumbers: [
            {
              value: normalizedPhone,
              type: 'mobile',
            },
          ],
          biographies: [
            {
              value: notes,
              contentType: 'TEXT_PLAIN',
            },
          ],
        },
      });

      if (res.data?.resourceName) {
        return {
          resourceName: res.data.resourceName,
          etag: res.data.etag || '',
        };
      }
    } catch (err: any) {
      console.error(`[GoogleContacts] Error createGoogleContact (${context.phone}):`, err?.message);
    }

    return null;
  }

  /**
   * Update kontak yang sudah ada di Google Contacts
   */
  public async updateGoogleContact(
    peopleService: any,
    resourceName: string,
    etag: string,
    context: CustomerContactContext,
    template: string = '{{name}} - {{child_name}}'
  ): Promise<{ resourceName: string; etag: string } | null> {
    const { givenName, familyName } = formatContactName(context, null, template);
    const normalizedPhone = normalizePhoneForGoogle(context.phone);
    const notes = buildContactNotes(context);

    try {
      // Dapatkan etag terbaru jika tidak disediakan
      let currentEtag = etag;
      if (!currentEtag) {
        const getRes = await peopleService.people.get({
          resourceName,
          personFields: 'names,phoneNumbers,biographies,metadata',
        });
        currentEtag = getRes.data.etag || '';
      }

      const res = await peopleService.people.updateContact({
        resourceName,
        updatePersonFields: 'names,phoneNumbers,biographies',
        requestBody: {
          etag: currentEtag,
          names: [
            {
              givenName,
              familyName: familyName || undefined,
            },
          ],
          phoneNumbers: [
            {
              value: normalizedPhone,
              type: 'mobile',
            },
          ],
          biographies: [
            {
              value: notes,
              contentType: 'TEXT_PLAIN',
            },
          ],
        },
      });

      if (res.data?.resourceName) {
        return {
          resourceName: res.data.resourceName,
          etag: res.data.etag || '',
        };
      }
    } catch (err: any) {
      console.error(`[GoogleContacts] Error updateGoogleContact (${resourceName}):`, err?.message);
    }

    return null;
  }

  /**
   * Sinkronisasi kontak customer tunggal ke Google Contacts (Non-blocking & Fail-safe)
   */
  public async syncCustomer(
    tenantId: string = DEFAULT_TENANT_ID,
    customerId: string,
    options?: { trigger?: 'chat' | 'reservation' | 'manual' }
  ): Promise<{ success: boolean; action?: 'created' | 'updated' | 'skipped'; error?: string }> {
    try {
      // 1. Ambil config integrasi tenant
      const integration = await prisma.tenantGoogleIntegration.findUnique({
        where: { tenant_id: tenantId },
      });

      if (!integration || !integration.is_enabled || !integration.refresh_token) {
        return { success: true, action: 'skipped' };
      }

      // 2. Evaluasi trigger
      if (options?.trigger === 'chat' && !integration.auto_sync_on_chat) {
        return { success: true, action: 'skipped' };
      }
      if (options?.trigger === 'reservation' && !integration.auto_sync_on_reserve) {
        return { success: true, action: 'skipped' };
      }

      // 3. Ambil data customer lengkap
      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        include: {
          children: true,
          reservations: {
            orderBy: { created_at: 'desc' },
            take: 1,
          },
        },
      });

      if (!customer) {
        return { success: false, error: 'Customer tidak ditemukan' };
      }

      // 4. Guard: Lewati sandbox/QA customer
      if (customer.is_sandbox_test) {
        return { success: true, action: 'skipped' };
      }

      // 5. Inisialisasi authenticated Google People API
      const authClient = await googleOAuthClientManager.getAuthenticatedClient(tenantId);
      if (!authClient) {
        return { success: false, error: 'Klien Google OAuth tidak terautentikasi' };
      }

      const peopleService = google.people({ version: 'v1', auth: authClient as any });

      const context: CustomerContactContext = {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        kota: customer.kota,
        kecamatan: customer.kecamatan,
        kelurahan: customer.kelurahan,
        children: customer.children.map((c) => ({ name: c.name, birth_date: c.birth_date })),
        latestReservation: customer.reservations[0]
          ? {
              service_name: (customer.reservations[0] as any).service_name || (customer.reservations[0] as any).notes || 'Reservasi Klinik',
              date: customer.reservations[0].created_at,
            }
          : undefined,
      };

      const template = integration.naming_template || '{{name}} - {{child_name}}';
      let result: { resourceName: string; etag: string } | null = null;
      let action: 'created' | 'updated' = 'created';

      // 6. Cek apakah customer sudah memiliki google_resource_name
      if (customer.google_resource_name) {
        action = 'updated';
        result = await this.updateGoogleContact(
          peopleService,
          customer.google_resource_name,
          customer.google_etag || '',
          context,
          template
        );

        // Jika update gagal (misal kontak sudah dihapus manual di Google), coba create ulang
        if (!result) {
          action = 'created';
          result = await this.createGoogleContact(peopleService, context, template);
        }
      } else {
        // Cek apakah nomor sudah ada di Google Contacts untuk menghindari duplikasi
        const existing = await this.searchContactByPhone(peopleService, customer.phone);
        if (existing) {
          action = 'updated';
          result = await this.updateGoogleContact(
            peopleService,
            existing.resourceName,
            existing.etag,
            context,
            template
          );
        } else {
          action = 'created';
          result = await this.createGoogleContact(peopleService, context, template);
        }
      }

      // 7. Simpan kembali resource_name ke database
      if (result) {
        await prisma.customer.update({
          where: { id: customer.id },
          data: {
            google_resource_name: result.resourceName,
            google_etag: result.etag,
            google_synced_at: new Date(),
          },
        });

        await prisma.tenantGoogleIntegration.update({
          where: { tenant_id: tenantId },
          data: { last_synced_at: new Date() },
        });

        return { success: true, action };
      }

      return { success: false, error: 'Gagal membuat atau memperbarui kontak Google' };
    } catch (err: any) {
      console.error(`[GoogleContactsService] Exception saat syncCustomer (${customerId}):`, err?.message);
      return { success: false, error: err?.message };
    }
  }

  /**
   * Sinkronisasi massal seluruh kontak customer di tenant tertentu (Batching & Throttling)
   */
  public async batchSyncAllCustomers(
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<{ total: number; success: number; failed: number }> {
    const customers = await prisma.customer.findMany({
      where: {
        tenant_id: tenantId,
        is_sandbox_test: false,
      },
      select: { id: true },
    });

    let success = 0;
    let failed = 0;

    for (const item of customers) {
      const res = await this.syncCustomer(tenantId, item.id, { trigger: 'manual' });
      if (res.success && res.action !== 'skipped') {
        success++;
      } else if (!res.success) {
        failed++;
      }

      // Beri jeda 80ms antar request untuk menjaga kuota rate limit Google People API
      await new Promise((resolve) => setTimeout(resolve, 80));
    }

    return {
      total: customers.length,
      success,
      failed,
    };
  }
}

export const googleContactsService = new GoogleContactsService();
