export interface TenantCapiCredentials {
  pixelId?: string;
  accessToken?: string;
  source: 'db' | 'env' | 'none';
}

export type MetaPurchasePolicy = 'SUPPRESS_REPEAT' | 'DUAL_EVENT' | 'ALL_WITH_TAG';

export interface CapiMatchingGeo {
  state: string;
  country: string;
}

export interface SendCapiEventParams {
  eventName: string;
  customer: any;
  adClick?: any;
  value?: number;
  currency?: string;
  tenantId?: string;
  customData?: Record<string, any>;
  eventTime?: number;
  eventId?: string;
  customUserData?: Record<string, any>;
  customEventId?: string;
  reservationId?: string;
}

export interface SendCapiEventResult {
  success: boolean;
  message?: string;
  status?: number;
  fbtrace_id?: string;
  events_received?: number;
  metaResponse?: any;
  sentPayload?: any;
  pixelId?: string;
  skipped?: boolean;
  policy?: MetaPurchasePolicy;
}

export interface TestCapiConnectionParams {
  tenantId?: string;
  eventName?: string;
  phone?: string;
  name?: string;
  value?: number;
  currency?: string;
  testEventCode?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface TestCapiConnectionResult {
  success: boolean;
  status?: number | null;
  message: string;
  metaErrorCode?: number;
  metaErrorSubcode?: number;
  responseBody?: any;
  pixelIdConfigured?: boolean;
  tokenConfigured?: boolean;
  source?: 'db' | 'env' | 'none';
}
