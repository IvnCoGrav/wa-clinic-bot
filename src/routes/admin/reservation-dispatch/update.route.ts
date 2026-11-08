import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../db/client';
import { tenantOf, sanitizeDurationMinutes } from '../route-helpers';
import { memoryReservations } from '../stores';
import { auditService } from '../../../services/audit.service';
import { googleCalendarService } from '../../../services/google-calendar.service';
import { resolvePurchaseReviewOnConfirm } from '../../../services/capi-review-status';
import { isPrematureCompletion } from '../../../domain/reservation-status';
import {
  reservationStatusService,
  InvalidTransitionError,
  PrematureCompletionError,
} from '../../../services/reservation-status.service';
import {
  mergeNotesIntoRawText,
  extractNotesFromRawText,
  classifyPatientEntity,
} from '../../../utils/reservation-text-parser';
import { isValidChildName } from '../../../utils/name-sanitizer';

export async function registerUpdateRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * PATCH /api/admin/reservation/:id
   * Edit lengkap rincian reservasi: data pasien, anak/bayi, jadwal, layanan, tarif, status, penugasan terapis, dll.
   */
  fastify.patch(
    '/api/admin/reservation/:id',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: {
          treatmentCategory?: 'BABY' | 'MOMS' | 'BOTH' | 'KIDS' | 'BUNDLE';
          treatmentDetail?: string;
          bookingDate?: string | null;
          assignedStaffId?: string | null;
          purchaseValue?: number;
          discountAmount?: number | null;
          discount_amount?: number | null;
          status?: 'pending' | 'hold' | 'confirmed' | 'completed' | 'cancelled';
          ongkir?: number | null;
          notes?: string;
          rawText?: string;
          paymentMethod?: 'CASH' | 'TRANSFER' | 'QRIS' | null;
          customerName?: string;
          customerPhone?: string;
          address?: string;
          kecamatan?: string;
          kota?: string;
          kelurahan?: string;
          customerAddressId?: string | null;
          customer_address_id?: string | null;
          durationMinutes?: number | null;
        };
      }>,
      reply: FastifyReply
    ) => {
      const tenantId = tenantOf(request);
      const { id } = request.params;
      // Dual-casing: lengkapi camelCase dari snake_case bila camel absen (kontrak toleran).
      // Tidak menimpa nilai camel yang sudah dikirim; "" tetap diteruskan apa adanya.
      const rawBody = (request.body || {}) as any;
      const body: any = { ...rawBody };
      const dualCaseMap: Record<string, string> = {
        treatment_category: 'treatmentCategory',
        treatment_detail: 'treatmentDetail',
        booking_date: 'bookingDate',
        assigned_staff_id: 'assignedStaffId',
        purchase_value: 'purchaseValue',
        discount_amount: 'discountAmount',
        duration_minutes: 'durationMinutes',
        payment_method: 'paymentMethod',
        customer_name: 'customerName',
        customer_phone: 'customerPhone',
        customer_address_id: 'customerAddressId',
      };
      for (const [snakeKey, camelKey] of Object.entries(dualCaseMap)) {
        if (body[camelKey] === undefined && body[snakeKey] !== undefined) body[camelKey] = body[snakeKey];
      }

      const {
        treatmentCategory,
        treatmentDetail,
        bookingDate,
        assignedStaffId,
        purchaseValue,
        discountAmount,
        status,
        notes,
        rawText,
        paymentMethod,
        customerName,
        customerPhone,
        address,
        kecamatan,
        kota,
        kelurahan,
        landmark,
        babies,
        durationMinutes: reqDurationMinutes,
      } = body;

      let existing: any = null;
      try {
        existing = await prisma.reservation.findFirst({
          where: { id, tenant_id: tenantId },
          include: { customer: { include: { children: true } }, customer_address: true },
        });
      } catch (dbErr: any) {
        console.warn(`[Admin API] DB query failed for reservation ${id}, checking in-memory store:`, dbErr.message);
      }

      const normalizeTreatmentCategory = (cat?: string): 'BABY' | 'KIDS' | 'MOMS' | 'BOTH' | undefined => {
        if (!cat) return undefined;
        const upper = String(cat).toUpperCase();
        if (upper === 'BUNDLE' || upper === 'BOTH') return 'BOTH';
        if (upper === 'MOMS') return 'MOMS';
        if (upper === 'KIDS') return 'KIDS';
        if (upper === 'BABY') return 'BABY';
        return 'BABY';
      };
      const normalizedCat = treatmentCategory !== undefined ? normalizeTreatmentCategory(treatmentCategory) : undefined;

      if (!existing) {
        const mock = memoryReservations.get(id);
        if (mock && mock.tenant_id === tenantId) {
          const completionMockDate = bookingDate !== undefined
            ? (bookingDate ? new Date(bookingDate) : null)
            : mock.booking_date;
          if (status !== undefined) {
            try {
              reservationStatusService.assertTransition(
                { ...mock, booking_date: completionMockDate },
                status,
                { force: (body as any)?.forceComplete }
              );
            } catch (err: any) {
              if (err instanceof InvalidTransitionError) {
                return reply.status(409).send({
                  success: false,
                  code: 'ILLEGAL_TRANSITION',
                  error: err.message,
                });
              }
              if (err instanceof PrematureCompletionError) {
                return reply.status(400).send({
                  success: false,
                  code: 'PREMATURE_COMPLETION_BLOCKED',
                  error: 'Reservasi masa depan tidak dapat ditandai sebagai completed sebelum tanggal kunjungan tiba. Gunakan forceComplete: true bila ada persetujuan darurat.',
                });
              }
              throw err;
            }
          }
          if (normalizedCat !== undefined) mock.treatment_category = normalizedCat;
          if (treatmentDetail !== undefined) mock.treatment_detail = treatmentDetail;
          if (purchaseValue !== undefined) mock.purchase_value = purchaseValue;
          if (discountAmount !== undefined) {
            const d = discountAmount === null ? null : Math.round(Number(discountAmount));
            if (d !== null && (!Number.isFinite(d) || d < 0)) {
              return reply.status(400).send({ success: false, error: 'discountAmount tidak valid.' });
            }
            const gross = purchaseValue !== undefined ? Number(purchaseValue) : Number(mock.purchase_value || 0);
            mock.discount_amount = d === null ? null : Math.min(d, Math.max(0, gross));
          }
          if (body.customerAddressId !== undefined || body.customer_address_id !== undefined) {
            const caId = body.customerAddressId !== undefined ? body.customerAddressId : body.customer_address_id;
            mock.customer_address_id = caId || null;
          }
          if (status === 'confirmed' && mock.status !== 'confirmed') {
            mock.purchase_review_status = resolvePurchaseReviewOnConfirm(mock as any);
          }
          if (status !== undefined) mock.status = status;
          if (notes !== undefined) {
            mock.notes = notes;
            const fallbackTitle = `[Admin Manual] ${normalizedCat || mock.treatment_category}: ${treatmentDetail || mock.treatment_detail || ''}`;
            mock.raw_text = mergeNotesIntoRawText(mock.raw_text, notes, fallbackTitle);
          }
          if (rawText !== undefined) mock.raw_text = rawText;
          if (paymentMethod !== undefined) mock.payment_method = paymentMethod;
          if (assignedStaffId !== undefined) {
            const staffId = (assignedStaffId as string) || null;
            mock.assigned_staff_id = staffId;
            // Paritas relasi DB di mode memory: lookup staff nyata (tanpa hardcode nama).
            // Bila lookup gagal (DB offline), relasi null — UI fallback ke staffList via FK.
            let staffObj: { id: string; name: string; phone?: string } | null = null;
            if (staffId) {
              try {
                const staff = await prisma.staff.findFirst({
                  where: { id: staffId, tenant_id: tenantId },
                  select: { id: true, name: true },
                });
                staffObj = staff ? { id: staff.id, name: staff.name } : null;
              } catch {
                staffObj = null;
              }
            }
            mock.assigned_staff = staffObj;
          }
          if (bookingDate !== undefined) mock.booking_date = bookingDate ? new Date(bookingDate) : null;
          mock.updated_at = new Date();
          memoryReservations.set(id, mock);
          return reply.status(200).send({
            success: true,
            data: {
              ...mock,
              notes: mock.notes || extractNotesFromRawText(mock.raw_text),
            },
            note: 'Fallback in-memory mode',
          });
        }
        return reply.status(404).send({ success: false, error: 'Reservation not found' });
      }

      try {
        // Validasi FK staff tenant-scoped (paritas jalur /assign-staff) bila penugasan diisi.
        if (assignedStaffId) {
          const staffExists = await prisma.staff.findFirst({
            where: { id: assignedStaffId, tenant_id: tenantId },
            select: { id: true },
          });
          if (!staffExists) {
            return reply.status(400).send({ success: false, error: 'Staff yang dipilih tidak valid.' });
          }
        }
        const isBecomingConfirmed = status === 'confirmed' && existing.status !== 'confirmed';
        const isBecomingCancelled = status === 'cancelled' && existing.status !== 'cancelled';
        const isBecomingCompleted = status === 'completed' && existing.status !== 'completed';
        const staffChanged = assignedStaffId !== undefined && assignedStaffId !== existing.assigned_staff_id;

        const updateData: any = {};
        if (normalizedCat !== undefined) updateData.treatment_category = normalizedCat;
        if (treatmentDetail !== undefined) updateData.treatment_detail = treatmentDetail;
        if (purchaseValue !== undefined) updateData.purchase_value = purchaseValue;
        if (discountAmount !== undefined) {
          const d = discountAmount === null ? null : Math.round(Number(discountAmount));
          if (d !== null && (!Number.isFinite(d) || d < 0)) {
            return reply.status(400).send({ success: false, error: 'discountAmount tidak valid.' });
          }
          const gross = purchaseValue !== undefined ? Number(purchaseValue) : Number(existing.purchase_value || 0);
          updateData.discount_amount = d === null ? null : Math.min(d, Math.max(0, gross));
        }
        if (status !== undefined) {
          const targetBookingDate = bookingDate !== undefined
            ? (bookingDate ? new Date(bookingDate) : null)
            : existing.booking_date;
          try {
            reservationStatusService.assertTransition(
              { ...existing, booking_date: targetBookingDate },
              status,
              { force: (body as any)?.forceComplete }
            );
          } catch (err: any) {
            if (err instanceof InvalidTransitionError) {
              return reply.status(409).send({
                success: false,
                code: 'ILLEGAL_TRANSITION',
                error: err.message,
              });
            }
            if (err instanceof PrematureCompletionError) {
              return reply.status(400).send({
                success: false,
                code: 'PREMATURE_COMPLETION_BLOCKED',
                error: 'Reservasi masa depan tidak dapat ditandai sebagai completed sebelum tanggal kunjungan tiba. Gunakan forceComplete: true bila ada persetujuan darurat.',
              });
            }
            throw err;
          }
          updateData.status = status;
        }
        if (isBecomingConfirmed) {
          updateData.purchase_review_status = resolvePurchaseReviewOnConfirm(existing as any);
        }
        if (body.customerAddressId !== undefined || body.customer_address_id !== undefined) {
          const caId = body.customerAddressId !== undefined ? body.customerAddressId : body.customer_address_id;
          if (!caId) {
            // `null` eksplisit = lepas tautan kartu (detach) — hormati.
            updateData.customer_address_id = null;
          } else {
            // Kontrak kanonis kartu alamat: admin memilih kartu dari buku alamat
            // customer. Tanpa validasi kepemilikan, ID kartu customer lain bisa
            // ditempelkan (IDOR lintas tenant) dan ongkir reservasi tetap memakai
            // tarif rumah lama → "alamat berubah tapi ongkir bohong".
            const { customerService } = await import('../../../services/customer.service');
            let cards: any[] = [];
            try {
              cards = (await customerService.getSavedAddresses(existing.customer_id, tenantId)) as any[];
            } catch {
              cards = [];
            }
            const chosen = (Array.isArray(cards) ? cards : []).find((c: any) => c?.id === caId);
            if (!chosen) {
              return reply.status(400).send({
                success: false,
                code: 'CUSTOMER_ADDRESS_NOT_FOUND',
                error: 'Kartu alamat yang dipilih tidak ada di buku alamat customer ini.',
              });
            }
            updateData.customer_address_id = chosen.id;
            // Snapshot ongkir: reservasi WAJIB mengikuti tarif kartu yang dipilih.
            if (typeof chosen.ongkir === 'number') updateData.delivery_fee = chosen.ongkir;
          }
        }

        // RC-1 (anti ghost-shadowing): admin mengubah TEKS alamat TANPA ID kartu
        // eksplisit → tempelkan ke kartu kanonis via seam `upsertSavedAddress`
        // (single source of truth JSON + tabel customer_addresses):
        //  - rumah SAMA (addressesMatch) → perbarui teks pada kartu itu (koordinat dipertahankan).
        //  - rumah BEDA → buat kartu sekunder; DILARANG mencampur teks baru dengan
        //    pin presisi lama (data hibrida). Reservasi INI relink ke kartu baru.
        // DILARANG menulis prisma.customerAddress.* langsung.
        // A-011: `null` EKSPLISIT = niat admin melepas kartu (detach) — hormati,
        // JANGAN jalankan RC-1. Field ABSEN (undefined) saja yang boleh auto-resolve
        // via RC-1. Tanpa ini, kirim customerAddressId:null + address → tertaut lagi
        // ke kartu hasil resolusi teks (niat admin hijacked).
        const hasExplicitAddressId =
          body.customerAddressId !== undefined
            ? body.customerAddressId === null || Boolean(body.customerAddressId)
            : body.customer_address_id !== undefined
              ? body.customer_address_id === null || Boolean(body.customer_address_id)
              : false;
        // Kartu NON-KOSONG yang dipilih eksplisit = alamat PER-JADWAL.
        // Pilihan ini DILARANG menulis balik ke profil induk (anti data hibrida:
        // jalan rumah kedua + wilayah rumah pertama, insiden Briella 2026-11-06).
        const hasExplicitCardSelection = Boolean(body.customerAddressId);
        if (address !== undefined && address !== null && String(address).trim() !== '' && existing.customer_id && !hasExplicitAddressId) {
          try {
            const { addressesMatch } = await import('../../../domain/customer-address');
            const { customerService } = await import('../../../services/customer.service');
            const card: any = (existing as any).customer_address || null;
            const cust: any = (existing as any).customer || {};
            const sameHouse = card
              ? addressesMatch(
                  { address: card.address, kelurahan: card.kelurahan, kecamatan: card.kecamatan, kota: card.kota, lat: card.lat, lng: card.lng },
                  { address, kelurahan, kecamatan, kota }
                )
              : false;
            const entry = await customerService.upsertSavedAddress(existing.customer_id, {
              address: String(address).trim(),
              // Wilayah HANYA boleh diwarisi bila ini rumah yang SAMA. Untuk
              // rumah berbeda, menyalin kelurahan/kecamatan/kota dari kartu lain
              // (atau profil root) menghasilkan wilayah palsu — akar insiden
              // "Gunung Anyar dicap Tandes" 2026-11-05. Biarkan null sampai
              // di-geocode/diverifikasi; jangan mengarang administratif.
              kelurahan: kelurahan ?? (sameHouse ? (card?.kelurahan ?? cust?.kelurahan ?? null) : null),
              kecamatan: kecamatan ?? (sameHouse ? (card?.kecamatan ?? cust?.kecamatan ?? null) : null),
              kota: kota ?? (sameHouse ? (card?.kota ?? cust?.kota ?? null) : null),
              lat: sameHouse ? (card?.lat ?? cust?.lat ?? null) : null,
              lng: sameHouse ? (card?.lng ?? cust?.lng ?? null) : null,
              // A-010: baris Prisma customer_address memakai snake_case
              // (is_primary/distance_km/location_source); fallback camelCase hanya
              // untuk objek buatan fixture/lama. Tanpa ini kartu sekunder
              // terpromosi primary saat koreksi teks (isPrimary selalu true).
              distanceKm: sameHouse ? (card?.distance_km ?? card?.distanceKm ?? cust?.distance_km ?? null) : null,
              ongkir: sameHouse ? (card?.ongkir ?? cust?.ongkir ?? null) : null,
              locationSource: sameHouse ? (card?.location_source ?? card?.locationSource ?? cust?.location_source ?? null) : null,
              isPrimary: card ? (sameHouse ? (card?.is_primary ?? card?.isPrimary ?? true) : false) : true,
            }, tenantId);
            if (entry?.id) {
              updateData.customer_address_id = entry.id;
              // Snapshot ongkir (pola KB-6): selaraskan delivery_fee reservasi dgn kartu terpilih.
              if (typeof entry.ongkir === 'number') updateData.delivery_fee = entry.ongkir;
            }
          } catch (rc1Err: any) {
            console.warn('[Admin API] RC-1 address relink skipped (best-effort):', rc1Err?.message);
          }
        }
        
        // Handle notes via raw_text: TIDAK menugaskan updateData.notes karena model Reservation tidak punya kolom notes di Prisma
        if (rawText !== undefined) {
          updateData.raw_text = rawText;
        } else if (notes !== undefined) {
          const fallbackTitle = `[Admin Manual] ${treatmentCategory || existing.treatment_category}: ${treatmentDetail || existing.treatment_detail || ''}`;
          updateData.raw_text = mergeNotesIntoRawText(existing.raw_text, notes, fallbackTitle);
        }
        if (paymentMethod !== undefined) updateData.payment_method = paymentMethod;
        if (reqDurationMinutes !== undefined) {
          if (reqDurationMinutes === null || (reqDurationMinutes as unknown) === '') {
            updateData.duration_minutes = null;
          } else {
            const d = sanitizeDurationMinutes(reqDurationMinutes);
            if (d !== null) updateData.duration_minutes = d;
          }
        }

        if (assignedStaffId !== undefined) {
          updateData.assigned_staff_id = assignedStaffId || null;
        }

        // Fondasional: jika ongkir dikirim saat edit, sinkronkan ke Customer.ongkir.
        // KECUALI saat admin memilih kartu per-jadwal: tarif itu milik reservasi
        // (snapshot delivery_fee), bukan tarif default profil.
        if (!hasExplicitCardSelection && (body as any).ongkir !== undefined && (body as any).ongkir !== null && existing.customer_id) {
          try {
            await prisma.customer.update({
              where: { id: existing.customer_id, tenant_id: tenantId },
              data: { ongkir: Number((body as any).ongkir) },
            });
          } catch (e) {
            console.warn('[Admin API] Failed to update Customer.ongkir on edit:', (e as Error).message);
          }
        }

        let parsedBookingDate: Date | null | undefined = undefined;
        if (bookingDate !== undefined) {
          if (bookingDate === null || bookingDate === '') {
            updateData.booking_date = null;
            parsedBookingDate = null;
          } else {
            const d = new Date(bookingDate);
            if (!isNaN(d.getTime())) {
              updateData.booking_date = d;
              parsedBookingDate = d;
            }
          }
        }

        // Pengecekan bentrok staf pada edit jadwal / reassign (kecuali force: true)
        const targetDate = parsedBookingDate !== undefined ? parsedBookingDate : existing.booking_date;
        const targetStaff = assignedStaffId !== undefined ? (assignedStaffId || null) : existing.assigned_staff_id;
        const targetDur = updateData.duration_minutes ?? existing.duration_minutes ?? 60;
        const isForce = Boolean((body as any).force);
        const isActiveStatus = (updateData.status || existing.status) !== 'cancelled';

        if (targetStaff && targetDate && isActiveStatus && !isForce && (staffChanged || parsedBookingDate !== undefined)) {
          const { findOverlappingStaffReservations } = await import('../../../services/reservation-core.service');
          const staffConflicts = await findOverlappingStaffReservations({
            tenantId,
            staffId: targetStaff,
            bookingDate: targetDate,
            durationMinutes: targetDur,
            excludeId: existing.id,
          });
          if (staffConflicts.length > 0) {
            return reply.status(409).send({
              success: false,
              code: 'STAFF_COLLISION',
              error: 'Jadwal terapis bentrok dengan reservasi lain.',
              conflict: staffConflicts[0],
            });
          }
        }

        // Guard anti-completed prematur (edit penuh): tolak menandai selesai
        // jadwal > 24 jam ke depan sebelum tanggal kunjungan tiba.
        const completionTargetDate = parsedBookingDate !== undefined ? parsedBookingDate : existing.booking_date;
        if (isBecomingCompleted && isPrematureCompletion(completionTargetDate) && !(body as any)?.forceComplete) {
          return reply.status(400).send({
            success: false,
            code: 'PREMATURE_COMPLETION_BLOCKED',
            error: 'Reservasi masa depan tidak dapat ditandai sebagai completed sebelum tanggal kunjungan tiba. Gunakan forceComplete: true bila ada persetujuan darurat.',
          });
        }

        // Gate keras 6.1: Wajibkan bidan saat completed
        if (isBecomingCompleted && !targetStaff && !(body as any)?.allowUnassignedStaff) {
          return reply.status(400).send({
            success: false,
            code: 'STAFF_ASSIGNMENT_REQUIRED',
            error: 'Reservasi tidak dapat diselesaikan tanpa penugasan bidan (assigned_staff_id). Tugaskan bidan terlebih dahulu atau sertakan allowUnassignedStaff: true.',
          });
        }

        const updated = await prisma.reservation.update({
          where: { id },
          data: updateData,
          include: {
            customer: {
              include: {
                children: true,
              },
            },
            customer_address: true,
            assigned_staff: true,
          },
        });

        // ── Side-effects: transisi status confirmed/cancelled & penugasan staff ──
        if (isBecomingConfirmed) {
          const targetBookingDate = parsedBookingDate || existing.booking_date;
          if (targetBookingDate) {
            try {
              const { followUpService } = await import('../../../services/follow-up.service');
              await followUpService.createReservationFollowUps({
                reservationId: id,
                customerId: existing.customer_id,
                bookingDate: targetBookingDate,
                treatmentCategory: updated.treatment_category,
                tenantId: tenantId,
              });
            } catch (fuErr: any) {
              console.warn('[Admin API] Failed to schedule follow-ups on becoming confirmed:', fuErr.message);
            }
          }
          if (!updated.google_calendar_event_id && (parsedBookingDate || existing.booking_date)) {
            try {
              const cName = customerName || existing.customer?.name || 'Bunda';
              const calEventId = await googleCalendarService.createEvent(updated, cName);
              if (calEventId) {
                await prisma.reservation.update({ where: { id }, data: { google_calendar_event_id: calEventId } });
                (updated as any).google_calendar_event_id = calEventId;
              }
            } catch (gcErr: any) {
              console.error('[Admin API] Google Calendar Event create on edit failed:', gcErr.message);
            }
          }
          // CAPI Purchase decoupled: tidak auto-kirim saat edit menjadi confirmed — eksklusif via Purchase Queue.
        }
        if (isBecomingCompleted) {
          const targetBookingDate = parsedBookingDate || existing.booking_date;
          if (targetBookingDate) {
            try {
              const { reservationLifecycleService } = await import('../../../services/reservation-lifecycle.service');
              await reservationLifecycleService.onReservationCompleted({
                customerId: existing.customer_id,
                reservationId: id,
                bookingDate: targetBookingDate,
                treatmentCategory: updated.treatment_category,
                tenantId: existing.tenant_id || tenantId,
              });
            } catch (fuErr: any) {
              console.warn('[Admin API] Failed to sync follow-ups on becoming completed:', fuErr.message);
            }
          }
        }
        if (isBecomingCancelled) {
          try {
            const { followUpService } = await import('../../../services/follow-up.service');
            await followUpService.onReservationCancelled(id, existing.tenant_id || tenantId);
          } catch (fuErr: any) {
            console.warn('[Admin API] Failed to cancel follow-ups on becoming cancelled:', fuErr.message);
          }
          if (existing.assigned_staff_id) {
            const cancelReason = (body as any)?.cancelReason || (body as any)?.reason || (body as any)?.cancel_reason || undefined;
            import('../../../services/staff-notification.service').then(({ staffNotificationService }) => {
              staffNotificationService.sendReservationCancelledNotification(id, existing.assigned_staff_id!, cancelReason).catch((e: any) =>
                console.warn('[Admin API] Failed to send Telegram cancelled notification (edit):', e.message)
              );
            }).catch(() => {});
          }
          if (updated.google_calendar_event_id) {
            try {
              await googleCalendarService.deleteEvent(updated.google_calendar_event_id);
              await prisma.reservation.update({ where: { id }, data: { google_calendar_event_id: null } }).catch(() => {});
            } catch (gcErr: any) {
              console.warn('[Admin API] Google Calendar delete on cancel failed:', gcErr.message);
            }
          }
        }
        if (staffChanged && assignedStaffId) {
          try {
            const { staffNotificationService } = await import('../../../services/staff-notification.service');
            // Buffer 5 menit: jadwalkan ulang (menimpa pending lama) — terapis baru
            // baru menerima Telegram setelah jendela, agar koreksi admin tidak bocor.
            staffNotificationService.scheduleReservationAssignmentNotification(id, assignedStaffId).catch((err: any) => {
              console.error('[Admin API] Failed to schedule staff notification on edit:', err.message);
            });
            if (existing.assigned_staff_id && existing.assigned_staff_id !== assignedStaffId) {
              const newStaffName = (updated as any)?.assigned_staff?.name || undefined;
              // State-gate: staf lama hanya dinotifikasi bila penugasan sebelumnya
              // BENAR-BENAR sudah terkirim (bukan masih dalam buffer pending).
              const oldStaffWasNotified = (existing as any).assignment_notified_at != null;
              staffNotificationService.sendTaskUnassignedNotification(id, existing.assigned_staff_id, newStaffName, oldStaffWasNotified).catch((err: any) => {
                console.warn('[Admin API] Failed to send unassigned notification to old staff:', err.message);
              });
            }
          } catch (err: any) {
            console.warn('[Admin API] staffNotification import failed:', err.message);
          }
        }

        // 6.3 Log pergantian penugasan bidan (ReservationStaffAssignmentLog)
        if (staffChanged) {
          try {
            const p = prisma.reservationStaffAssignmentLog?.create({
              data: {
                tenant_id: tenantId,
                reservation_id: id,
                from_staff_id: existing.assigned_staff_id || null,
                to_staff_id: assignedStaffId || null,
                reason: (body as any)?.assignmentReason || (body as any)?.reason || 'admin_edit',
                actor: (request as any).adminUser?.name || (request as any).staffName || (request as any).adminIdentity || 'admin',
              },
            });
            void Promise.resolve(p).catch((err: any) => console.warn('[STAFF-ASSIGN-LOG] Failed to create log on edit:', err.message));
          } catch (err: any) {
            console.warn('[STAFF-ASSIGN-LOG] Exception initiating log on edit:', err.message);
          }
        }

        // Phase 4: Sync ltv_cache on reservation edit
        if (existing.customer_id) {
          try {
            const { customerService } = await import('../../../services/customer.service');
            await customerService.recalculateCustomerLtv(existing.customer_id, existing.tenant_id || tenantId);
          } catch (ltvErr: any) {
            console.warn('[Admin API] Failed to recalculate LTV on edit:', ltvErr.message);
          }
        }

        // Sync customer details if provided
        // Fondasional: Customer TIDAK punya kolom `address`; alamat lengkap disimpan di preferences.address (+ kelurahan bila kosong)
        if (existing.customer_id && (customerName || customerPhone || address || kecamatan || kota || kelurahan || landmark)) {
          if (customerName) {
            try {
              const { customerService } = await import('../../../services/customer.service');
              await customerService.updateCustomerName(existing.customer_id, customerName, tenantId, { source: 'admin', force: true });
            } catch (_) {}
          }
          const custUpdate: any = {};
          if (customerPhone) custUpdate.phone = customerPhone.replace(/\D/g, '');
          // Wilayah profil induk HANYA boleh berubah lewat jalur profil/alamat
          // utama, bukan saat admin memilih kartu alamat per-jadwal.
          if (!hasExplicitCardSelection) {
            if (kecamatan) custUpdate.kecamatan = kecamatan;
            if (kota) custUpdate.kota = kota;
            if (kelurahan) custUpdate.kelurahan = kelurahan;
          }
          // Proteksi Integritas Spasial: alamat jalan fisik DILARANG disalin ke
          // kolom kelurahan (sumber pencemaran "Jl. Griya...(https://maps...)").
          // Kolom kelurahan hanya diisi entitas desa/kelurahan resmi dari
          // geocoding/gazetteer; alamat jalan hidup di preferences.address.
          //
          // PATCH PARSIAL (bukan timpa seluruh preferences): `existing.customer`
          // adalah snapshot awal request — menulis ulang objeknya menghapus
          // `saved_addresses` yang baru dibuat RC-1 di atas (split-brain
          // 2026-11-05). Seam merge hanya menyentuh kunci address/landmark.
          if ((address || landmark) && !hasExplicitCardSelection) {
            try {
              const { customerService } = await import('../../../services/customer.service');
              await customerService.mergeCustomerPreferences(existing.customer_id, tenantId, {
                ...(address ? { address } : {}),
                ...(landmark ? { landmark } : {}),
              });
            } catch (mergeErr: any) {
              console.warn(
                '[Admin API] Failed to merge customer preferences on reservation patch:',
                mergeErr?.message
              );
            }
          }
          // assigned_staff_id: string kosong -> null agar tidak menabrak FK
          if (Object.keys(custUpdate).length > 0) {
            try {
              await prisma.customer.update({
                where: { id: existing.customer_id, tenant_id: tenantId },
                data: custUpdate,
              });
            } catch (err: any) {
              console.warn('[Admin API] Failed to update customer extra details on reservation patch:', err?.message || err);
            }
          }
        }

        // Sync babies if provided
        if (existing.customer_id && Array.isArray(babies) && babies.length > 0) {
          const { parseAgeTextToBirthDate, monthsBetween } = await import('../../../utils/age-calculator');
          for (const b of babies) {
            if (!b.name) continue;
            const nm = String((b as any).name || '').trim();
            if (!nm || !isValidChildName(nm)) continue;
            if (classifyPatientEntity({ name: nm, ageText: (b as any).ageText }) !== 'CHILD') continue;
            // Koreksi admin umur WAJIB menghitung ulang birth_date (bukan hanya
            // raw_age_text) — jika tidak, anak lama yang sudah punya birth_date
            // tetap menampilkan umur lama (tampilan memprioritaskan birth_date).
            const newBirthDate = b.ageText ? parseAgeTextToBirthDate(b.ageText, new Date()) : null;
            const existingChild = existing.customer?.children?.find((c: any) => c.name.toLowerCase() === nm.toLowerCase());
            if (existingChild) {
              const updateData: any = { raw_age_text: b.ageText || existingChild.raw_age_text, last_reservation_id: id };
              if (newBirthDate) {
                updateData.birth_date = newBirthDate;
                updateData.age_months_at_registration = monthsBetween(newBirthDate, new Date());
              }
              await prisma.child.update({ where: { id: existingChild.id }, data: updateData });
            } else {
              await prisma.child.create({
                data: {
                  tenant_id: tenantId,
                  customer_id: existing.customer_id,
                  name: nm,
                  name_norm: nm.trim().toLowerCase(),
                  first_reservation_id: id,
                  last_reservation_id: id,
                  raw_age_text: b.ageText || '',
                  birth_date: newBirthDate,
                  age_months_at_registration: newBirthDate ? monthsBetween(newBirthDate, new Date()) : null,
                },
              });
            }
          }
        }

        // Google Calendar sync
        if (updated.google_calendar_event_id && parsedBookingDate) {
          try {
            const cName = customerName || existing.customer?.name || 'Bunda';
            await googleCalendarService.updateEvent(updated.google_calendar_event_id, updated, cName);
          } catch (gcErr) {
            console.error('[Admin API] Google Calendar Event update failed:', gcErr);
          }
        }

        // Reschedule follow-ups if date changed
        if (parsedBookingDate) {
          try {
            const { followUpService } = await import('../../../services/follow-up.service');
            await followUpService.onReservationRescheduled(id, parsedBookingDate, existing.tenant_id || tenantId);
          } catch (fuErr: any) {
            console.warn('[Admin API] Failed to reschedule follow-ups on reservation edit:', fuErr.message);
          }
        }

        // Cermin Sheets: update baris yang sama (bayar/bidan/status/treatment) HANYA bila completed.
        // Fire-and-forget; kolom harga H/I/J/K write-once tidak tersentuh.
        if ((updated?.status || existing?.status) === 'completed') {
          import('../../../services/sheets/sheets-sync.service')
            .then(({ sheetsSyncService }) => sheetsSyncService.enqueue(id, existing.tenant_id || tenantId))
            .catch((err) => console.warn('[Admin API] sheets enqueue on edit failed:', err?.message));
        }

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UPDATE_RESERVATION_DETAIL',
          targetId: id,
          payload: body,
          ipAddress: request.ip,
        });

        // Phase 4: Sync ltv_cache when purchase_value or status changes
        if (purchaseValue !== undefined || status !== undefined) {
          try {
            const { customerService } = await import('../../../services/customer.service');
            await customerService.recalculateCustomerLtv(existing.customer_id, existing.tenant_id || tenantId);
          } catch (ltvErr: any) {
            console.warn('[Admin API] Failed to recalculate ltv_cache on reservation edit:', ltvErr.message);
          }
        }

        // Hydrated relation parity: re-fetch with customer.children + assigned_staff
        let reservationResponse: any = {
          ...updated,
          notes: extractNotesFromRawText(updated.raw_text),
        };
        try {
          const full = await prisma.reservation.findFirst({
            where: { id, tenant_id: tenantId },
            include: {
              customer: { include: { children: true } },
              assigned_staff: { select: { id: true, name: true, phone: true } },
            },
          });
          if (full) {
            reservationResponse = {
              ...full,
              notes: extractNotesFromRawText(full.raw_text),
            };
          } else {
            // Fallback R7: re-fetch gagal → tempel existing.customer (sudah include children dari line 1408)
            if (existing?.customer) {
              reservationResponse = {
                ...reservationResponse,
                customer: existing.customer,
              };
            }
          }
        } catch (err: any) {
          console.warn('[Admin API] Failed to re-fetch full relations on reservation patch:', err.message);
          // Fallback R7: re-fetch gagal → tempel existing.customer (sudah include children dari line 1408)
          if (existing?.customer) {
            reservationResponse = {
              ...reservationResponse,
              customer: existing.customer,
            };
          }
        }

        return reply.status(200).send({
          success: true,
          data: reservationResponse,
        });
      } catch (error: any) {
        console.error(`[Admin API] Failed to update reservation ${id}:`, error);
        return reply.status(500).send({
          success: false,
          error: error?.message || 'Gagal memperbarui reservasi',
        });
      }
    }
  );
}
