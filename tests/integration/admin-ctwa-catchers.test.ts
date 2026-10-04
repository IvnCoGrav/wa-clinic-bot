import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { invalidateCtwaCatcherCache } from '../../src/services/ctwa-text-catcher.service';

const ADMIN_KEY = 'ctwa_catcher_admin_key';
const ADMIN_HEADERS = { 'x-api-key': ADMIN_KEY };

interface Row {
  id: string;
  tenant_id: string;
  campaign_name: string;
  source: string;
  medium: string;
  greetings: string[];
  anchor_keywords: string[];
  similarity_threshold: number;
  is_active: boolean;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

describe('Admin API — CTWA Greeting Catchers', () => {
  const app = buildApp();
  let store: Row[] = [];
  let seq = 0;

  beforeEach(() => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    store = [];
    seq = 0;
    invalidateCtwaCatcherCache();

    vi.spyOn(prisma.ctwaCampaignCatcher, 'findMany').mockImplementation((async (args: any) => {
      const tid = args?.where?.tenant_id;
      return store.filter((r) => !tid || r.tenant_id === tid);
    }) as any);
    vi.spyOn(prisma.ctwaCampaignCatcher, 'findUnique').mockImplementation((async (args: any) => {
      return store.find((r) => r.id === args?.where?.id) || null;
    }) as any);
    vi.spyOn(prisma.ctwaCampaignCatcher, 'create').mockImplementation((async (args: any) => {
      const row: Row = {
        id: `catcher-${++seq}`,
        tenant_id: args.data.tenant_id,
        campaign_name: args.data.campaign_name,
        source: args.data.source,
        medium: args.data.medium,
        greetings: args.data.greetings,
        anchor_keywords: args.data.anchor_keywords,
        similarity_threshold: args.data.similarity_threshold,
        is_active: args.data.is_active,
        notes: args.data.notes,
        created_at: new Date(),
        updated_at: new Date(),
      };
      store.push(row);
      return row;
    }) as any);
    vi.spyOn(prisma.ctwaCampaignCatcher, 'update').mockImplementation((async (args: any) => {
      const row = store.find((r) => r.id === args.where.id);
      if (!row) throw new Error('not found');
      Object.assign(row, args.data, { updated_at: new Date() });
      return row;
    }) as any);
    vi.spyOn(prisma.ctwaCampaignCatcher, 'delete').mockImplementation((async (args: any) => {
      const idx = store.findIndex((r) => r.id === args?.where?.id);
      if (idx === -1) throw new Error('not found');
      const [removed] = store.splice(idx, 1);
      return removed;
    }) as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    invalidateCtwaCatcherCache();
  });

  const validPayload = {
    campaign_name: 'IG-BABYSPA',
    source: 'instagram',
    medium: 'ctwa',
    greetings: ['Halo Bidan, saya mau tanya promo Baby Spa Surabaya'],
    anchor_keywords: ['baby spa'],
    similarity_threshold: 0.7,
  };

  it('menolak akses tanpa API key (401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/ctwa-catchers' });
    expect(res.statusCode).toBe(401);
  });

  it('POST valid → 201, lalu GET memuat data tenant', async () => {
    const create = await app.inject({ method: 'POST', url: '/api/admin/ctwa-catchers', headers: ADMIN_HEADERS, payload: validPayload });
    expect(create.statusCode).toBe(201);
    const created = JSON.parse(create.body).data;
    expect(created.campaign_name).toBe('IG-BABYSPA');

    const list = await app.inject({ method: 'GET', url: '/api/admin/ctwa-catchers', headers: ADMIN_HEADERS });
    expect(list.statusCode).toBe(200);
    expect(JSON.parse(list.body).data.length).toBe(1);
  });

  it('POST menolak greetings kosong (400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/ctwa-catchers',
      headers: ADMIN_HEADERS,
      payload: { ...validPayload, greetings: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST menolak threshold di luar 0.5–0.95 (400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/ctwa-catchers',
      headers: ADMIN_HEADERS,
      payload: { ...validPayload, similarity_threshold: 0.99 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('PUT mengubah konfigurasi (200)', async () => {
    await app.inject({ method: 'POST', url: '/api/admin/ctwa-catchers', headers: ADMIN_HEADERS, payload: validPayload });
    const id = store[0].id;
    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/ctwa-catchers/${id}`,
      headers: ADMIN_HEADERS,
      payload: { campaign_name: 'FB-BABYSPA', similarity_threshold: 0.85 },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.campaign_name).toBe('FB-BABYSPA');
    expect(store[0].similarity_threshold).toBe(0.85);
  });

  it('PUT pada id tenant lain → 404 (isolasi tenant)', async () => {
    store.push({
      id: 'foreign',
      tenant_id: 'other-tenant',
      campaign_name: 'X',
      source: 'facebook',
      medium: 'ctwa',
      greetings: ['hai'],
      anchor_keywords: [],
      similarity_threshold: 0.7,
      is_active: true,
      notes: null,
      created_at: new Date(),
      updated_at: new Date(),
    });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/ctwa-catchers/foreign',
      headers: ADMIN_HEADERS,
      payload: { campaign_name: 'HACKED' },
    });
    expect(res.statusCode).toBe(404);
    expect(store[0].campaign_name).toBe('X');
  });

  it('DELETE menghapus (200)', async () => {
    await app.inject({ method: 'POST', url: '/api/admin/ctwa-catchers', headers: ADMIN_HEADERS, payload: validPayload });
    const id = store[0].id;
    const res = await app.inject({ method: 'DELETE', url: `/api/admin/ctwa-catchers/${id}`, headers: ADMIN_HEADERS });
    expect(res.statusCode).toBe(200);
    expect(store.length).toBe(0);
  });

  it('dry-run simulator: match + anchor lolos', async () => {
    await app.inject({ method: 'POST', url: '/api/admin/ctwa-catchers', headers: ADMIN_HEADERS, payload: validPayload });
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/ctwa-catchers/test',
      headers: ADMIN_HEADERS,
      payload: { text: 'halo min mau tny prmo baby spa sby' },
    });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body).data;
    expect(data.matched).toBe(true);
    expect(data.bestMatch.campaignName).toBe('IG-BABYSPA');
    expect(data.anchorCheckPassed).toBe(true);
    expect(Array.isArray(data.diagnostics)).toBe(true);
  });

  it('dry-run simulator: pesan organik ditolak', async () => {
    await app.inject({ method: 'POST', url: '/api/admin/ctwa-catchers', headers: ADMIN_HEADERS, payload: validPayload });
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/ctwa-catchers/test',
      headers: ADMIN_HEADERS,
      payload: { text: 'Halo admin, mau tanya jadwal klinik buka jam berapa?' },
    });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body).data;
    expect(data.matched).toBe(false);
  });

  it('dry-run menolak teks kosong (400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/ctwa-catchers/test',
      headers: ADMIN_HEADERS,
      payload: { text: '   ' },
    });
    expect(res.statusCode).toBe(400);
  });
});
