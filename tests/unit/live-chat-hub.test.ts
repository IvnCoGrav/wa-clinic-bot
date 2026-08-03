import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const connectMock = vi.fn();
  class MockRedis {
    public on = vi.fn();
    public connect = connectMock;
    public publish = vi.fn().mockResolvedValue(1);
    public subscribe = vi.fn().mockResolvedValue(1);
    public unsubscribe = vi.fn().mockResolvedValue(1);
    public disconnect = vi.fn().mockResolvedValue(undefined);
    public quit = vi.fn().mockResolvedValue(undefined);
  }
  return { connectMock, MockRedis };
});

vi.mock('ioredis', () => ({ default: mocks.MockRedis }));

import { LiveChatHubService, liveChatHubService, setLiveChatHub, getLiveChatHub } from '../../src/services/live-chat-hub.service';

describe('LiveChatHubService — Redis pub/sub + fallback in-memory', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.connectMock.mockReset();
    mocks.connectMock.mockResolvedValue(undefined);
  });

  describe('mode Redis aktif', () => {
    it('publish mengirim event ke channel livechat:{tenantId} sebagai JSON', async () => {
      const hub = new LiveChatHubService();
      await hub.whenReady();

      expect(hub.isRedisEnabled()).toBe(true);

      const publisher = (hub as any).redisPublisher;
      await hub.publish({ type: 'conversation.updated', tenantId: 'default-tenant', payload: { conversationId: 'c1' } });

      expect(publisher.publish).toHaveBeenCalledWith(
        'livechat:default-tenant',
        expect.stringContaining('"type":"conversation.updated"')
      );
      expect(publisher.publish).toHaveBeenCalledWith(
        'livechat:default-tenant',
        expect.stringContaining(`"_instanceId":"${hub.getInstanceId()}"`)
      );
    });

    it('event lintas-instance (instanceId berbeda) dikirim ke subscriber lokal', async () => {
      const hub = new LiveChatHubService();
      await hub.whenReady();

      const cb = vi.fn();
      await hub.subscribe('default-tenant', cb);

      const subscriber = (hub as any).redisSubscriber;
      const messageHandler = subscriber.on.mock.calls.find((c: any[]) => c[0] === 'message')[1];

      messageHandler(
        'livechat:default-tenant',
        JSON.stringify({ type: 'message.created', tenantId: 'default-tenant', payload: { m: 1 }, _instanceId: 'other-instance-123' })
      );

      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb.mock.calls[0][0].payload).toEqual({ m: 1 });
    });

    it('loopback: event dari instance sendiri (instanceId sama) di-skip agar tidak duplikat', async () => {
      const hub = new LiveChatHubService();
      await hub.whenReady();

      const cb = vi.fn();
      await hub.subscribe('default-tenant', cb);

      const subscriber = (hub as any).redisSubscriber;
      const messageHandler = subscriber.on.mock.calls.find((c: any[]) => c[0] === 'message')[1];

      messageHandler(
        'livechat:default-tenant',
        JSON.stringify({ type: 'conversation.updated', tenantId: 'default-tenant', payload: {}, _instanceId: hub.getInstanceId() })
      );

      expect(cb).not.toHaveBeenCalled();
    });

    it('subscribe mendaftarkan channel ke Redis subscriber', async () => {
      const hub = new LiveChatHubService();
      await hub.whenReady();

      await hub.subscribe('tenant-b', () => {});

      const subscriber = (hub as any).redisSubscriber;
      expect(subscriber.subscribe).toHaveBeenCalledWith('livechat:tenant-b');
    });

    it('unsubscribe menghapus listener lokal', async () => {
      const hub = new LiveChatHubService();
      await hub.whenReady();

      const cb = vi.fn();
      const unsub = await hub.subscribe('default-tenant', cb);
      unsub();

      const subscriber = (hub as any).redisSubscriber;
      const messageHandler = subscriber.on.mock.calls.find((c: any[]) => c[0] === 'message')[1];
      messageHandler(
        'livechat:default-tenant',
        JSON.stringify({ type: 'conversation.updated', tenantId: 'default-tenant', payload: {}, _instanceId: 'x' })
      );

      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe('fallback in-memory (Redis offline)', () => {
    it('startup gagal → alert konsisten dengan format queue.service + redisEnabled false', async () => {
      mocks.connectMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const hub = new LiveChatHubService();
      await hub.whenReady();

      expect(hub.isRedisEnabled()).toBe(false);

      const alertLog = consoleErrorSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(alertLog).toContain('🚨 [CRITICAL ALERT]');
      expect(alertLog).toContain('Entering In-Memory LiveChat Hub Fallback Mode');
      expect(alertLog).toContain('Please check Redis server immediately.');
    });

    it('publish saat Redis offline → event disebar langsung via EventEmitter lokal', async () => {
      mocks.connectMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const hub = new LiveChatHubService();
      await hub.whenReady();
      expect(hub.isRedisEnabled()).toBe(false);

      const cb = vi.fn();
      await hub.subscribe('default-tenant', cb);

      await hub.publish({ type: 'message.created', tenantId: 'default-tenant', payload: { text: 'halo' } });

      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb.mock.calls[0][0].type).toBe('message.created');
      expect(cb.mock.calls[0][0].payload).toEqual({ text: 'halo' });
    });

    it('forceDisconnectRedis → publish berikutnya fallback lokal tanpa Redis', async () => {
      const hub = new LiveChatHubService();
      await hub.whenReady();
      expect(hub.isRedisEnabled()).toBe(true);

      await hub.forceDisconnectRedis();
      expect(hub.isRedisEnabled()).toBe(false);

      const cb = vi.fn();
      await hub.subscribe('default-tenant', cb);
      await hub.publish({ type: 'conversation.updated', tenantId: 'default-tenant', payload: { conversationId: 'c9' } });

      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb.mock.calls[0][0].payload.conversationId).toBe('c9');
    });

    it('publish gagal di runtime (Redis error) → fallback lokal tetap mengirim ke subscriber', async () => {
      const hub = new LiveChatHubService();
      await hub.whenReady();
      expect(hub.isRedisEnabled()).toBe(true);

      const publisher = (hub as any).redisPublisher;
      publisher.publish.mockRejectedValueOnce(new Error('redis down'));

      const cb = vi.fn();
      await hub.subscribe('default-tenant', cb);
      await hub.publish({ type: 'conversation.updated', tenantId: 'default-tenant', payload: { conversationId: 'c10' } });

      expect(cb).toHaveBeenCalledTimes(1);
      expect(hub.isRedisEnabled()).toBe(false);
    });
  });

  describe('Dependency Injection (setLiveChatHub/getLiveChatHub)', () => {
    it('set/get instance aktif — tanpa branch NODE_ENV', () => {
      const fakeHub = { name: 'fake' } as any;
      setLiveChatHub(fakeHub);
      expect(getLiveChatHub()).toBe(fakeHub);
      setLiveChatHub(liveChatHubService);
      expect(getLiveChatHub()).toBe(liveChatHubService);
    });
  });
});
