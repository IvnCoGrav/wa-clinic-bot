import { prisma } from '../../db/client';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { getRollingVariant } from '../../config/followup-templates';
import { buildScheduledAtRange } from './constants';

/**
 * Mengambil daftar antrian follow-up dengan pagination, filter, search, dan sorting.
 */
export async function listFollowUps(
  tenantId: string = DEFAULT_TENANT_ID,
  options: {
    status?: string;
    type?: string;
    search?: string;
    dateFilter?: string;
    page?: number;
    pageSize?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  } = {}
): Promise<{
  data: any[];
  pagination: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}> {
  const page = Math.max(1, options.page || 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize || 20));
  const skip = (page - 1) * pageSize;

  const where: any = {
    tenant_id: tenantId,
  };

  if (options.status && options.status !== 'all') {
    where.status = options.status;
  }

  if (options.type && options.type !== 'all') {
    where.type = options.type;
  }

  if (options.dateFilter && options.dateFilter !== 'all') {
    const range = buildScheduledAtRange(options.dateFilter);
    if (range) {
      where.scheduled_at = range;
    }
  }

  if (options.search) {
    const q = options.search.trim();
    where.customer = {
      OR: [
        { phone: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
      ],
    };
  }

  const sortOrder = options.sortOrder === 'desc' ? 'desc' : 'asc';
  let orderBy: any[] = [];

  switch (options.sortBy) {
    case 'scheduled_at':
      orderBy = [{ scheduled_at: sortOrder }, { created_at: 'desc' }];
      break;
    case 'created_at':
      orderBy = [{ created_at: sortOrder }];
      break;
    case 'status':
      orderBy = [{ status: sortOrder }, { scheduled_at: 'asc' }];
      break;
    case 'type':
      orderBy = [{ type: sortOrder }, { stage: sortOrder }, { scheduled_at: 'asc' }];
      break;
    case 'customer_name':
    case 'name':
      orderBy = [{ customer: { name: sortOrder } }, { scheduled_at: 'asc' }];
      break;
    default:
      orderBy = options.sortBy
        ? [{ [options.sortBy]: sortOrder }]
        : [{ scheduled_at: sortOrder }, { created_at: 'desc' }];
      break;
  }

  try {
    const [total, data] = await Promise.all([
      prisma.followUp.count({ where }),
      prisma.followUp.findMany({
        where,
        select: {
          id: true,
          customer_id: true,
          type: true,
          stage: true,
          treatment_category: true,
          custom_text: true,
          scheduled_at: true,
          sent_at: true,
          status: true,
          cancel_reason: true,
          created_at: true,
          updated_at: true,
          customer: {
            select: {
              id: true,
              name: true,
              phone: true,
              kelurahan: true,
              kecamatan: true,
              kota: true,
              status: true,
              is_sandbox_test: true,
              conversations: {
                select: {
                  id: true,
                  last_message_at: true,
                  is_human_handling: true,
                },
                take: 1,
                orderBy: { last_message_at: 'desc' },
              },
            },
          },
          reservation: {
            select: {
              id: true,
              booking_date: true,
              treatment_category: true,
              treatment_detail: true,
            },
          },
        },
        orderBy,
        skip,
        take: pageSize,
      }),
    ]);

    const enriched = (data as any[]).map((item: any) => ({
      ...item,
      variant: getRollingVariant(item.customer_id || item.customer?.id || '', item.scheduled_at),
    }));
    return {
      data: enriched,
      pagination: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize) || 1,
      },
    };
  } catch (err: any) {
    console.error('[FollowUp Service] Failed to list follow-ups:', err.message);
    return {
      data: [],
      pagination: {
        total: 0,
        page: 1,
        pageSize,
        totalPages: 1,
      },
    };
  }
}
