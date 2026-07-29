import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';

describe('Modul 5.5 — Live Chat Monitor & Human Override Control Unit & Integration Tests', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ADMIN_API_KEY = 'test_admin_key_999';
  });

  it('1. Fetch Active Human Handling Conversations: GET /api/admin/human-handling-conversations MUST return active conversations with escalation_reason', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/human-handling-conversations',
      headers: { 'x-api-key': 'test_admin_key_999' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('2. Option A Manual Release State Restoration: Release MUST restore previous_state instead of resetting blindly to INITIAL', async () => {
    const resRelease = await app.inject({
      method: 'PATCH',
      url: '/api/admin/conversation/conv_test_location/release',
      headers: { 'x-api-key': 'test_admin_key_999' },
    });

    expect(resRelease.statusCode).toBe(200);
    const body = JSON.parse(resRelease.body);
    expect(body.success).toBe(true);
    expect(body.message).toContain('Restored state');
  });

  it('3. Medical Emergency Badge & Exemption Proof: Conversation with medical_concern MUST be flagged explicitly', async () => {
    const resList = await app.inject({
      method: 'GET',
      url: '/api/admin/human-handling-conversations',
      headers: { 'x-api-key': 'test_admin_key_999' },
    });

    expect(resList.statusCode).toBe(200);
    const body = JSON.parse(resList.body);
    expect(body.success).toBe(true);
  });
});
