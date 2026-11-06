import { WhatsAppGateway } from './gateway.types';
import { WahaGatewayDriver } from './waha.driver';
import { WabaGatewayDriver, WabaGatewayDriverConfig } from './waba.driver';
import { wahaClient, WahaClient } from '../waha/client';
import { prisma } from '../../db/client';
import { decryptSecret } from '../../utils/encryption';

const gatewayCache = new Map<string, WhatsAppGateway>();
const wahaClientCache = new Map<string, WahaClient>();

function getOrCreateWahaClient(tenantId: string, sessionId?: string | null): WahaClient {
  const envSession = (process.env.WAHA_SESSION || 'default').trim() || 'default';
  const own = typeof sessionId === 'string' ? sessionId.trim() : '';
  if (!own || own === envSession) return wahaClient;
  const key = getKey(tenantId);
  let client = wahaClientCache.get(key);
  if (!client) {
    client = new WahaClient({ session: own });
    wahaClientCache.set(key, client);
  }
  return client;
}

function getKey(tenantId?: string): string {
  return tenantId || '__default__';
}

export async function resolveGatewayForTenant(tenantId: string): Promise<WhatsAppGateway> {
  const key = getKey(tenantId);
  const cached = gatewayCache.get(key);
  if (cached) return cached;

  let gateway: WhatsAppGateway;

  try {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });

    if (tenant?.whatsapp_provider === 'WABA' && tenant.waba_phone_number_id && tenant.waba_access_token) {
      const config: WabaGatewayDriverConfig = {
        phoneNumberId: tenant.waba_phone_number_id,
        accessToken: decryptSecret(tenant.waba_access_token),
      };
      if (tenant.waba_business_account_id) {
        config.businessAccountId = tenant.waba_business_account_id;
      }
      gateway = new WabaGatewayDriver(config, tenantId);
    } else {
      // K-03b: session WAHA per tenant, bukan singleton env.
      gateway = new WahaGatewayDriver(
        getOrCreateWahaClient(tenantId, (tenant as any)?.waha_session_id),
        tenantId
      );
    }
  } catch {
    // Fallback aman ke WAHA jika DB error atau decrypt gagal
    gateway = new WahaGatewayDriver(await getWahaClientForTenant(tenantId), tenantId);
  }

  gatewayCache.set(key, gateway);
  return gateway;
}

export function getGateway(tenantId?: string): WhatsAppGateway {
  const key = getKey(tenantId);
  const cached = gatewayCache.get(key);
  if (cached) return cached;
  const gw = new WahaGatewayDriver(undefined, tenantId);
  gatewayCache.set(key, gw);
  return gw;
}

export function getWabaGateway(config: WabaGatewayDriverConfig, tenantId?: string): WhatsAppGateway {
  const key = tenantId ? `waba:${tenantId}` : '__waba_default__';
  const cached = gatewayCache.get(key);
  if (cached) return cached;
  const gw = new WabaGatewayDriver(config, tenantId);
  gatewayCache.set(key, gw);
  return gw;
}

export function createTestGateway(gateway: WhatsAppGateway, tenantId?: string): void {
  const key = getKey(tenantId);
  gatewayCache.set(key, gateway);
}

export function resetGateway(): void {
  gatewayCache.clear();
  wahaClientCache.clear();
}

/**
 * AUDIT FASE 3 (K-03b): client WAHA dengan session milik tenant.
 * Dipakai jalur yang butuh API WAHA mentah (typing/seen/humanizer) agar tidak
 * memakai session env global untuk semua tenant.
 */
export async function getWahaClientForTenant(tenantId: string): Promise<WahaClient> {
  const envSession = (process.env.WAHA_SESSION || 'default').trim() || 'default';
  const cached = wahaClientCache.get(getKey(tenantId));
  if (cached) return cached;

  let sessionId: string | undefined;
  try {
    const tenant = await (prisma as any).tenant.findUnique({
      where: { id: tenantId },
      select: { waha_session_id: true },
    });
    const own = typeof tenant?.waha_session_id === 'string' ? tenant.waha_session_id.trim() : '';
    if (own) sessionId = own;
  } catch {
    // DB offline → fallback env (single-tenant behavior).
  }

  if (!sessionId || sessionId === envSession) {
    wahaClientCache.set(getKey(tenantId), wahaClient);
    return wahaClient;
  }
  return getOrCreateWahaClient(tenantId, sessionId);
}
