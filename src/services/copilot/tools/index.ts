import { CopilotTool } from './types';
import { queryReservationsByFilter } from './reservation-tools';
import {
  queryUnrepliedChats,
  queryUnscheduledProspects,
  queryStalledInquiries,
  explainConversationState,
} from './lead-chat-tools';
import {
  getCustomerHistory,
  lookupCatalogAndPolicy,
  queryChatStats,
  queryRevenue,
  queryFollowups,
} from './analytics-history-tools';

export const COPILOT_TOOLS: CopilotTool[] = [
  queryReservationsByFilter,
  queryUnrepliedChats,
  queryUnscheduledProspects,
  queryStalledInquiries,
  getCustomerHistory,
  lookupCatalogAndPolicy,
  explainConversationState,
  queryChatStats,
  queryRevenue,
  queryFollowups,
];

export function getCopilotTool(name: string): CopilotTool | undefined {
  return COPILOT_TOOLS.find((t) => t.name === name);
}

export * from './types';
export * from './reservation-tools';
export * from './lead-chat-tools';
export * from './analytics-history-tools';
