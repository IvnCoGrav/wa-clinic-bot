import { vi, beforeEach } from 'vitest';
import { faqCacheService } from '../src/services/faq-cache.service';

beforeEach(() => {
  faqCacheService.clearMemoryCache();
});

// Matikan burst coalescing secara global supaya semua test deterministik:
// pesan text langsung diproses/di-enqueue, tidak tergantung nilai .env lokal
// (mis. BURST_COALESCE_MS=5000) yang membuat pesan ter-buffer selama window
// dan menggagalkan test yang mengharap state/enqueue per-pesan.
process.env.BURST_COALESCE_MS = '0';

// Force ORS to skip HTTP calls by clearing the API key before any module is loaded.
// OrsClient.calculateRoute() returns null immediately when apiKey is falsy,
// which triggers the Haversine fallback in DeliveryService (deterministic, no network).
process.env.ORS_API_KEY = '';

// Blank WAHA_WEBHOOK_SECRET so the /webhook route runs in no-auth mode during tests
// (deterministic, not dependent on the local .env value). Test files that intentionally
// verify the secret/401 path (e.g. waha-webhook.test.ts) set their own value explicitly.
process.env.WAHA_WEBHOOK_SECRET = '';

// Test environment label mocks
process.env.ENABLE_WAHA_HOLD_LABEL = 'true';
process.env.ENABLE_LIFECYCLE_LABELS = 'true';

// Blank LLM keys so the AI Router (default ON) never hits the network during tests.
// rawLlmCall() throws when apiKey is empty/mock, so the CircuitBreaker falls back to
// rule-based classification (deterministic, offline). Tests that exercise the LLM path
// set a mock key explicitly.
process.env.LLM_API_KEY = '';
process.env.OPENAI_API_KEY = '';
process.env.AI_MODEL_ROUTER = '';
process.env.AI_MODEL_FALLBACK_CHAIN = ''; // blanking rantai fallback supaya test legacy (model-fallback) deterministik
process.env.MAX_INBOUND_MESSAGE_AGE_SECONDS = '0'; // default 0 saat test agar timestamp fixture statis tidak ter-drop
process.env.HUMANIZER_TYPING_AVERAGE_WPM = '48';
process.env.HUMANIZER_MAX_TYPING_DELAY_MS = '6500';
process.env.HUMANIZER_TYPING_REACTION_MS = '300';

// Mock Prisma client globally for all unit and integration tests to fail fast
// and trigger the in-memory fallback stores instantly when Postgres is offline.
vi.mock('../src/db/client', () => {
  return {
    prisma: {
      customer: {
        findUnique: vi.fn().mockRejectedValue(new Error('Database offline')),
        findFirst: vi.fn().mockRejectedValue(new Error('Database offline')),
        findMany: vi.fn().mockRejectedValue(new Error('Database offline')),
        count: vi.fn().mockRejectedValue(new Error('Database offline')),
        create: vi.fn().mockRejectedValue(new Error('Database offline')),
        update: vi.fn().mockRejectedValue(new Error('Database offline')),
        updateMany: vi.fn().mockRejectedValue(new Error('Database offline')),
      },
      conversation: {
        findUnique: vi.fn().mockRejectedValue(new Error('Database offline')),
        findFirst: vi.fn().mockRejectedValue(new Error('Database offline')),
        findMany: vi.fn().mockRejectedValue(new Error('Database offline')),
        create: vi.fn().mockRejectedValue(new Error('Database offline')),
        update: vi.fn().mockRejectedValue(new Error('Database offline')),
      },
      message: {
        findUnique: vi.fn().mockRejectedValue(new Error('Database offline')),
        findFirst: vi.fn().mockRejectedValue(new Error('Database offline')),
        findMany: vi.fn().mockRejectedValue(new Error('Database offline')),
        create: vi.fn().mockRejectedValue(new Error('Database offline')),
        createMany: vi.fn().mockRejectedValue(new Error('Database offline')),
        update: vi.fn().mockRejectedValue(new Error('Database offline')),
        updateMany: vi.fn().mockRejectedValue(new Error('Database offline')),
      },
      knowledgeChunk: {
        create: vi.fn().mockRejectedValue(new Error('Database offline')),
        update: vi.fn().mockRejectedValue(new Error('Database offline')),
      },
      reservation: {
        findUnique: vi.fn().mockRejectedValue(new Error('Database offline')),
        findFirst: vi.fn().mockRejectedValue(new Error('Database offline')),
        findMany: vi.fn().mockRejectedValue(new Error('Database offline')),
        create: vi.fn().mockRejectedValue(new Error('Database offline')),
        update: vi.fn().mockRejectedValue(new Error('Database offline')),
      },
      followUp: {
        findUnique: vi.fn().mockRejectedValue(new Error('Database offline')),
        findFirst: vi.fn().mockRejectedValue(new Error('Database offline')),
        findMany: vi.fn().mockRejectedValue(new Error('Database offline')),
        create: vi.fn().mockRejectedValue(new Error('Database offline')),
        update: vi.fn().mockRejectedValue(new Error('Database offline')),
        updateMany: vi.fn().mockRejectedValue(new Error('Database offline')),
      },
      adClick: {
        findUnique: vi.fn().mockRejectedValue(new Error('Database offline')),
        findFirst: vi.fn().mockRejectedValue(new Error('Database offline')),
        findMany: vi.fn().mockRejectedValue(new Error('Database offline')),
        create: vi.fn().mockRejectedValue(new Error('Database offline')),
        update: vi.fn().mockRejectedValue(new Error('Database offline')),
        updateMany: vi.fn().mockRejectedValue(new Error('Database offline')),
        deleteMany: vi.fn().mockRejectedValue(new Error('Database offline')),
      },
      aiRouterEvaluation: {
        findUnique: vi.fn().mockRejectedValue(new Error('Database offline')),
        findFirst: vi.fn().mockRejectedValue(new Error('Database offline')),
        findMany: vi.fn().mockRejectedValue(new Error('Database offline')),
        count: vi.fn().mockRejectedValue(new Error('Database offline')),
        create: vi.fn().mockRejectedValue(new Error('Database offline')),
        update: vi.fn().mockRejectedValue(new Error('Database offline')),
      },
      aiEvaluation: {
        findUnique: vi.fn().mockRejectedValue(new Error('Database offline')),
        findFirst: vi.fn().mockRejectedValue(new Error('Database offline')),
        findMany: vi.fn().mockRejectedValue(new Error('Database offline')),
        count: vi.fn().mockRejectedValue(new Error('Database offline')),
        aggregate: vi.fn().mockRejectedValue(new Error('Database offline')),
        create: vi.fn().mockRejectedValue(new Error('Database offline')),
        update: vi.fn().mockRejectedValue(new Error('Database offline')),
        upsert: vi.fn().mockRejectedValue(new Error('Database offline')),
      },
      legacyStaging: {
        findUnique: vi.fn().mockRejectedValue(new Error('Database offline')),
        findFirst: vi.fn().mockRejectedValue(new Error('Database offline')),
        findMany: vi.fn().mockRejectedValue(new Error('Database offline')),
        create: vi.fn().mockRejectedValue(new Error('Database offline')),
        update: vi.fn().mockRejectedValue(new Error('Database offline')),
        upsert: vi.fn().mockRejectedValue(new Error('Database offline')),
        count: vi.fn().mockRejectedValue(new Error('Database offline')),
      },
      tenant: {
        findUnique: vi.fn().mockRejectedValue(new Error('Database offline')),
        findFirst: vi.fn().mockRejectedValue(new Error('Database offline')),
        findMany: vi.fn().mockRejectedValue(new Error('Database offline')),
        create: vi.fn().mockRejectedValue(new Error('Database offline')),
        update: vi.fn().mockRejectedValue(new Error('Database offline')),
        upsert: vi.fn().mockRejectedValue(new Error('Database offline')),
      },
      landingPage: {
        findUnique: vi.fn().mockRejectedValue(new Error('Database offline')),
        findFirst: vi.fn().mockRejectedValue(new Error('Database offline')),
        findMany: vi.fn().mockRejectedValue(new Error('Database offline')),
        create: vi.fn().mockRejectedValue(new Error('Database offline')),
        update: vi.fn().mockRejectedValue(new Error('Database offline')),
        delete: vi.fn().mockRejectedValue(new Error('Database offline')),
      },
      wabaTemplate: {
        findUnique: vi.fn().mockRejectedValue(new Error('Database offline')),
        findFirst: vi.fn().mockRejectedValue(new Error('Database offline')),
        findMany: vi.fn().mockRejectedValue(new Error('Database offline')),
        create: vi.fn().mockRejectedValue(new Error('Database offline')),
        update: vi.fn().mockRejectedValue(new Error('Database offline')),
        upsert: vi.fn().mockRejectedValue(new Error('Database offline')),
        deleteMany: vi.fn().mockRejectedValue(new Error('Database offline')),
      },
      generalFaqStaging: {
        findUnique: vi.fn().mockRejectedValue(new Error('Database offline')),
        findFirst: vi.fn().mockRejectedValue(new Error('Database offline')),
        findMany: vi.fn().mockRejectedValue(new Error('Database offline')),
        create: vi.fn().mockRejectedValue(new Error('Database offline')),
        update: vi.fn().mockRejectedValue(new Error('Database offline')),
        count: vi.fn().mockRejectedValue(new Error('Database offline')),
      },
      medicalFaqStaging: {
        findUnique: vi.fn().mockRejectedValue(new Error('Database offline')),
        findFirst: vi.fn().mockRejectedValue(new Error('Database offline')),
        findMany: vi.fn().mockRejectedValue(new Error('Database offline')),
        create: vi.fn().mockRejectedValue(new Error('Database offline')),
        update: vi.fn().mockRejectedValue(new Error('Database offline')),
        count: vi.fn().mockRejectedValue(new Error('Database offline')),
      },
      staff: {
        findUnique: vi.fn().mockRejectedValue(new Error('Database offline')),
        findFirst: vi.fn().mockRejectedValue(new Error('Database offline')),
        findMany: vi.fn().mockRejectedValue(new Error('Database offline')),
        create: vi.fn().mockRejectedValue(new Error('Database offline')),
        update: vi.fn().mockRejectedValue(new Error('Database offline')),
        updateMany: vi.fn().mockRejectedValue(new Error('Database offline')),
        delete: vi.fn().mockRejectedValue(new Error('Database offline')),
        deleteMany: vi.fn().mockRejectedValue(new Error('Database offline')),
        count: vi.fn().mockRejectedValue(new Error('Database offline')),
      },
      staffSession: {
        findUnique: vi.fn().mockRejectedValue(new Error('Database offline')),
        findFirst: vi.fn().mockRejectedValue(new Error('Database offline')),
        findMany: vi.fn().mockRejectedValue(new Error('Database offline')),
        create: vi.fn().mockRejectedValue(new Error('Database offline')),
        update: vi.fn().mockRejectedValue(new Error('Database offline')),
        updateMany: vi.fn().mockRejectedValue(new Error('Database offline')),
        deleteMany: vi.fn().mockRejectedValue(new Error('Database offline')),
      },
      child: {
        findUnique: vi.fn().mockRejectedValue(new Error('Database offline')),
        findFirst: vi.fn().mockRejectedValue(new Error('Database offline')),
        findMany: vi.fn().mockRejectedValue(new Error('Database offline')),
        create: vi.fn().mockRejectedValue(new Error('Database offline')),
        update: vi.fn().mockRejectedValue(new Error('Database offline')),
        delete: vi.fn().mockRejectedValue(new Error('Database offline')),
      },
      $queryRaw: vi.fn().mockRejectedValue(new Error('Database offline')),
    },
  };
});

// Mock Google Calendar service so migration tests don't hang waiting for OAuth/HTTPS
vi.mock('../src/services/google-calendar.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/google-calendar.service')>();
  return {
    ...actual,
    googleCalendarService: {
      createEvent: vi.fn().mockResolvedValue({ id: 'mock-calendar-event-id' }),
      updateEvent: vi.fn().mockResolvedValue({ id: 'mock-calendar-event-id' }),
      deleteEvent: vi.fn().mockResolvedValue(undefined),
      initialize: vi.fn().mockResolvedValue(undefined),
    },
  };
});
