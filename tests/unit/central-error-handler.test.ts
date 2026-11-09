import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app';

describe('Task S2.2 — Fastify Central Error Handler & 404 Handler', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.ADMIN_API_KEY = 'test-admin-key-s2';
    app = await buildApp();

    // Daftarkan route test untuk memicu validasi dan 500 error
    app.get('/test-error/validation', {
      schema: {
        querystring: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' },
          },
        },
      },
    }, async () => ({ ok: true }));

    app.get('/test-error/server-crash', async () => {
      throw new Error('Database connection exploded unexpectedly');
    });

    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('mengembalikan status 400 dengan code VALIDATION_ERROR saat schema Fastify gagal', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/test-error/validation', // id querystring sengaja tidak dikirim
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.statusCode).toBe(400);
    expect(body.error).toBe('Bad Request');
    expect(body.code).toMatch(/VALIDATION/i);
    expect(body.message).toBeTruthy();
  });

  it('mengembalikan status 404 terstruktur JSON dengan code ROUTE_NOT_FOUND untuk rute yang tidak terdaftar', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/rute-pasti-tidak-ada-xyz-12345',
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.statusCode).toBe(404);
    expect(body.error).toBe('Not Found');
    expect(body.code).toBe('ROUTE_NOT_FOUND');
    expect(body.message).toContain('/api/rute-pasti-tidak-ada-xyz-12345');
  });

  it('mengembalikan status 500 tanpa kebocoran stack trace ke klien publik', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/test-error/server-crash',
      });

      expect(res.statusCode).toBe(500);
      const body = res.json();
      expect(body.statusCode).toBe(500);
      expect(body.error).toBe('Internal Server Error');
      // Di production, pesan internal disembunyikan dan stack trace DILARANG bocor
      expect(body.message).toBe('An internal server error occurred');
      expect(body.stack).toBeUndefined();
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });
});
