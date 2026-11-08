import { prisma } from '../../db/client';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { canTransition, isPrematureCompletion } from '../../domain/reservation-status';
import { reservationStatusService } from '../reservation-status.service';
import { resolveDeliveryFeeSnapshot } from '../reservation-core.service';
import { resolveNextPurchaseReviewStatus } from '../capi-review-status';

/**
 * Mengambil informasi pembayaran klinik secara data-driven (QRIS & Rekening Bank).
 * Hirarki Otoritas:
 * 1. Database: `Tenant.settings.paymentInfo`
 * 2. Database: `ClinicPolicy` topic 'payment_methods'
 * 3. Fallback: Default safe clinic payment info
 */
export async function getPaymentInfo(tenantId = DEFAULT_TENANT_ID): Promise<{
  qrisImageUrl: string | null;
  bankAccounts: Array<{ bank: string; accountNumber: string; accountName: string }>;
  instructions?: string;
  customTemplate?: string | null;
}> {
  try {
    // 1. Cek Tenant.settings.paymentInfo
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true, name: true },
    });

    const settings = (tenant?.settings as any) || {};
    if (settings.paymentInfo && typeof settings.paymentInfo === 'object') {
      const pInfo = settings.paymentInfo;
      return {
        qrisImageUrl: pInfo.qrisImageUrl || null,
        bankAccounts: Array.isArray(pInfo.bankAccounts) ? pInfo.bankAccounts : [],
        instructions: pInfo.instructions || undefined,
        customTemplate: typeof pInfo.customTemplate === 'string' ? pInfo.customTemplate : null,
      };
    }

    // 2. Cek ClinicPolicy topic 'payment_methods'
    const policy = await (prisma as any).clinicPolicy.findUnique({
      where: { tenant_id_topic: { tenant_id: tenantId, topic: 'payment_methods' } },
      select: { factual_summary: true, suggested_reply: true, is_active: true },
    });

    if (policy && policy.is_active && policy.factual_summary) {
      try {
        const parsed = JSON.parse(policy.factual_summary);
        if (parsed && (parsed.bankAccounts || parsed.qrisImageUrl)) {
          return {
            qrisImageUrl: parsed.qrisImageUrl || null,
            bankAccounts: Array.isArray(parsed.bankAccounts) ? parsed.bankAccounts : [],
            instructions: parsed.instructions || undefined,
            customTemplate: typeof parsed.customTemplate === 'string' ? parsed.customTemplate : null,
          };
        }
      } catch (_) {
        // Bukan JSON, lanjut ke fallback
      }
    }

    // 3. Bila belum dikonfigurasi di DB/tenant settings, kembalikan kosong (pembayaran belum diatur)
    return {
      qrisImageUrl: null,
      bankAccounts: [],
    };
  } catch (err: any) {
    console.error('[STAFF RESERVATION] Error fetching payment info:', err.message);
    return {
      qrisImageUrl: null,
      bankAccounts: [],
    };
  }
}

/**
 * Mencatat penyelesaian pembayaran transaksi homecare oleh terapis di lapangan.
 * Mendukung pembayaran Tunai (Cash) dan Non-Tunai (Transfer / QRIS) beserta upload bukti foto ringan (bukan HD).
 */
export async function recordPayment(params: {
  reservationId: string;
  staffId: string;
  staffName: string;
  tenantId?: string;
  paymentMethod: 'CASH' | 'TRANSFER' | 'QRIS';
  amount?: number;
  proofImageB64?: string;
  notes?: string;
  isSupervisor?: boolean;
}): Promise<{ success: boolean; data?: any; error?: string }> {
  const {
    reservationId,
    staffId,
    staffName,
    tenantId = DEFAULT_TENANT_ID,
    paymentMethod,
    amount,
    proofImageB64,
    notes,
    isSupervisor = false,
  } = params;

  if (!reservationId || !staffId) {
    return { success: false, error: 'reservationId dan staffId wajib disertakan.' };
  }

  try {
    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: {
        customer: {
          include: {
            conversations: {
              orderBy: { updated_at: 'desc' },
              take: 1,
            },
          },
        },
      },
    });

    if (!reservation) {
      return { success: false, error: 'Reservasi tidak ditemukan.' };
    }

    if (reservation.tenant_id !== tenantId) {
      return { success: false, error: 'Reservasi tidak ditemukan untuk klinik ini.' };
    }

    // Gate keras 6.1 (Data Hygiene): Pembayaran dan penyelesaian kunjungan wajib memiliki bidan (kecuali supervisor override)
    if (!isSupervisor && (!reservation.assigned_staff_id || reservation.assigned_staff_id !== staffId)) {
      return { success: false, error: 'Anda tidak memiliki hak akses untuk reservasi ini atau belum ada bidan yang ditugaskan.' };
    }

    const deliveryFee = resolveDeliveryFeeSnapshot(reservation as any);
    const totalCollected = amount != null ? amount : ((reservation as any).purchase_value || 0);
    const pureTreatmentValue = amount != null ? Math.max(0, totalCollected - deliveryFee) : ((reservation as any).purchase_value || 0);
    const totalPaid = totalCollected;
    const now = new Date();

    let proofUrl: string | null = (reservation as any).proof_url ?? null;
    if (proofImageB64 && proofImageB64.startsWith('data:image/')) {
      const { mediaService } = await import('../media.service');
      const matches = proofImageB64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      const rawB64 = matches ? matches[2] : proofImageB64;
      const resized = await mediaService.resizeImageToMax(Buffer.from(rawB64, 'base64'), 800);
      const saved = await mediaService.saveOutboundMedia({
        tenantId,
        imageB64: resized.toString('base64'),
        mimeType: 'image/jpeg',
        fileName: `proof-${reservationId}.jpg`,
      });
      proofUrl = saved.hdUrl;
    }

    const purchaseReviewStatus = resolveNextPurchaseReviewStatus(reservation as any);
    const purchaseEventSentAt = (reservation as any).purchase_event_sent_at ?? null;

    let updated: any;
    const canComplete = canTransition(reservation.status, 'completed') && !isPrematureCompletion(reservation.booking_date);
    if (canComplete) {
      const applied = await reservationStatusService.applyTransition(reservation, {
        to: 'completed',
        allowUnassignedStaff: isSupervisor,
        extraData: {
          purchase_occurred_at: now,
          purchase_value: pureTreatmentValue,
          purchase_review_status: purchaseReviewStatus,
          purchase_event_sent_at: purchaseEventSentAt,
          payment_method: paymentMethod,
          proof_url: proofUrl,
        },
      });
      if (applied.ok) {
        updated = applied.reservation;
      } else {
        updated = await prisma.reservation.update({
          where: { id: reservationId },
          data: {
            purchase_occurred_at: now,
            purchase_value: pureTreatmentValue,
            purchase_review_status: purchaseReviewStatus,
            purchase_event_sent_at: purchaseEventSentAt,
            payment_method: paymentMethod,
            proof_url: proofUrl,
          },
        });
      }
    } else {
      updated = await prisma.reservation.update({
        where: { id: reservationId },
        data: {
          purchase_occurred_at: now,
          purchase_value: pureTreatmentValue,
          purchase_review_status: purchaseReviewStatus,
          purchase_event_sent_at: purchaseEventSentAt,
          payment_method: paymentMethod,
          proof_url: proofUrl,
        },
      });
    }

    try {
      const { customerService } = await import('../customer.service');
      await customerService.recalculateCustomerLtv(reservation.customer_id, tenantId);
    } catch (ltvErr: any) {
      console.warn('[STAFF RESERVATION] Failed to recalculate customer LTV on payment:', ltvErr.message);
    }

    try {
      const { reservationLifecycleService } = await import('../reservation-lifecycle.service');
      if (updated.status === 'completed' && reservation.booking_date) {
        const existingNext = await (prisma as any).followUp?.findFirst?.({
          where: {
            reservation_id: reservationId,
            type: 'NEXT_TREATMENT',
            status: { in: ['PENDING', 'QUEUED', 'SENT'] },
          },
        });
        const existingSentReview = await (prisma as any).followUp?.findFirst?.({
          where: {
            reservation_id: reservationId,
            type: { in: ['REVIEW_H1_BABY', 'REVIEW_H1_MOMS', 'REMINDER_H1'] },
            status: 'SENT',
          },
        });
        if (existingNext && existingSentReview) {
          const { sheetsSyncService } = await import('../sheets/sheets-sync.service');
          await sheetsSyncService.enqueue(reservation.id, tenantId).catch((err: any) =>
            console.warn('[STAFF RESERVATION] sheetsSync enqueue on payment failed:', err?.message)
          );
        } else {
          await reservationLifecycleService.onReservationCompleted({
            customerId: reservation.customer_id,
            reservationId: reservation.id,
            bookingDate: reservation.booking_date,
            treatmentCategory: reservation.treatment_category,
            tenantId,
          });
        }
      } else {
        console.warn(`[STAFF RESERVATION] recordPayment: reservasi ${reservation.id} completed tanpa booking_date, sheets sync dilewati`);
      }
    } catch (fuErr: any) {
      console.warn('[STAFF RESERVATION] Failed to trigger follow-up on payment:', fuErr.message);
    }

    const { auditService } = await import('../audit.service');
    await auditService.logAdminAction({
      apiKey: 'STAFF_SESSION',
      adminIdentity: staffName,
      action: 'STAFF_RECORD_PAYMENT',
      targetId: reservationId,
      payload: {
        paymentMethod,
        amount: totalPaid,
        pureTreatmentValue,
        deliveryFee,
        proofUrl,
        notes,
        ...(isSupervisor && !reservation.assigned_staff_id
          ? { supervisorOverrideUnassigned: true, overrideBy: staffId }
          : {}),
      },
      tenantId,
    });

    return {
      success: true,
      data: {
        reservationId: updated.id,
        purchaseValue: updated.purchase_value,
        purchaseOccurredAt: updated.purchase_occurred_at,
        paymentMethod,
        proofUrl,
      },
    };
  } catch (err: any) {
    console.error('[STAFF RESERVATION] Error recording payment:', err.message);
    return { success: false, error: `Gagal mencatat pembayaran: ${err.message}` };
  }
}

/**
 * Mengirimkan informasi pembayaran resmi klinik (QRIS & rekening bank)
 * langsung ke nomor WhatsApp customer secara data-driven dan anti-duplikasi file.
 */
export async function sendPaymentInfo(params: {
  reservationId: string;
  staffId: string;
  tenantId: string;
  staffName?: string;
  isSupervisor?: boolean;
}): Promise<{ success: boolean; data?: any; error?: string }> {
  const { reservationId, staffId, tenantId, staffName = 'Bidan Terapis', isSupervisor = false } = params;

  try {
    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: {
        customer: {
          include: {
            conversations: {
              where: { tenant_id: tenantId },
              orderBy: { updated_at: 'desc' },
              take: 1,
            },
          },
        },
        assigned_staff: true,
      },
    });

    if (!reservation || reservation.tenant_id !== tenantId) {
      return { success: false, error: 'Reservasi tidak ditemukan.' };
    }

    if (!isSupervisor) {
      const assigned = reservation.assigned_staff_id;
      if (!assigned || assigned !== staffId) {
        return {
          success: false,
          error: 'Anda tidak memiliki hak akses untuk jadwal terapis lain.',
        };
      }
    }

    const conversation = (reservation as any).customer?.conversations?.[0];
    if (!conversation) {
      return {
        success: false,
        error: 'Belum ada percakapan WhatsApp yang terhubung dengan customer ini.',
      };
    }

    const paymentInfo = await getPaymentInfo(tenantId);
    const hasQris = !!paymentInfo.qrisImageUrl;
    const hasBank = Array.isArray(paymentInfo.bankAccounts) && paymentInfo.bankAccounts.length > 0;

    if (!hasQris && !hasBank) {
      return {
        success: false,
        error: 'Informasi pembayaran (QRIS / Rekening Bank) belum diatur di Pengaturan Klinik.',
      };
    }

    const patientName = reservation.customer?.name || 'Bunda';
    const therapistName = reservation.assigned_staff?.name || staffName;

    const treatmentFee = typeof reservation.purchase_value === 'number' ? reservation.purchase_value : 0;
    const deliveryFee = resolveDeliveryFeeSnapshot(reservation as any);
    const totalFee = treatmentFee + deliveryFee;

    const rawTemplate = (paymentInfo as any).customTemplate;
    const hasCustomTemplate = typeof rawTemplate === 'string' && rawTemplate.trim().length > 0;
    let fullText: string;
    if (hasCustomTemplate) {
      const daftarRekening = hasBank
        ? paymentInfo.bankAccounts.map((a) => `• *${a.bank}*: \`${a.accountNumber}\`\n  a.n. ${a.accountName}`).join('\n')
        : '-';
      const rincianBiaya = totalFee > 0
        ? (treatmentFee > 0 && deliveryFee > 0
          ? `Treatment: Rp ${treatmentFee.toLocaleString('id-ID')} + Ongkir: Rp ${deliveryFee.toLocaleString('id-ID')}`
          : `Total: Rp ${totalFee.toLocaleString('id-ID')}`)
        : '-';
      const keteranganQris = hasQris ? 'Barcode QRIS terlampir di atas untuk kemudahan scan pembayaran' : '-';
      const vars: Record<string, string> = {
        '{nama_pasien}': patientName,
        '{total_tagihan}': totalFee > 0 ? `Rp ${totalFee.toLocaleString('id-ID')}` : '-',
        '{rincian_biaya}': rincianBiaya,
        '{daftar_layanan}': reservation.treatment_detail || '-',
        '{daftar_rekening}': daftarRekening,
        '{keterangan_qris}': keteranganQris,
        '{petunjuk}': (paymentInfo.instructions || '').trim() || '-',
        '{nama_terapis}': therapistName,
      };
      fullText = rawTemplate;
      for (const [k, v] of Object.entries(vars)) {
        fullText = fullText.split(k).join(v);
      }
      fullText = fullText.replace(/\{[a-z_]+\}/gi, '');
    } else {
      const lines: string[] = [
        `Halo Bunda ${patientName}, berikut informasi pembayaran resmi klinik:`,
      ];
      if (totalFee > 0) {
        lines.push('');
        lines.push(`💰 *Total Tagihan:* Rp ${totalFee.toLocaleString('id-ID')}`);
        if (treatmentFee > 0 && deliveryFee > 0) {
          lines.push(`_(Treatment: Rp ${treatmentFee.toLocaleString('id-ID')} + Ongkir: Rp ${deliveryFee.toLocaleString('id-ID')})_`);
        }
        if (reservation.treatment_detail) {
          lines.push(`📋 *Layanan:* ${reservation.treatment_detail}`);
        }
      }
      if (hasBank) {
        lines.push('');
        lines.push('🏦 *Transfer Bank Resmi Klinik:*');
        for (const acc of paymentInfo.bankAccounts) {
          lines.push(`• *${acc.bank}*: \`${acc.accountNumber}\``);
          lines.push(`  a.n. ${acc.accountName}`);
        }
      }
      if (hasQris) {
        lines.push('');
        lines.push('📱 _(Barcode QRIS terlampir di atas untuk kemudahan scan pembayaran)_');
      }
      if (paymentInfo.instructions && paymentInfo.instructions.trim()) {
        lines.push('');
        lines.push(`ℹ️ _${paymentInfo.instructions.trim()}_`);
      }
      lines.push('');
      lines.push('Mohon konfirmasi atau kirimkan bukti transfer ke sini setelah pembayaran ya Bunda. Terima kasih banyak 🙏');
      lines.push('');
      lines.push(`~ ${therapistName}`);
      fullText = lines.join('\n');
    }

    const { liveChatService } = await import('../live-chat.service');

    let sendResult: any = null;

    if (hasQris && paymentInfo.qrisImageUrl) {
      const { splitImageCaption } = await import('../caption-splitter');
      const { imageCaption, followUpTexts } = splitImageCaption(fullText, 1000);

      sendResult = await liveChatService.sendAdminReply({
        conversationId: conversation.id,
        text: imageCaption,
        mediaUrl: paymentInfo.qrisImageUrl,
        mimeType: 'image/png',
        fileName: 'qris-klinik.png',
        tenantId,
        adminName: therapistName,
        forceEscalate: true,
      });

      for (const followUp of followUpTexts) {
        await liveChatService.sendAdminReply({
          conversationId: conversation.id,
          text: followUp,
          tenantId,
          adminName: therapistName,
          forceEscalate: true,
        });
      }
    } else {
      sendResult = await liveChatService.sendAdminReply({
        conversationId: conversation.id,
        text: fullText,
        tenantId,
        adminName: therapistName,
        forceEscalate: true,
      });
    }

    if (!sendResult.success) {
      return {
        success: false,
        error: sendResult.error?.message || 'Gagal mengirim informasi pembayaran ke WhatsApp.',
      };
    }

    const { auditService } = await import('../audit.service');
    await auditService.logAdminAction({
      apiKey: 'STAFF_SESSION',
      adminIdentity: therapistName,
      action: 'STAFF_SEND_PAYMENT_INFO',
      targetId: reservationId,
      payload: {
        conversationId: conversation.id,
        hasQris,
        totalFee,
        bankAccountsCount: paymentInfo.bankAccounts.length,
      },
      tenantId,
    });

    return {
      success: true,
      data: {
        reservationId,
        sentAt: new Date(),
        hasQris,
        totalFee,
        waResult: sendResult,
      },
    };
  } catch (err: any) {
    console.error('[STAFF RESERVATION] Error sending payment info:', err.message);
    return { success: false, error: `Gagal mengirim info pembayaran: ${err.message}` };
  }
}
