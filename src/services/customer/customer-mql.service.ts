import { prisma } from '../../db/client';
import { hasBypassLabel } from '../../utils/customer-bypass';
import { memoryCustomers } from './shared';

/**
 * Mengambil setting MQL untuk tenant
 */
export async function getMqlSettings(tenantId: string): Promise<{ mqlThresholdBubbles: number; mqlAutoLeadEnabled: boolean }> {
  try {
    const tenant = await prisma.tenant.findFirst({ where: { id: tenantId } });
    return {
      mqlThresholdBubbles: tenant?.mql_threshold_bubbles ?? 5,
      mqlAutoLeadEnabled: tenant?.mql_auto_lead_enabled ?? true,
    };
  } catch (error) {
    return { mqlThresholdBubbles: 5, mqlAutoLeadEnabled: true };
  }
}

/**
 * Memperbarui setting MQL untuk tenant
 */
export async function updateMqlSettings(
  tenantId: string,
  settings: { mqlThresholdBubbles?: number; mqlAutoLeadEnabled?: boolean }
): Promise<{ mqlThresholdBubbles: number; mqlAutoLeadEnabled: boolean }> {
  try {
    const tenant = await prisma.tenant.findFirst({ where: { id: tenantId } });
    const targetId = tenant?.id || tenantId;

    const updated = await prisma.tenant.upsert({
      where: { id: targetId },
      create: {
        id: targetId,
        slug: targetId,
        name: `Default Clinic`,
        ...(settings.mqlThresholdBubbles !== undefined && { mql_threshold_bubbles: settings.mqlThresholdBubbles }),
        ...(settings.mqlAutoLeadEnabled !== undefined && { mql_auto_lead_enabled: settings.mqlAutoLeadEnabled }),
      },
      update: {
        ...(settings.mqlThresholdBubbles !== undefined && { mql_threshold_bubbles: settings.mqlThresholdBubbles }),
        ...(settings.mqlAutoLeadEnabled !== undefined && { mql_auto_lead_enabled: settings.mqlAutoLeadEnabled }),
      },
    });

    return {
      mqlThresholdBubbles: updated.mql_threshold_bubbles,
      mqlAutoLeadEnabled: updated.mql_auto_lead_enabled,
    };
  } catch (error) {
    return {
      mqlThresholdBubbles: settings.mqlThresholdBubbles ?? 5,
      mqlAutoLeadEnabled: settings.mqlAutoLeadEnabled ?? true,
    };
  }
}

/**
 * Mengiterasi jumlah pesan/bubble inbound customer, dan mengevaluasi status MQL.
 * Jika jumlah bubble mencapai/melebihi threshold MQL (default: 5) dan customer belum MQL,
 * otomatis ubah status customer menjadi MQL dan picu event 'Lead' via CAPI.
 */
export async function incrementCustomerMessageCount(
  customerId: string,
  tenantId: string
): Promise<{ customer: any; newlyTriggeredMql: boolean }> {
  let newlyTriggeredMql = false;
  let updatedCustomer: any = null;

  try {
    // 1. Ambil tenant settings (threshold & auto lead)
    const settings = await getMqlSettings(tenantId);
    const mqlThreshold = settings.mqlThresholdBubbles;
    const mqlAutoLead = settings.mqlAutoLeadEnabled;

    // 2. Fetch customer saat ini
    const current = await prisma.customer.findUnique({
      where: { id: customerId },
      include: { labels: { include: { label: true } } },
    });
    if (!current || current.is_admin_labeled || hasBypassLabel(current)) {
      return { customer: current, newlyTriggeredMql: false };
    }

    const newCount = (current.mql_bubble_count || 0) + 1;
    const shouldQualifyMql = !current.is_mql && newCount >= mqlThreshold;

    if (shouldQualifyMql) {
      newlyTriggeredMql = true;
    }

    updatedCustomer = await prisma.customer.update({
      where: { id: customerId },
      data: {
        mql_bubble_count: newCount,
        is_mql: current.is_mql || shouldQualifyMql,
        mql_triggered_at: shouldQualifyMql ? new Date() : current.mql_triggered_at,
      },
      include: {
        adClick: true,
      },
    });

    // Update memory store fallback if exists
    for (const [phone, cust] of memoryCustomers.entries()) {
      if (cust.id === customerId) {
        cust.mql_bubble_count = newCount;
        cust.is_mql = updatedCustomer.is_mql;
        cust.mql_triggered_at = updatedCustomer.mql_triggered_at;
        break;
      }
    }

    // 3. Jika baru saja memenuhi MQL dan auto lead aktif, picu event CAPI 'Lead'
    if (shouldQualifyMql && mqlAutoLead) {
      try {
        const { capiService } = await import('../capi.service');
        const { auditService } = await import('../audit.service');

        const capiResult = await capiService.sendCapiEvent({
          eventName: 'Lead',
          customer: updatedCustomer,
          adClick: (updatedCustomer as any)?.adClick || undefined,
          tenantId,
          customData: {
            mql_bubble_count: newCount,
            mql_threshold: mqlThreshold,
            triggered_reason: 'MQL_BUBBLE_THRESHOLD_REACHED',
          },
        });

        if (capiResult.success) {
          console.log(`[MQL AUTOMATION] Customer ${customerId} (${updatedCustomer.phone}) reached ${newCount} bubbles (threshold: ${mqlThreshold}). Lead event sent to Meta CAPI.`);
          await auditService.logAdminAction({
            apiKey: 'SYSTEM_MQL_WORKER',
            adminIdentity: 'System (MQL Automation)',
            action: 'MQL_LEAD_EVENT_SENT',
            targetId: customerId,
            payload: {
              phone: updatedCustomer.phone,
              mql_bubble_count: newCount,
              mql_threshold: mqlThreshold,
              fbtrace_id: capiResult.fbtrace_id,
              hasAdClick: !!(updatedCustomer as any)?.adClick,
            },
          });
        } else {
          console.warn(`[MQL AUTOMATION] Lead event skipped or failed for customer ${customerId}: ${capiResult.message}`);
        }
      } catch (capiErr: any) {
        console.error(`[MQL AUTOMATION] Failed to send Lead CAPI event for customer ${customerId}:`, capiErr.message);
      }

      // Live Chat Hub publish for real-time dashboard UI update
      try {
        const { getLiveChatHub } = await import('../live-chat-hub.service');
        getLiveChatHub().publish({
          type: 'conversation.updated',
          tenantId,
          payload: {
            event: 'customer:mql_updated',
            customerId,
            phone: updatedCustomer.phone,
            name: updatedCustomer.name,
            isMql: true,
            mqlBubbleCount: newCount,
            mqlTriggeredAt: updatedCustomer.mql_triggered_at,
          },
        }).catch(() => {});
      } catch (hubErr) {
        // ignore
      }
    }

    // Auto-sync kontak ke Google Contacts saat MQL ter-trigger
    if (shouldQualifyMql) {
      import('../google-contacts.service')
        .then(({ googleContactsService }) => {
          googleContactsService.syncCustomer(tenantId, customerId, { trigger: 'chat' }).catch(() => {});
        })
        .catch(() => {});
    }

    return { customer: updatedCustomer, newlyTriggeredMql };
  } catch (error) {
    // Memory store fallback
    for (const [phone, cust] of memoryCustomers.entries()) {
      if (cust.id === customerId) {
        cust.mql_bubble_count = (cust.mql_bubble_count || 0) + 1;
        if (!cust.is_mql && cust.mql_bubble_count >= 5) {
          cust.is_mql = true;
          cust.mql_triggered_at = new Date();
          newlyTriggeredMql = true;
        }
        return { customer: cust, newlyTriggeredMql };
      }
    }
    return { customer: null, newlyTriggeredMql: false };
  }
}
