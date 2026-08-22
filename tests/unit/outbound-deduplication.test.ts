import { describe, it, expect, beforeEach } from 'vitest';
import { messageService, extractShortMessageId } from '../../src/services/message.service';
import { Direction } from '@prisma/client';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

describe('Outbound Message Deduplication Guard', () => {
  const tenantId = DEFAULT_TENANT_ID;
  const conversationId = 'conv-dedup-test-123';

  it('extractShortMessageId should extract raw key from WAHA compound key', () => {
    expect(extractShortMessageId('true_6288235780925@c.us_3EB0C8A332CAD06AE69286')).toBe('3EB0C8A332CAD06AE69286');
    expect(extractShortMessageId('false_62812345678@s.whatsapp.net_ABC123XYZ')).toBe('ABC123XYZ');
    expect(extractShortMessageId('3EB0C8A332CAD06AE69286')).toBe('3EB0C8A332CAD06AE69286');
    expect(extractShortMessageId('')).toBe('');
  });

  it('should detect duplicate when short ID was logged and compound ID is checked via isDuplicateMessage', async () => {
    const rawId = '3EB0TEST123456';
    const compoundId = `true_6288235780925@c.us_${rawId}`;

    await messageService.logMessage({
      conversationId,
      tenantId,
      direction: Direction.OUTBOUND,
      content: 'Halo Bunda',
      waMessageId: rawId,
    });

    const isDup = await messageService.isDuplicateMessage(compoundId, tenantId);
    expect(isDup).toBe(true);
  });

  it('should deduplicate image outbound when web logged [IMAGE] and webhook echoes [MEDIA]', async () => {
    const rawId = '3EB0IMG123456';
    const compoundId = `true_6288235780925@c.us_${rawId}`;

    // Admin Web logs image
    await messageService.logMessage({
      conversationId,
      tenantId,
      direction: Direction.OUTBOUND,
      content: '[IMAGE]',
      payloadRaw: { media: { url: '/media/outbound/test.jpg' } },
    });

    // Webhook echoes outbound image from WAHA
    const isRecentDuplicate = await messageService.checkAndAttachOutboundDuplicate(
      conversationId,
      '[MEDIA]',
      compoundId,
      tenantId,
      60,
      true
    );

    expect(isRecentDuplicate).toBe(true);
  });

  it('should deduplicate text outbound case-insensitively', async () => {
    const rawId = '3EB0TXT123456';
    const compoundId = `true_6288235780925@c.us_${rawId}`;

    // Admin Web logs "Tes"
    await messageService.logMessage({
      conversationId,
      tenantId,
      direction: Direction.OUTBOUND,
      content: 'Tes',
    });

    // Webhook echoes "tes"
    const isRecentDuplicate = await messageService.checkAndAttachOutboundDuplicate(
      conversationId,
      'tes',
      compoundId,
      tenantId,
      60,
      false
    );

    expect(isRecentDuplicate).toBe(true);
  });
});
