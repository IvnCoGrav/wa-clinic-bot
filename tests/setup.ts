import { vi } from 'vitest';

// Force ORS to skip HTTP calls by clearing the API key before any module is loaded.
// OrsClient.calculateRoute() returns null immediately when apiKey is falsy,
// which triggers the Haversine fallback in DeliveryService (deterministic, no network).
process.env.ORS_API_KEY = '';

// Mock Prisma client globally for all unit and integration tests to fail fast
// and trigger the in-memory fallback stores instantly when Postgres is offline.
vi.mock('../src/db/client', () => {
  return {
    prisma: {
      customer: {
        findUnique: vi.fn().mockRejectedValue(new Error('Database offline')),
        findFirst: vi.fn().mockRejectedValue(new Error('Database offline')),
        create: vi.fn().mockRejectedValue(new Error('Database offline')),
        update: vi.fn().mockRejectedValue(new Error('Database offline')),
        updateMany: vi.fn().mockRejectedValue(new Error('Database offline')),
      },
      conversation: {
        findFirst: vi.fn().mockRejectedValue(new Error('Database offline')),
        create: vi.fn().mockRejectedValue(new Error('Database offline')),
        update: vi.fn().mockRejectedValue(new Error('Database offline')),
      },
      message: {
        findUnique: vi.fn().mockRejectedValue(new Error('Database offline')),
        findFirst: vi.fn().mockRejectedValue(new Error('Database offline')),
        create: vi.fn().mockRejectedValue(new Error('Database offline')),
        update: vi.fn().mockRejectedValue(new Error('Database offline')),
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
