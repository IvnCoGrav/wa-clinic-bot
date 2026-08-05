import { describe, it, expect, beforeEach, vi } from 'vitest';
  import { buildApp } from '../../src/app';
  import { AdminSessionService } from '../../src/services/admin-session.service';
  import { seedAiScopeAll } from '../helpers/seed-ai-scope';
  
  describe('Modul 5.4 — Control Center UI & Origin Isolation Security Tests', () => {
    const app = buildApp();
  
  beforeEach(async () => {
      vi.restoreAllMocks();
      process.env.ADMIN_API_KEY = 'test_admin_key_999';
      process.env.ADMIN_DOMAIN = 'example.com';
      process.env.HUMANIZER_ENABLED = 'false';
      process.env.LLM_API_KEY = 'mock';
      await seedAiScopeAll();
    });

  it('1. Origin Isolation Guard: Accessing /admin/* on tenant landing pages domain MUST return 404 Not Found', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/human-handling-conversations',
      headers: {
        host: 'pages.example.com',
        'x-api-key': 'test_admin_key_999',
      },
    });

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body).error).toBe('Not Found');
  });

  it('2. Browser Admin Auth & Rate-Limiting: HttpOnly Cookie session issued on login, rate-limiting on brute-force', async () => {
    // 2a. Valid Login -> Sets HttpOnly Cookie
    const resLogin = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      payload: { password: 'test_admin_key_999', adminIdentity: 'Bidan Kenanga' },
    });

    expect(resLogin.statusCode).toBe(200);
    const setCookieHeader = resLogin.headers['set-cookie'] as string;
    expect(setCookieHeader).toContain('admin_session=');
    expect(setCookieHeader).toContain('HttpOnly');
    expect(setCookieHeader).toContain('SameSite=Strict');

    const sessionCookieToken = setCookieHeader.match(/admin_session=([^;]+)/)?.[1] || '';
    expect(sessionCookieToken.length).toBeGreaterThan(10);

    // 2b. Authenticated request using HttpOnly Cookie
    const resAuthCookie = await app.inject({
      method: 'GET',
      url: '/api/admin/auth/me',
      headers: {
        cookie: `admin_session=${sessionCookieToken}`,
      },
    });

    expect(resAuthCookie.statusCode).toBe(200);
    expect(JSON.parse(resAuthCookie.body).adminIdentity).toBe('Bidan Kenanga');

    // 2c. Authenticated request using S2S X-API-KEY header
    const resAuthHeader = await app.inject({
      method: 'GET',
      url: '/api/admin/auth/me',
      headers: {
        'x-api-key': 'test_admin_key_999',
        'x-admin-identity': 'External Script Client',
      },
    });

    expect(resAuthHeader.statusCode).toBe(200);
    expect(JSON.parse(resAuthHeader.body).adminIdentity).toBe('External Script Client');

    // 2d. Rate Limiting Test (Brute-force protection on /api/admin/auth/login)
    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/admin/auth/login',
        payload: { password: 'wrong_password_attempt' },
      });
    }

    const resBlocked = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      payload: { password: 'wrong_password_attempt' },
    });

    expect(resBlocked.statusCode).toBe(429);
    expect(JSON.parse(resBlocked.body).error).toContain('Too Many Requests');
  });

  it('3. 3-Table Staging Review Flow: Fetch & Review endpoints for Medical, General, and Legacy Staging', async () => {
    // 3a. Medical Staging Review
    const resMed = await app.inject({
      method: 'GET',
      url: '/api/admin/medical-faq-staging',
      headers: { 'x-api-key': 'test_admin_key_999' },
    });
    expect(resMed.statusCode).toBe(200);

    // 3b. General Staging Review
    const resGen = await app.inject({
      method: 'GET',
      url: '/api/admin/general-faq-staging',
      headers: { 'x-api-key': 'test_admin_key_999' },
    });
    expect(resGen.statusCode).toBe(200);

    // 3c. Legacy Staging Commit
    const resLeg = await app.inject({
      method: 'GET',
      url: '/api/admin/legacy-staging',
      headers: { 'x-api-key': 'test_admin_key_999' },
    });
    expect(resLeg.statusCode).toBe(200);

    const resCommit = await app.inject({
      method: 'PATCH',
      url: '/api/admin/legacy-staging/stage_leg_123/commit',
      headers: { 'x-api-key': 'test_admin_key_999' },
      payload: { status: 'COMMITTED' },
    });
    expect(resCommit.statusCode).toBe(200);
  });

  it('4. Static HTML Serving: GET /admin/login.html MUST be accessible without credentials', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/admin/login.html',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('Login Control Center');
  });

  it('5. Sandbox Chat Simulator Integration Test: 1 message sent via sandbox UI produces IDENTICAL state transition and output to webhook simulation', async () => {
    const testPhone = '628991234567';
    
    const { customerService } = await import('../../src/services/customer.service');
    const { conversationService } = await import('../../src/services/conversation.service');
    const { DEFAULT_TENANT_ID } = await import('../../src/config/tenant');
    const { ConversationState } = await import('@prisma/client');
    
    const customer = await customerService.getOrCreateCustomer(testPhone, 'Mock Integration Customer', DEFAULT_TENANT_ID);
    const conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    
    // 1. Reset state to INITIAL
    await conversationService.updateConversationState(conversation.id, {
      currentState: ConversationState.INITIAL,
      previousState: null,
      locationAttempts: 0,
      isHumanHandling: false,
    }, DEFAULT_TENANT_ID);

    // 2. Call Webhook `/webhook`
    const payload = {
      event: 'message',
      session: 'default',
      payload: {
        id: `msg_webhook_${Date.now()}`,
        from: `${testPhone}@c.us`,
        fromMe: false,
        timestamp: Math.floor(Date.now() / 1000),
        body: 'halo',
        _data: { notifyName: 'Tester' },
      },
    };

    const resWebhook = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload,
    });
    
    expect(resWebhook.statusCode).toBe(200);
    
    // Wait for background worker processing
    await new Promise(resolve => setTimeout(resolve, 400));
    
    const convAfterWebhook = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);
    expect(convAfterWebhook.current_state).toBe(ConversationState.AWAITING_LOCATION);

    // 3. Reset state back to INITIAL for Sandbox Test
    await conversationService.updateConversationState(conversation.id, {
      currentState: ConversationState.INITIAL,
      previousState: null,
      locationAttempts: 0,
      isHumanHandling: false,
    }, DEFAULT_TENANT_ID);

    // 4. Call Sandbox `/api/admin/sandbox/chat`
    const sandboxCustomer = await customerService.getOrCreateCustomer('628999999999', 'Sandbox Customer', DEFAULT_TENANT_ID);
    const sandboxConversation = await conversationService.getOrCreateConversation(sandboxCustomer.id, DEFAULT_TENANT_ID);
    
    await conversationService.updateConversationState(sandboxConversation.id, {
      currentState: ConversationState.INITIAL,
      previousState: null,
      locationAttempts: 0,
      isHumanHandling: false,
    }, DEFAULT_TENANT_ID);

    const resSandbox = await app.inject({
      method: 'POST',
      url: '/api/admin/sandbox/chat',
      headers: {
        'x-api-key': 'test_admin_key_999'
      },
      payload: {
        text: 'halo'
      }
    });

    expect(resSandbox.statusCode).toBe(200);
    const data = JSON.parse(resSandbox.body);
    expect(data.answer).toContain('Perkenalkan, saya Bidan Yusi');
    
    const convAfterSandbox = await conversationService.getOrCreateConversation(sandboxCustomer.id, DEFAULT_TENANT_ID);
    expect(convAfterSandbox.current_state).toBe(ConversationState.AWAITING_LOCATION);
  });
});

