import { prisma } from '../db/client';
import { BabyDetail, classifyPatientEntity } from '../utils/reservation-text-parser';
import { TreatmentCategory, ConversationState } from '@prisma/client';

/**
 * Kanonis nama label lifecycle di DB internal (tabel `Label`, tenant-scoped).
 * Dipetakan dari nama label WAHA historis: 'new customer' → 'New Customer',
 * 'pending payment' → 'Pending Payment', 'repeat' → 'Repeat Order'.
 * Sesuai DEFAULT_SYSTEM_LABELS di labels.subroute (seed-defaults); upsert di
 * bawah memakai update:{} agar kustomisasi warna/deskripsi oleh admin (via
 * /api/admin/labels) TIDAK pernah tertimpa.
 */
const LIFECYCLE_LABEL_NEW_CUSTOMER = 'New Customer';
const LIFECYCLE_LABEL_PENDING_PAYMENT = 'Pending Payment';
const LIFECYCLE_LABEL_REPEAT_ORDER = 'Repeat Order';

/**
 * ReservationLifecycleService — fungsi sentral untuk side-effect pasca-create reservasi.
 *
 * Mengumpulkan SEMUA aksi yang harus terjadi setelah sebuah reservasi berhasil dibuat
 * (dari chat customer, parse admin, maupun create manual admin):
 *   1. followUpService.onReservationCreated — scheduling/penjadwalan follow-up
 *   2. childService.upsertChildrenFromBabies — persist entitas bayi/anak
 *   3. Label lifecycle (Task 4) — 'pending payment' / 'repeat' / hapus 'new customer'
 *
 * Setiap efek bersifat best-effort: kegagalan salah satu tidak membatalkan yang lain,
 * dan tidak pernah melempar error ke pemanggil (agar operasi inti tetap sukses).
 */
export interface OnReservationCreatedParams {
  customerId: string;
  reservationId: string;
  tenantId: string;
  chatId: string; // format phone@c.us
  babies?: BabyDetail[];
  customerName?: string;
  kecamatan?: string;
  kota?: string;
  kelurahan?: string;
  address?: string;
}

export class ReservationLifecycleService {
  public async onReservationCreated(params: OnReservationCreatedParams): Promise<void> {
    const { customerId, reservationId, tenantId, chatId, babies = [], customerName, kecamatan, kota, kelurahan, address } = params;

    // 0. Update nama customer & alamat dari form reservasi ke database (agar sinkron ke Google Contacts & CAPI)
    try {
      const { customerService } = await import('./customer.service');
      const targetName = (customerName || '').trim();
      if (targetName && targetName.length > 1) {
        const cleanName = targetName.replace(/^(?:bunda|ibu|mama|mom|mbak|mas|kak|kakak|ny|ny\.)\s+/i, '').trim();
        if (cleanName && !['bunda', 'ibu', 'mama', 'mom', 'mbak', 'mas', 'kak', 'kakak', 'pasien', 'customer', '-'].includes(cleanName.toLowerCase())) {
          // Integritas penamaan: kecamatan hidup di kolom kecamatan (dipakai
          // formatter Google Contacts dari DB), DILARANG ditempel ke Customer.name.
          const contactFormattedName = `Bunda ${cleanName}`.trim();
          await customerService.updateCustomerName(customerId, contactFormattedName, tenantId).catch(() => {});
        }
      }

      if (kecamatan || kota || kelurahan || address) {
        await customerService.updateCustomerLocation(customerId, {
          kecamatan: kecamatan?.trim() || undefined,
          kota: kota?.trim() || undefined,
          kelurahan: kelurahan?.trim() || undefined,
        }, tenantId).catch((e: any) => {
          console.warn('[RESERVATION LIFECYCLE] updateCustomerLocation failed (wilayah):', e?.message);
        });

        // Integritas spasial: alamat lengkap (nama perumahan + blok + patokan)
        // WAJIB tersimpan di preferences.address/full_address — bukan di kolom
        // `kelurahan` (kolom itu khusus entitas desa resmi). Tanpa ini, kartu
        // tugas terapis kehilangan nama perumahan/blok (insiden Terapis Tersasar).
        if (address && address.trim()) {
          await customerService
            .updateCustomer(customerId, { address: address.trim() }, tenantId)
            .catch((e: any) => {
              console.warn('[RESERVATION LIFECYCLE] updateCustomer(address) failed — alamat jalan tidak tersimpan:', e?.message);
            });
        }

        // Background Auto-Distance Calculation jika customer belum memiliki distance_km
        const currentCust = await customerService.getCustomerById(customerId, tenantId);
        if (currentCust && (currentCust.distance_km == null || currentCust.lat == null)) {
          void (async () => {
            try {
              const fullAddressStr = [kelurahan, address, kecamatan, kota].filter(Boolean).join(', ');
              const { extractGoogleMapsUrls, resolveGoogleMapsUrl } = await import('../utils/google-maps-url-resolver');
              const mapsUrls = extractGoogleMapsUrls(fullAddressStr);
              let resolvedLat: number | undefined;
              let resolvedLng: number | undefined;
              let resolvedKel = kelurahan?.trim();
              let resolvedKec = kecamatan?.trim();
              let resolvedKota = kota?.trim();

              if (mapsUrls.length > 0) {
                const mapsRes = await resolveGoogleMapsUrl(mapsUrls[0]);
                if (mapsRes.success && mapsRes.lat && mapsRes.lng) {
                  resolvedLat = mapsRes.lat;
                  resolvedLng = mapsRes.lng;
                }
              }

              if (!resolvedLat || !resolvedLng) {
                const { geocodingService } = await import('../integrations/google-maps/geocoding');
                const geo = await geocodingService.geocodeText(fullAddressStr);
                if (geo.isPrecise && geo.lat != null && geo.lng != null) {
                  resolvedLat = geo.lat;
                  resolvedLng = geo.lng;
                  resolvedKel = resolvedKel || geo.kelurahan;
                  resolvedKec = resolvedKec || geo.kecamatan;
                  resolvedKota = resolvedKota || geo.kota;
                }
              }

              // Fallback fondasional: Jika geocoding Maps tidak presisi, gunakan kamus Gazetteer internal
              if (!resolvedLat || !resolvedLng) {
                const { getGazetteerCoordinates, isCityHomonymKecamatan } = await import('../utils/gazetteer');
                // Gerbang placeholder generik (tanpa daftar kata hafalan): buang nilai
                // kosong / terlalu pendek / hanya simbol. Nama orang (customerName)
                // DILARANG menjadi query wilayah — bukan entitas administratif.
                const isBlankWilayah = (v: unknown): boolean => {
                  const s = String(v ?? '').trim();
                  if (s.length < 2) return true;
                  if (/^[^a-z0-9]+$/i.test(s)) return true;
                  return false;
                };
                const gzSearchQueries = [fullAddressStr, kecamatan, kota].filter(
                  (q): q is string => !!q && !isBlankWilayah(q)
                );
                for (const q of gzSearchQueries) {
                  const gz = getGazetteerCoordinates(String(q));
                  if (!gz || !gz.lat || !gz.lng) continue;
                  // Homonym Safety Gate (fondasional, berbasis dataset): hasil hanya
                  // selevel kecamatan yang namanya sekadar HOMONIM nama kota (mis.
                  // "Sidoarjo", "Surabaya") → customer hanya menyebut kota luas,
                  // BUKAN kecamatan tersebut. DILARANG mengunci koordinat ke sentroid
                  // desa-pertamanya (kasus Suko). Lanjut ke query berikutnya.
                  if (isCityHomonymKecamatan(gz)) continue;
                  resolvedLat = gz.lat;
                  resolvedLng = gz.lng;
                  // Anti-fabrikasi wilayah: sentroid kecamatan dapat mengembalikan
                  // nama desa-pertama (mis. "buduran" → "Sidokerto") yang TIDAK
                  // disebut customer. Nama desa hanya dipersist bila benar-benar
                  // muncul di alamat/query; selain itu cukup koordinat estimasi +
                  // kecamatan/kota (jangan mengarang kelurahan).
                  const kelFromGaz = (gz.kelurahan || '').trim();
                  const kelMentioned =
                    !!kelFromGaz && String(q).toLowerCase().includes(kelFromGaz.toLowerCase());
                  resolvedKel = resolvedKel || (kelMentioned ? kelFromGaz : undefined);
                  resolvedKec = resolvedKec || gz.kecamatan;
                  resolvedKota = resolvedKota || gz.kota;
                  break;
                }
              }

              if (resolvedLat && resolvedLng) {
                const { deliveryService } = await import('./delivery.service');
                const delivery = await deliveryService.calculateDelivery({ lat: resolvedLat, lng: resolvedLng }, undefined, tenantId);
                await customerService.updateCustomerLocation(customerId, {
                  kelurahan: resolvedKel,
                  kecamatan: resolvedKec,
                  kota: resolvedKota,
                  lat: resolvedLat,
                  lng: resolvedLng,
                  distanceKm: delivery.distanceKm,
                  ongkir: delivery.ongkir,
                  isOutOfCoverage: delivery.isOutOfCoverage,
                }, tenantId);
                console.log(`[RESERVATION LIFECYCLE] Auto-resolved distance for customer ${customerId}: ${delivery.distanceKm} km, ongkir: ${delivery.ongkir}`);
              }
            } catch (err: any) {
              console.warn('[RESERVATION LIFECYCLE] Distance resolution failed:', err?.message || err);
            }
          })();
        }
      }
    } catch (err: any) {
      console.warn('[RESERVATION LIFECYCLE] updateCustomerName/Location failed:', err.message);
    }

    // 1. Follow-Up scheduling
    try {
      const { followUpService } = await import('./follow-up.service');
      await followUpService.onReservationCreated(customerId, reservationId, tenantId);
    } catch (err: any) {
      console.warn('[RESERVATION LIFECYCLE] followUp.onReservationCreated failed:', err.message);
    }

    // Phase 4: Sync ltv_cache on new reservation
    try {
      const { customerService } = await import('./customer.service');
      await customerService.recalculateCustomerLtv(customerId, tenantId);
    } catch (err: any) {
      console.warn('[RESERVATION LIFECYCLE] recalculateCustomerLtv failed:', err.message);
    }

    // 2. Persist child/baby entities (best-effort)
    // Gerbang entitas: usia gestasional (hamil/nifas) DILARANG masuk tabel children.
    // Single seam — semua jalur (create, merge, upgrade hold, admin) lewat sini.
    try {
      let treatmentCategory: string | null = null;
      try {
        const dbRes = await prisma.reservation.findUnique({ where: { id: reservationId }, select: { treatment_category: true } });
        treatmentCategory = (dbRes as any)?.treatment_category || null;
      } catch {}
      const childBabies = (babies || []).filter(
        (b) => classifyPatientEntity({ name: (b as any).name, ageText: (b as any).age ?? (b as any).ageText, treatmentCategory: (b as any).treatmentCategory || treatmentCategory }) === 'CHILD'
      );
      if (childBabies.length > 0) {
        const { childService } = await import('./child.service');
        await childService.upsertChildrenFromBabies({
          customerId,
          reservationId,
          tenantId,
          babies: childBabies,
        });
      }
    } catch (err: any) {
      console.warn('[RESERVATION LIFECYCLE] childService.upsertChildrenFromBabies failed:', err.message);
    }

    // 3. Label lifecycle (Task 4) — hanya jika flag aktif
    if (process.env.ENABLE_LIFECYCLE_LABELS === 'true' && chatId) {
      await this.applyLifecycleLabels({ customerId, tenantId, chatId, reservationId });
    }

    // 4. Google Contacts auto-sync (best-effort dengan log jujur, jangan telan error).
    try {
      const { googleContactsService } = await import('./google-contacts.service');
      await googleContactsService.syncCustomer(tenantId, customerId, { trigger: 'reservation' }).catch((e: any) => {
        console.warn('[RESERVATION LIFECYCLE] googleContacts sync async failed:', e?.message);
      });
    } catch (err: any) {
      console.warn('[RESERVATION LIFECYCLE] googleContactsService.syncCustomer failed:', err?.message);
    }

    // 5. Rekapan Google Sheets — HANYA enqueue ke outbox (non-blocking). Worker cron
    // yang memanggil API Google, sehingga webhook chat tidak pernah menunggu Google.
    try {
      const { sheetsSyncService } = await import('./sheets/sheets-sync.service');
      await sheetsSyncService.enqueue(reservationId, tenantId);
    } catch (err: any) {
      console.warn('[RESERVATION LIFECYCLE] sheetsSync enqueue failed:', err?.message);
    }
  }

  /**
   * Dipanggil saat reservasi berstatus completed (treatment selesai).
   * Deep seam terpusat — SEMUA transisi completed WAJIB lewat sini (anti-spray).
   * Best-effort: tidak pernah throw ke pemanggil; setiap efek guarded try/catch.
   * Efek:
   *  1. Jadwalkan reminder/review H-1/H+1 dengan guard backdate (skip REVIEW lampau)
   *  2. Jadwalkan NEXT_TREATMENT +1/+2/+3 bulan per-stage (skip lampau, SENT-aware, PENDING)
   *  3. Reset sesi V3 episodik (cart/booking/komitmen) agar percakapan berikut bersih
   */
  public async onReservationCompleted(params: {
    customerId: string;
    reservationId: string;
    bookingDate: Date;
    treatmentCategory?: string | null;
    tenantId: string;
  }): Promise<void> {
    const { customerId, reservationId, bookingDate, treatmentCategory, tenantId } = params;
    if (!customerId || !reservationId || !bookingDate) return;

    // 1. Review/Reminder (guard backdate ada di follow-up.service)
    try {
      const { followUpService } = await import('./follow-up.service');
      await followUpService.createReservationFollowUps({
        reservationId,
        customerId,
        bookingDate,
        treatmentCategory: treatmentCategory || null,
        tenantId,
      });
    } catch (err: any) {
      console.warn('[RESERVATION LIFECYCLE] onReservationCompleted createReservationFollowUps failed:', err?.message || err);
    }

    // 2. NEXT_TREATMENT (per-stage guard + WIB + SENT-aware ada di follow-up.service)
    try {
      const { followUpService } = await import('./follow-up.service');
      await followUpService.createNextTreatmentFollowUps(customerId, bookingDate, tenantId, reservationId);
    } catch (err: any) {
      console.warn('[RESERVATION LIFECYCLE] onReservationCompleted createNextTreatmentFollowUps failed:', err?.message || err);
    }

    // 3. Reset sesi V3 episodik (CG-02 closing)
    try {
      const activeConv = await prisma.conversation.findFirst({
        where: { customer_id: customerId, tenant_id: tenantId },
        orderBy: { updated_at: 'desc' },
        select: { id: true },
      });
      if (activeConv?.id) {
        const { GoalTracker } = await import('../v3/state/goal-tracker');
        await GoalTracker.updateGoalSession(
          activeConv.id,
          {
            cartItems: [],
            selectedTreatment: undefined,
            booking: undefined,
            discussedTreatments: [],
            priceDiscussed: undefined,
            bookingCommitConfirmed: undefined,
            lastCommitment: undefined,
            ongkirStatus: undefined,
            totalPrice: undefined,
          } as any,
          tenantId
        );

        // 3b. Tutup status percakapan (Fase C2 Rencana Perbaikan Opsi C).
        // Sebelumnya tidak ada kode yang menulis COMPLETED ke DB sehingga
        // current_state bisa tertinggal di RESERVATION_SENT berminggu-minggu
        // walau reservasi sudah selesai (drift terbukti di audit). Tutup di
        // pintu yang sama dengan reset sesi agar satu peristiwa = satu status.
        try {
          const { conversationService } = await import('./conversation.service');
          // Baca state lama best-effort (DB offline => null, bukan gagal-total).
          let prevState: any = null;
          try {
            const convRow = await prisma.conversation.findUnique({
              where: { id: activeConv.id },
              select: { current_state: true },
            });
            prevState = (convRow as any)?.current_state ?? null;
          } catch {
            prevState = null;
          }
          await conversationService.updateConversationState(
            activeConv.id,
            {
              currentState: ConversationState.COMPLETED,
              previousState: prevState,
            },
            tenantId
          );
        } catch (stateErr: any) {
          console.warn('[RESERVATION LIFECYCLE] onReservationCompleted set COMPLETED failed:', stateErr?.message || stateErr);
        }
      }
    } catch (err: any) {
      console.warn('[RESERVATION LIFECYCLE] onReservationCompleted reset V3 session failed:', err?.message || err);
    }
  }

  /**
   * Terapkan label lifecycle pada customer — DB-ONLY (Mandat Mutlak Anti-Label WAHA).
   * - priorConfirmedCount > 0  → tambah 'Repeat Order', hapus 'New Customer' + 'Pending Payment'
   * - priorConfirmedCount === 0 → tambah 'Pending Payment', hapus 'New Customer'
   * - TIDAK pernah menyentuh label lain (mis. 'legacy') — hanya 3 nama kanonis di atas
   *   yang di-upsert/di-delete via tabel `Label` + `CustomerLabel` (tenant-scoped).
   * - Zero pemanggilan WAHA (dulu: wahaClient.batchUpdateLabels). Best-effort:
   *   DB offline → warn & lanjut, operasi inti reservasi tidak pernah gagal.
   *
   * Riwayat = `confirmed` ATAU `completed` (kanonis patient-lifecycle):
   * pasien yang reservasi sebelumnya sudah `completed` tetap 'Repeat Order'.
   *
   * Sumber otoritatif repeat: kolom `Reservation.is_repeat_order` yang dipersist
   * oleh reservation-core (single source of truth). Fallback ke count DB hanya
   * bila reservasi tak terbaca — mencegah double-count & drift semantik.
   */
  private async applyLifecycleLabels(params: { customerId: string; tenantId: string; chatId: string; reservationId?: string }): Promise<void> {
    const { customerId, tenantId, reservationId } = params;
    // chatId dipertahankan di signature untuk kompatibilitas pemanggil
    // (reservation-core, webhook, script) — tidak dipakai: zero WAHA.

    let priorConfirmedCount = 0;
    let resolvedFromReservation = false;
    if (reservationId) {
      try {
        const res = await prisma.reservation.findUnique({
          where: { id: reservationId },
          select: { is_repeat_order: true },
        });
        if (res && typeof res.is_repeat_order === 'boolean') {
          priorConfirmedCount = res.is_repeat_order ? 1 : 0;
          resolvedFromReservation = true;
        }
      } catch {
        // fallback ke count di bawah
      }
    }

    // Fallback (reservasi tak terbaca / non-core path seperti update status webhook).
    if (!resolvedFromReservation) {
      try {
        priorConfirmedCount = await prisma.reservation.count({
          where: {
            customer_id: customerId,
            tenant_id: tenantId,
            status: { in: ['confirmed', 'en_route', 'completed'] },
          },
        });
      } catch (err: any) {
        // DB offline → default 0 (new customer path)
        console.warn('[LIFECYCLE LABEL] Could not count prior confirmed reservations:', err.message);
      }
    }

    const add: string[] =
      priorConfirmedCount > 0 ? [LIFECYCLE_LABEL_REPEAT_ORDER] : [LIFECYCLE_LABEL_PENDING_PAYMENT];
    const remove: string[] =
      priorConfirmedCount > 0
        ? [LIFECYCLE_LABEL_NEW_CUSTOMER, LIFECYCLE_LABEL_PENDING_PAYMENT]
        : [LIFECYCLE_LABEL_NEW_CUSTOMER];

    try {
      const labelIds = new Map<string, string>();
      for (const name of [...add, ...remove]) {
        const label = await prisma.label.upsert({
          where: { tenant_id_name: { tenant_id: tenantId, name } },
          update: {},
          create: { tenant_id: tenantId, name },
        });
        labelIds.set(name, label.id);
      }
      for (const name of add) {
        const labelId = labelIds.get(name);
        if (!labelId) continue;
        await prisma.customerLabel.upsert({
          where: { customer_id_label_id: { customer_id: customerId, label_id: labelId } },
          update: {},
          create: { customer_id: customerId, label_id: labelId },
        });
      }
      const removeIds = remove
        .map((name) => labelIds.get(name))
        .filter((id): id is string => !!id);
      if (removeIds.length > 0) {
        await prisma.customerLabel.deleteMany({
          where: { customer_id: customerId, label_id: { in: removeIds } },
        });
      }
      console.log(
        `[LIFECYCLE LABEL] DB-only lifecycle applied for customer ${customerId}: +[${add.join(', ')}] -[${remove.join(', ')}]`
      );
    } catch (err: any) {
      console.warn('[LIFECYCLE LABEL] DB-only lifecycle tagging failed:', err?.message || err);
    }
    // Catatan: label lain (mis. 'legacy') dibiarkan tak tersentuh.
  }
}

export const reservationLifecycleService = new ReservationLifecycleService();

export interface UpsertReservationFormParams {
  tenantId: string;
  customerId: string;
  chatId: string;
  treatmentCategory?: TreatmentCategory | string | null;
  treatmentDetail?: string | null;
  durationMinutes?: number | null;
  bookingDate?: Date | null;
  rawText?: string;
  purchaseValue?: number;
  babies?: BabyDetail[];
  customerName?: string;
  kecamatan?: string;
  kota?: string;
  kelurahan?: string;
  address?: string;
  source?: string;
}

/**
 * Helper terstandarisasi (DEPRECATED — delegasi ke Canonical Reservation Core).
 * Dipertahankan agar 4 titik auto-capture webhook + tool lama tetap berfungsi
 * sambil mewarisi perbaikan fondasional: pencocokan booking_date (bukan
 * created_at 24 jam naif), idempotent merge, dan auto-konsolidasi duplikat.
 * Kode baru WAJIB memanggil `reservationCoreService.saveReservation()` langsung.
 */
export async function upsertReservationForm(params: UpsertReservationFormParams): Promise<{
  reservation: any;
  isNew: boolean;
  isUpdate: boolean;
}> {
  const { source, ...rest } = params;
  // Auto-capture webhook membawa durasi resmi katalog bila pemanggil tak mengisinya
  // (hanya bila seluruh item dikenali katalog — anti-fabrikasi data).
  if ((rest.durationMinutes == null) && rest.treatmentDetail && rest.treatmentDetail.trim()) {
    try {
      const { treatmentCatalogService } = await import('./treatment-catalog.service');
      const breakdown = treatmentCatalogService.resolveDurationBreakdown(rest.treatmentDetail, rest.tenantId);
      if (breakdown.confident || breakdown.usedExplicitTag) {
        rest.durationMinutes = breakdown.totalMinutes;
      }
    } catch {}
  }
  const { reservationCoreService } = await import('./reservation-core.service');
  // Petakan source lama ke kanal kanonis: admin-outbound & webhook-* → WEBHOOK,
  // V3 tool → AGENT, selain itu → WEBHOOK (idempoten, aman untuk bot).
  const upper = String(source || 'WEBHOOK').toUpperCase();
  const mappedSource = upper.includes('AGENT') || upper.includes('V3_NATIVE')
    ? 'AGENT'
    : upper.includes('ADMIN_PANEL')
      ? 'ADMIN_PANEL'
      : upper.includes('BOT')
        ? 'BOT'
        : 'WEBHOOK';
  const result = await reservationCoreService.saveReservation({
    ...rest,
    source: mappedSource as 'BOT' | 'WEBHOOK' | 'AGENT' | 'ADMIN_PANEL',
    status: 'confirmed',
  });
  return { reservation: result.reservation, isNew: result.isNew, isUpdate: result.isUpdate };
}

/**
 * Helper kanonis (Fase 1.2 audit arsitektur): menangkap form reservasi dari teks mentah
 * webhook inbound. Menggantikan 3 blok duplikat di webhook.route.ts (lines 1280/1354/1465).
 *
 * Alur:
 * 1. Cek apakah raw adalah form reservasi (isReservationFormMessage)
 * 2. Parse struktur (parseReservationText)
 * 3. Cari jam eksplisit dari riwayat (findExplicitTimeFromHistory inline)
 * 4. Resolve nilai treatment untuk CAPI (resolveTreatmentValue)
 * 5. Simpan via reservationCoreService.saveReservation (kanonis, bukan upsertReservationForm DEPRECATED)
 * 6. Fire CAPI InitiateCheckout bila isNew/isUpdate
 */
export interface TryCaptureReservationParams {
  tenantId: string;
  customerId: string;
  chatId: string;
  raw: string;
  history: Array<{ role: string; content: string }>;
  source: string;
  customer: any;
}

export interface TryCaptureReservationResult {
  captured: boolean;
  isNew?: boolean;
  isUpdate?: boolean;
  parseError?: string;
  missingFields?: string[];
}

export async function tryCaptureReservationFormFromRaw(params: TryCaptureReservationParams): Promise<TryCaptureReservationResult> {
  const { tenantId, customerId, chatId, raw, history, source, customer } = params;
  if (!raw || !raw.trim()) return { captured: false };

  const { isReservationFormMessage, parseReservationText } = await import('../utils/reservation-text-parser');
  if (!isReservationFormMessage(raw)) return { captured: false };

  const pr = parseReservationText(raw);
  if (!pr.success || !pr.reservation) {
    return { captured: false, parseError: pr.error, missingFields: pr.missingFields };
  }

  const p = pr.reservation;

  // Cari jam eksplisit dari N pesan terakhir riwayat (inline untuk hindari dep baru)
  const timeRe = /(?:jam|pukul|waktu)\s*(\d{1,2})[.:](\d{2})/g;
  let explicitTime: string | null = null;
  for (let i = history.length - 1; i >= Math.max(0, history.length - 3); i--) {
    const m = timeRe.exec(history[i]?.content || '');
    if (m) { explicitTime = `${m[1].padStart(2, '0')}:${m[2].padStart(2, '0')}:00`; break; }
  }

  // Resolve nilai treatment untuk CAPI (payment > totalPrice > katalog)
  const { resolveTreatmentValue } = await import('./capi.service');
  const initialVal = p.payment?.treatmentPrice || p.payment?.totalPrice || (await resolveTreatmentValue(p.treatmentDetail, tenantId)) || undefined;

  // Hitung bookingDate dengan jam eksplisit WIB (+07:00) jika ada
  const bookingDate = (explicitTime && p.bookingDate)
    ? new Date(p.bookingDate.toISOString().slice(0, 11) + explicitTime + '+07:00')
    : p.bookingDate;

  // Simpan via core kanonis (DEPRECATED upsertReservationForm tidak dipakai lagi)
  const { reservationCoreService } = await import('./reservation-core.service');
  // Map source ke tipe kanonis (sama seperti upsertReservationForm)
  const upper = String(source || 'WEBHOOK').toUpperCase();
  const mappedSource = upper.includes('AGENT') || upper.includes('V3_NATIVE')
    ? 'AGENT'
    : upper.includes('ADMIN_PANEL')
      ? 'ADMIN_PANEL'
      : upper.includes('BOT')
        ? 'BOT'
        : 'WEBHOOK';
  const result = await reservationCoreService.saveReservation({
    tenantId,
    customerId,
    chatId,
    treatmentCategory: p.treatmentCategory,
    treatmentDetail: p.treatmentDetail,
    bookingDate,
    rawText: raw,
    purchaseValue: initialVal,
    babies: p.babies || [],
    customerName: p.name,
    kecamatan: p.kec,
    kota: p.kota,
    // Integritas spasial: p.address = alamat jalan lengkap, DILARANG disalin ke kolom kelurahan.
    kelurahan: undefined,
    address: p.address || undefined,
    source: mappedSource,
  });

  // Fire CAPI InitiateCheckout bila reservasi baru/terupdate
  if (result.isNew || result.isUpdate) {
    try {
      const { fireCapiEvent } = await import('./capi.service');
      fireCapiEvent({
        eventName: 'InitiateCheckout',
        customer,
        tenantId,
        customData: { source, treatment: p.treatmentDetail },
      });
    } catch {}
  }

  return { captured: true, isNew: result.isNew, isUpdate: result.isUpdate };
}