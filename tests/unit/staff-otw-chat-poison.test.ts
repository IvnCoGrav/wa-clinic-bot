import { describe, it, expect } from 'vitest';
import { isDifferentDayWib, formatChatDateSeparatorWib, formatWibTime } from '../../packages/admin-dashboard/src/utils/dateWib';

describe('Staff OTW Chat Poisoning & Message Filtering Tests', () => {
  it('filters out non-message API responses like OTW status payload from message array', () => {
    const rawApiResponse = [
      {
        id: 'msg_001',
        direction: 'INBOUND',
        content: 'Halo mau booking',
        created_at: '2026-10-10T02:00:00Z',
      },
      // Rogue payload returned by OTW API
      {
        success: true,
        messageId: 'wamid.HBg12345',
        status: 'en_route',
      },
      // Malformed nullish items
      null,
      undefined,
      { id: 123 }, // invalid id type
      { id: 'msg_002', created_at: 'invalid-date' }, // invalid date
      {
        id: 'msg_003',
        direction: 'OUTBOUND',
        content: 'Baik Bunda',
        created_at: '2026-10-10T02:05:00Z',
      },
    ];

    // Filter used in StaffToday.tsx fetchMessages
    const sanitized = rawApiResponse
      .filter(
        (m: any) =>
          m &&
          typeof m === 'object' &&
          typeof m.id === 'string' &&
          !!m.created_at &&
          !isNaN(new Date(m.created_at).getTime())
      );

    expect(sanitized.length).toBe(2);
    expect(sanitized[0].id).toBe('msg_001');
    expect(sanitized[1].id).toBe('msg_003');
  });

  it('renders without throwing when corrupted items enter the chat rendering pipeline', () => {
    const messagesWithPoison: any[] = [
      {
        id: 'msg_001',
        direction: 'INBOUND',
        content: 'Halo Bidan',
        created_at: '2026-10-10T02:00:00Z',
      },
      // Poisoned item from OTW response
      {
        messageId: 'wamid.HBg12345',
        status: 'en_route',
      },
    ];

    // Simulate rendering pipeline of StaffToday.tsx
    const renderedElements = messagesWithPoison.map((msg, idx) => {
      if (!msg || typeof msg !== 'object') return null;
      const isValidDate = !!msg.created_at && !isNaN(new Date(msg.created_at).getTime());
      const timeStr = isValidDate ? formatWibTime(msg.created_at) : '';
      const fullDateTitle = (() => {
        try {
          return isValidDate
            ? new Date(msg.created_at).toLocaleDateString('id-ID', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                timeZone: 'Asia/Jakarta',
              }) + ' WIB'
            : '';
        } catch {
          return '';
        }
      })();
      const prevMsg = idx > 0 ? messagesWithPoison[idx - 1] : null;
      const isDifferentDay = isValidDate && isDifferentDayWib(msg.created_at, prevMsg?.created_at || null);
      const separatorLabel = isValidDate ? formatChatDateSeparatorWib(msg.created_at) : '';

      return {
        key: msg.id || `msg-${idx}`,
        timeStr,
        fullDateTitle,
        isDifferentDay,
        separatorLabel,
      };
    });

    expect(renderedElements.length).toBe(2);
    // The first item has valid date
    expect(renderedElements[0].isDifferentDay).toBe(true);
    expect(renderedElements[0].separatorLabel).toBe('Hari ini');
    // The second item (poisoned OTW response) is rendered safely without throwing!
    expect(renderedElements[1].key).toBe('msg-1');
    expect(renderedElements[1].timeStr).toBe('');
    expect(renderedElements[1].isDifferentDay).toBe(false);
    expect(renderedElements[1].separatorLabel).toBe('');
  });

  it('correctly identifies terminal statuses to guard OTW departure', () => {
    const TERMINAL = ['completed', 'cancelled', 'rejected'];
    expect(TERMINAL.includes(String('Completed').toLowerCase())).toBe(true);
    expect(TERMINAL.includes(String('CANCELLED').toLowerCase())).toBe(true);
    expect(TERMINAL.includes(String('rejected').toLowerCase())).toBe(true);
    expect(TERMINAL.includes(String('confirmed').toLowerCase())).toBe(false);
    expect(TERMINAL.includes(String('en_route').toLowerCase())).toBe(false);
  });
});
