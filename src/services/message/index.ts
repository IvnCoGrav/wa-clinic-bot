import { Direction } from '@prisma/client';
import { messageDedupService } from './message-dedup.service';
import { messageLoggingService } from './message-logging.service';
import { messageQueryService } from './message-query.service';
import { messageActionsService } from './message-actions.service';
import { messageUnreadService } from './message-unread.service';

export class MessageService {
  public registerInFlightBotOutbound(chatId: string, content: string, tenantId: string, ttlMs = 45000): void {
    return messageDedupService.registerInFlightBotOutbound(chatId, content, tenantId, ttlMs);
  }

  public clearInFlightBotOutbound(chatId: string, tenantId?: string): void {
    return messageDedupService.clearInFlightBotOutbound(chatId, tenantId);
  }

  public isInFlightBotOutbound(
    chatIdOrPhone: string,
    content: string,
    tenantId: string,
    customWindowMs = 60000
  ): boolean {
    return messageDedupService.isInFlightBotOutbound(chatIdOrPhone, content, tenantId, customWindowMs);
  }

  public registerKnownBotMessageId(waMessageId: string, tenantId: string, ttlMs = 6 * 60 * 60 * 1000): void {
    return messageDedupService.registerKnownBotMessageId(waMessageId, tenantId, ttlMs);
  }

  public isKnownBotMessageId(waMessageId: string, tenantId?: string): boolean {
    return messageDedupService.isKnownBotMessageId(waMessageId, tenantId);
  }

  public async isDuplicateMessage(waMessageId: string, tenantId: string): Promise<boolean> {
    return messageDedupService.isDuplicateMessage(waMessageId, tenantId);
  }

  public async checkAndAttachOutboundDuplicate(
    conversationId: string,
    content: string,
    waMessageId: string,
    tenantId: string,
    windowSeconds = 60,
    isMediaOrImage = false
  ): Promise<boolean> {
    return messageDedupService.checkAndAttachOutboundDuplicate(
      conversationId,
      content,
      waMessageId,
      tenantId,
      windowSeconds,
      isMediaOrImage
    );
  }

  public async logMessage(data: {
    conversationId: string;
    direction: Direction;
    content: string;
    waMessageId?: string;
    payloadRaw?: any;
    tenantId: string;
    senderType?: string;
    senderName?: string;
    deliveryStatus?: 'sent' | 'delivered' | 'read' | 'failed';
    metaErrorCode?: string;
    metaErrorDesc?: string;
    skipMqlEvaluation?: boolean;
    createdAt?: Date;
    readAt?: Date | null;
    isHistorical?: boolean;
  }) {
    return messageLoggingService.logMessage(data);
  }

  public clearMessageMemory(conversationId: string): void {
    return messageLoggingService.clearMessageMemory(conversationId);
  }

  public async attachMediaToMessage(
    conversationId: string,
    waMessageId: string,
    tenantId: string,
    media: any
  ): Promise<boolean> {
    return messageLoggingService.attachMediaToMessage(conversationId, waMessageId, tenantId, media);
  }

  public async updateDeliveryStatus(
    waMessageId: string,
    tenantId: string,
    status: 'sent' | 'delivered' | 'read' | 'failed',
    timestamp?: number,
    metaErrorCode?: string | null,
    metaErrorDesc?: string | null,
    metaPricingCategory?: string | null
  ): Promise<{ matched: boolean }> {
    return messageLoggingService.updateDeliveryStatus(
      waMessageId,
      tenantId,
      status,
      timestamp,
      metaErrorCode,
      metaErrorDesc,
      metaPricingCategory
    );
  }

  public async getLastInboundMessage(conversationId: string, tenantId: string): Promise<any> {
    return messageQueryService.getLastInboundMessage(conversationId, tenantId);
  }

  public async getMessageById(messageId: string, tenantId: string): Promise<any | null> {
    return messageQueryService.getMessageById(messageId, tenantId);
  }

  public async getRecentMessages(conversationId: string, limit: number, tenantId: string, before?: string | Date): Promise<any[]> {
    return messageQueryService.getRecentMessages(conversationId, limit, tenantId, before);
  }

  public async getRecentMessagesWithHasMore(
    conversationId: string,
    limit: number,
    tenantId: string,
    before?: string | Date,
    focusMessageId?: string
  ): Promise<{ messages: any[]; hasMore: boolean; pinnedMessage?: any }> {
    return messageQueryService.getRecentMessagesWithHasMore(
      conversationId,
      limit,
      tenantId,
      before,
      focusMessageId,
      this.getPinnedMessage.bind(this)
    );
  }

  public async getRecentMessagesWithReasoning(tenantId: string, limit: number = 50): Promise<any[]> {
    return messageQueryService.getRecentMessagesWithReasoning(tenantId, limit);
  }

  public async getPinnedMessage(conversationId: string, tenantId: string): Promise<any | null> {
    return messageQueryService.getPinnedMessage(conversationId, tenantId);
  }

  public async markMessageDeleted(messageId: string, tenantId: string): Promise<boolean> {
    return messageActionsService.markMessageDeleted(messageId, tenantId);
  }

  public async toggleMessagePin(
    conversationId: string,
    messageId: string,
    tenantId: string,
    pinnedBy: string = 'Admin',
    isPinned?: boolean
  ): Promise<{ success: boolean; isPinned: boolean; messageId: string; pinnedMessage?: any; message?: any; error?: string }> {
    return messageActionsService.toggleMessagePin(conversationId, messageId, tenantId, pinnedBy, isPinned);
  }

  public async toggleMessageHide(
    conversationId: string,
    messageId: string,
    tenantId: string,
    hiddenBy: string = 'Admin',
    isHidden?: boolean
  ): Promise<{ success: boolean; isHidden: boolean; messageId: string; message?: any; error?: string }> {
    return messageActionsService.toggleMessageHide(conversationId, messageId, tenantId, hiddenBy, isHidden);
  }

  public async updateMessageContent(
    messageId: string,
    newContent: string,
    tenantId: string
  ): Promise<boolean> {
    return messageActionsService.updateMessageContent(messageId, newContent, tenantId);
  }

  public async addOrUpdateReaction(
    messageId: string,
    tenantId: string,
    reaction: {
      emoji: string;
      fromMe: boolean;
      senderName?: string;
      actorId?: string;
    }
  ): Promise<{ success: boolean; messageId?: string; conversationId?: string; reactions?: any[] }> {
    return messageActionsService.addOrUpdateReaction(messageId, tenantId, reaction);
  }

  public async markConversationMessagesAsRead(conversationId: string, tenantId: string): Promise<void> {
    return messageUnreadService.markConversationMessagesAsRead(conversationId, tenantId);
  }

  public async markConversationAsUnread(conversationId: string, tenantId: string): Promise<void> {
    return messageUnreadService.markConversationAsUnread(conversationId, tenantId);
  }

  public async getUnreadCountsBatch(conversationIds: string[], tenantId: string): Promise<Map<string, number>> {
    return messageUnreadService.getUnreadCountsBatch(conversationIds, tenantId);
  }

  public async getTotalUnreadCount(tenantId: string): Promise<number> {
    return messageUnreadService.getTotalUnreadCount(tenantId);
  }

  public async markAllMessagesAsRead(tenantId: string): Promise<number> {
    return messageUnreadService.markAllMessagesAsRead(tenantId);
  }

  public getMemoryMessages(): any[] {
    return messageUnreadService.getMemoryMessages();
  }
}

export const messageService = new MessageService();

export * from './shared';
export * from './message-dedup.service';
export * from './message-logging.service';
export * from './message-query.service';
export * from './message-actions.service';
export * from './message-unread.service';
