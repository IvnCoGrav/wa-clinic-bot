import { vi } from 'vitest';

// Mock Prisma client globally for all unit and integration tests to fail fast
// and trigger the in-memory fallback stores instantly when Postgres is offline.
vi.mock('../src/db/client', () => {
  const mockReject = () => Promise.reject(new Error('Database offline'));
  return {
    prisma: {
      customer: {
        findUnique: mockReject,
        findFirst: mockReject,
        create: mockReject,
        update: mockReject,
      },
      conversation: {
        findFirst: mockReject,
        create: mockReject,
        update: mockReject,
      },
      message: {
        findUnique: mockReject,
        create: mockReject,
        update: mockReject,
      },
      knowledgeChunk: {
        create: mockReject,
        update: mockReject,
      },
      reservation: {
        findUnique: mockReject,
        findFirst: mockReject,
        create: mockReject,
        update: mockReject,
      },
      $queryRaw: mockReject,
    },
  };
});
