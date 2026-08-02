import { WhatsAppGateway } from './gateway.types';
import { WahaGatewayDriver } from './waha.driver';
import { WabaGatewayDriver, WabaGatewayDriverConfig } from './waba.driver';
import { prisma } from '../../db/client';
import { decryptSecret } from '../../utils/encryption';

const gatewayCache = new Map<string, WhatsAppGateway>();

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
      gateway = new WabaGatewayDriver(config);
    } else {
      gateway = new WahaGatewayDriver();
    }
  } catch {
    // Fallback aman ke WAHA jika DB error atau decrypt gagal
    gateway = new WahaGatewayDriver();
  }

  gatewayCache.set(key, gateway);
  return gateway;
}

export function getGateway(tenantId?: string): WhatsAppGateway {
  const key = getKey(tenantId);
  const cached = gatewayCache.get(key);
  if (cached) return cached;
  const gw = new WahaGatewayDriver();
  gatewayCache.set(key, gw);
  return gw;
}

export function getWabaGateway(config: WabaGatewayDriverConfig, tenantId?: string): WhatsAppGateway {
  const key = tenantId ? `waba:${tenantId}` : '__waba_default__';
  const cached = gatewayCache.get(key);
  if (cached) return cached;
  const gw = new WabaGatewayDriver(config);
  gatewayCache.set(key, gw);
  return gw;
}

export function createTestGateway(gateway: WhatsAppGateway, tenantId?: string): void {
  const key = getKey(tenantId);
  gatewayCache.set(key, gateway);
}

export function resetGateway(): void {
  gatewayCache.clear();
}
