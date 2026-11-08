import { LiveChatQueryService, liveChatQueryService } from './live-chat-query.service';
import { LiveChatActionsService, liveChatActionsService, parseInternalNoteCommand } from './live-chat-actions.service';
import { serializeConversationItem } from './live-chat-serializer';
import { StaffOwnershipView } from '../staff-ownership.service';
import {
  LiveChatConversationItem,
  LiveChatReservationItem,
  AdminReplyResult,
} from './types';

export * from './types';
export * from './live-chat-serializer';
export * from './live-chat-query.service';
export * from './live-chat-actions.service';

export class LiveChatService {
  public static recentReplies = LiveChatActionsService.recentReplies;
  public static recentClientTemps = LiveChatActionsService.recentClientTemps;

  public serialize(
    c: any,
    stats?: { purchaseCount: number; ltv: number },
    unreadCount = 0,
    staffOwnership: StaffOwnershipView | null = null
  ): LiveChatConversationItem {
    return serializeConversationItem(c, stats, unreadCount, staffOwnership);
  }

  public async getConversationList(
    tenantId: string,
    take = 50,
    offset = 0,
    mode: 'all' | 'real' | 'sandbox' = 'all',
    search?: string,
    label?: string,
    filter: 'all' | 'unread' | 'reservation' = 'all',
    staffId?: string
  ) {
    return liveChatQueryService.getConversationList(tenantId, take, offset, mode, search, label, filter, staffId);
  }

  public async getConversationDetail(conversationId: string, tenantId: string) {
    return liveChatQueryService.getConversationDetail(conversationId, tenantId);
  }

  public async getConversationMessages(conversationId: string, tenantId: string, limit = 50) {
    return liveChatQueryService.getConversationMessages(conversationId, tenantId, limit);
  }

  public async getConversationMessagesPaged(
    conversationId: string,
    tenantId: string,
    limit = 50,
    before?: string | Date,
    focusMessageId?: string
  ) {
    return liveChatQueryService.getConversationMessagesPaged(conversationId, tenantId, limit, before, focusMessageId);
  }

  public async getLastInboundAt(conversationId: string, tenantId: string) {
    return liveChatQueryService.getLastInboundAt(conversationId, tenantId);
  }

  public async getManualReplyEscalates(tenantId: string) {
    return liveChatActionsService.getManualReplyEscalates(tenantId);
  }

  public async generateAiSuggestion(conversationId: string, tenantId: string) {
    return liveChatQueryService.generateAiSuggestion(conversationId, tenantId);
  }

  public async sendAdminReply(params: Parameters<LiveChatActionsService['sendAdminReply']>[0]) {
    return liveChatActionsService.sendAdminReply.call(this, params);
  }

  public async getGatewayCapability(tenantId: string) {
    return liveChatActionsService.getGatewayCapability(tenantId);
  }

  public async sendReaction(params: Parameters<LiveChatActionsService['sendReaction']>[0]) {
    return liveChatActionsService.sendReaction(params);
  }

  public async revokeMessage(params: Parameters<LiveChatActionsService['revokeMessage']>[0]) {
    return liveChatActionsService.revokeMessage(params);
  }

  public async editMessage(params: Parameters<LiveChatActionsService['editMessage']>[0]) {
    return liveChatActionsService.editMessage(params);
  }
}

export const liveChatService = new LiveChatService();
