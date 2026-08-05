import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { customerService } from '../../src/services/customer.service';
import { wahaClient } from '../../src/integrations/waha/client';
import { prisma } from '../../src/db/client';
import { perContactLegacyScrapeService } from '../../src/services/per-contact-legacy-scrape.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { seedAiScopeAll } from '../helpers/seed-ai-scope';

/**
 * Per-Contact Legacy Scrape Trigger (Task 2) — test unit.
 * Trigger webhook + race-condition guard + dry-run.
 */

async function seedCustomer(phone: string, name: string) {
  return customerService.getOrCreateCustomer(phone, name, DEFAULT_TENANT_ID);
}

describe('Per-Contact Legacy Scrape', () => {
  beforeEach(async () => {
    process.env.ENABLE_LEGACY_LABEL_SCRAPE_TRIGGER = 'true';
    process.env.LEGACY_SCRAPE_DRY_RUN = 'false';
    process.env.LEGACY_SCRAPE_MAX_MESSAGES = '200';
    process.env.ADMIN_API_KEY = 'test_admin_key_123';
    await seedAiScopeAll();
  });

  it('Chat berlabel "legacy" + customer belum di-scrape + flag aktif → scrape dipicu, return 200', async () => {
    const phone = `6289001${Date.now()}`;
    await seedCustomer(phone, 'Bunda Legacy');
    const chatId = `${phone}@c.us`;
    wahaClient.mockLabels.set(chatId, ['legacy']);
    const scrapeSpy = vi.spyOn(perContactLegacyScrapeService, 'scrapeContactUntilFirstLead');

    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: {
        event: 'message',
        session: 'default',
        payload: {
          id: `msg_ls1_${Date.now()}`,
          from: chatId,
          fromMe: false,
          timestamp: Math.floor(Date.now() / 1000),
          body: 'halo bu',
        },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'LEGACY_SCRAPE_TRIGGERED' });
    expect(scrapeSpy).toHaveBeenCalledWith(chatId, DEFAULT_TENANT_ID);
  });

  it('Chat berlabel "legacy" + customer SUDAH di-scrape → normal flow (bukan scrape)', async () => {
    const phone = `6289002${Date.now()}`;
    const chatId = `${phone}@c.us`;
    wahaClient.mockLabels.set(chatId, ['legacy']);
    // Simulasikan customer sudah di-scrape (legacy_scraped_at terisi) via prisma mock
    vi.mocked(prisma.customer.findFirst).mockResolvedValueOnce({
      id: 'cust-scraped',
      tenant_id: DEFAULT_TENANT_ID,
      phone,
      name: 'Bunda Scraped',
      status: 'active',
      is_legacy_source: true,
      legacy_scraped_at: new Date(),
      created_at: new Date(Date.now() - 86400000),
      updated_at: new Date(),
    } as any);
    const scrapeSpy = vi.spyOn(perContactLegacyScrapeService, 'scrapeContactUntilFirstLead');

    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: {
        event: 'message',
        session: 'default',
        payload: {
          id: `msg_ls2_${Date.now()}`,
          from: chatId,
          fromMe: false,
          timestamp: Math.floor(Date.now() / 1000),
          body: 'halo',
        },
      },
    });

    // Bukan LEGACY_SCRAPE_TRIGGERED → masuk flow normal
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).status).not.toBe('LEGACY_SCRAPE_TRIGGERED');
    expect(scrapeSpy).not.toHaveBeenCalled();
  });

  it('Race condition guard: 2 panggilan bersamaan → hanya 1 yang menjalankan scrape', async () => {
    const phone = `6289003${Date.now()}`;
    const chatId = `${phone}@c.us`;
    const getMessagesSpy = vi.spyOn(wahaClient, 'getMessages').mockResolvedValue([] as any);

    const p1 = perContactLegacyScrapeService.scrapeContactUntilFirstLead(chatId, DEFAULT_TENANT_ID);
    const p2 = perContactLegacyScrapeService.scrapeContactUntilFirstLead(chatId, DEFAULT_TENANT_ID);
    await Promise.all([p1, p2]);

    expect(getMessagesSpy).toHaveBeenCalledTimes(1);
    expect(perContactLegacyScrapeService.isActive(chatId)).toBe(false);
  });

  it('Dry-run mode → scrape jalan tapi addLabel("hold") TIDAK dipanggil', async () => {
    process.env.LEGACY_SCRAPE_DRY_RUN = 'true';
    const phone = `6289004${Date.now()}`;
    await seedCustomer(phone, 'Bunda DryRun');
    const chatId = `${phone}@c.us`;
    wahaClient.mockLabels.set(chatId, ['legacy']);
    const scrapeSpy = vi.spyOn(perContactLegacyScrapeService, 'scrapeContactUntilFirstLead');
    const addLabelSpy = vi.spyOn(wahaClient, 'addLabel');

    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: {
        event: 'message',
        session: 'default',
        payload: {
          id: `msg_ls3_${Date.now()}`,
          from: chatId,
          fromMe: false,
          timestamp: Math.floor(Date.now() / 1000),
          body: 'halo sdawadaw',
        },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'LEGACY_SCRAPE_TRIGGERED' });
    expect(scrapeSpy).toHaveBeenCalled();
    expect(addLabelSpy).not.toHaveBeenCalledWith(chatId, 'hold');
  });
});