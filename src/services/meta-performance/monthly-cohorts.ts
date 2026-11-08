import { resolveDeliveryFeeSnapshot } from '../reservation-core.service';
import {
  BuildMonthlyCohortsParams,
  UnifiedMonthlyCohortRow,
  CohortPlanningMetrics,
  CohortChannel,
  CohortMonthlyPeriodMetric,
  wibMonthKey,
  wibDateKey,
  normalizePhone,
  isQualifyingStatus,
  isSandboxed,
  addMonths,
  monthDiff,
  round2,
  MS_PER_DAY,
} from './types';

export async function buildMonthlyCohorts(params: BuildMonthlyCohortsParams): Promise<{
  monthlyCohorts: UnifiedMonthlyCohortRow[];
  rolling3MonthCohorts: UnifiedMonthlyCohortRow[];
  planning: CohortPlanningMetrics;
}> {
  const {
    historyReservations,
    rangeReservations,
    matchedAds,
    monthlySpends = {},
    defaultSpend,
    grossMarginPct = 40,
    minSampleThreshold = 20,
    now = new Date(),
    treatmentFeeOf,
    cohortStartMonth = null,
    excludedCohortMonths = [],
  } = params;

  const nowMs = now.getTime();
  const currentWibMonth = wibMonthKey(now);
  const todayWibStr = wibDateKey(now);

  // 1. Map customerId to ad channel
  const customerChannelMap = new Map<string, 'CTWA' | 'LPWA'>();
  for (const a of matchedAds) {
    if (!a.customerId) continue;
    const isCtwa =
      Boolean(a.ctwa_clid) ||
      a.utmMedium === 'ctwa' ||
      a.utmMedium === 'ctwa_fuzzy' ||
      a.utmSource === 'whatsapp_direct';
    const channel: 'CTWA' | 'LPWA' = isCtwa ? 'CTWA' : 'LPWA';
    const prev = customerChannelMap.get(a.customerId);
    if (prev !== 'CTWA') {
      customerChannelMap.set(a.customerId, channel);
    }
  }

  // Deduplicate reservations
  const allResMap = new Map<string, any>();
  for (const r of historyReservations) if (r?.id) allResMap.set(r.id, r);
  for (const r of rangeReservations) if (r?.id) allResMap.set(r.id, r);
  const allReservations = Array.from(allResMap.values());

  const patientKeyOf = (r: any): string => {
    const phone = normalizePhone(r.customer?.phone);
    if (phone) return `phone:${phone}`;
    return `id:${r.customer_id || r.customer?.id || r.id}`;
  };

  const isQual = (r: any) => isQualifyingStatus(r?.status) && !isSandboxed(r?.customer);

  const patientReservations = new Map<string, any[]>();
  const patientChannel = new Map<string, 'CTWA' | 'LPWA' | 'ORGANIC'>();

  for (const r of allReservations) {
    if (!isQual(r)) continue;
    const pKey = patientKeyOf(r);
    const list = patientReservations.get(pKey) || [];
    list.push(r);
    patientReservations.set(pKey, list);

    if (!patientChannel.has(pKey) || patientChannel.get(pKey) === 'ORGANIC') {
      const cid = r.customer_id || r.customer?.id;
      const ch = cid ? customerChannelMap.get(cid) : undefined;
      if (ch) {
        patientChannel.set(pKey, ch);
      } else if (!patientChannel.has(pKey)) {
        patientChannel.set(pKey, 'ORGANIC');
      }
    }
  }

  interface PatientInfo {
    key: string;
    channel: 'CTWA' | 'LPWA' | 'ORGANIC';
    cohortMonth: string;
    firstRes: any;
    firstVisitDate: Date;
    reservations: any[];
  }

  const patientInfos: PatientInfo[] = [];

  for (const [pKey, resList] of patientReservations.entries()) {
    const getVisitDate = (r: any) => (r.booking_date ? new Date(r.booking_date) : new Date(r.created_at));
    resList.sort((a, b) => getVisitDate(a).getTime() - getVisitDate(b).getTime());

    const firstRes = resList[0];
    const firstVisitDate = getVisitDate(firstRes);
    const cohortMonth = wibMonthKey(firstVisitDate);
    const channel = patientChannel.get(pKey) || 'ORGANIC';

    patientInfos.push({
      key: pKey,
      channel,
      cohortMonth,
      firstRes,
      firstVisitDate,
      reservations: resList,
    });
  }

  const excludedMonths = new Set(excludedCohortMonths);
  let allMonths = Array.from(new Set(patientInfos.map((p) => p.cohortMonth)))
    .filter((m) => !excludedMonths.has(m))
    .filter((m) => !cohortStartMonth || m >= cohortStartMonth)
    .sort((a, b) => (a < b ? 1 : -1));
  if (!allMonths.includes(currentWibMonth) && (!cohortStartMonth || currentWibMonth >= cohortStartMonth)) {
    allMonths.unshift(currentWibMonth);
  }

  const channels: CohortChannel[] = ['ALL', 'LPWA', 'CTWA', 'ORGANIC'];
  const monthlyCohorts: UnifiedMonthlyCohortRow[] = [];

  for (const month of allMonths) {
    for (const ch of channels) {
      const isChMatch = (pCh: 'CTWA' | 'LPWA' | 'ORGANIC') => (ch === 'ALL' ? true : pCh === ch);
      const cohortPatients = patientInfos.filter((p) => p.cohortMonth === month && isChMatch(p.channel));

      const cohortSize = cohortPatients.length;
      let initialRevenue = 0;
      let initialDeliveryFee = 0;
      let initialUpcomingOrders = 0;
      let initialUpcomingRevenue = 0;

      for (const p of cohortPatients) {
        const r = p.firstRes;
        const fee = await treatmentFeeOf(r);
        const delFee = resolveDeliveryFeeSnapshot(r);
        if (r.status === 'completed') {
          initialRevenue += fee;
          initialDeliveryFee += delFee;
        } else if (r.status === 'confirmed') {
          initialUpcomingOrders += 1;
          initialUpcomingRevenue += fee;
        }
      }

      const computePeriod = async (nMonths: number): Promise<CohortMonthlyPeriodMetric | null> => {
        const targetMonth = addMonths(month, nMonths);
        const diffFromCurrent = monthDiff(currentWibMonth, targetMonth);
        const status: 'COMPLETED' | 'ONGOING' | 'FUTURE' =
          diffFromCurrent > 0 ? 'FUTURE' : diffFromCurrent === 0 ? 'ONGOING' : 'COMPLETED';

        if (status === 'FUTURE') return null;

        let orders = 0;
        let revenue = 0;
        let upcomingCount = 0;
        let upcomingRevenue = 0;
        const returningPatients = new Set<string>();

        for (const p of cohortPatients) {
          for (let i = 1; i < p.reservations.length; i++) {
            const r = p.reservations[i];
            const rDate = r.booking_date ? new Date(r.booking_date) : new Date(r.created_at);
            const rMonth = wibMonthKey(rDate);
            if (rMonth === targetMonth) {
              const fee = await treatmentFeeOf(r);
              if (r.status === 'completed') {
                orders += 1;
                revenue += fee;
                returningPatients.add(p.key);
              } else if (r.status === 'confirmed') {
                upcomingCount += 1;
                upcomingRevenue += fee;
              }
            }
          }
        }

        const count = returningPatients.size;
        const pct = cohortSize > 0 ? round2((count / cohortSize) * 100) : 0;

        return { count, pct, orders, revenue, upcomingCount, upcomingRevenue, status };
      };

      const repeatM1 = await computePeriod(1);
      const repeatM2 = await computePeriod(2);
      const repeatM3 = await computePeriod(3);
      const repeatM4 = await computePeriod(4);
      const repeatM5 = await computePeriod(5);

      let cumulativeRepeatCount = 0;
      let totalDaysToSecondVisit = 0;
      let secondVisitCount = 0;

      for (const p of cohortPatients) {
        const qualifyingReservations = (p.reservations || []).filter(
          (r: any) => isQualifyingStatus(r?.status) && !isSandboxed(r?.customer)
        );
        if (qualifyingReservations.length >= 2) {
          cumulativeRepeatCount += 1;
          const firstDate = qualifyingReservations[0].booking_date
            ? new Date(qualifyingReservations[0].booking_date)
            : new Date(qualifyingReservations[0].created_at);
          const secondDate = qualifyingReservations[1].booking_date
            ? new Date(qualifyingReservations[1].booking_date)
            : new Date(qualifyingReservations[1].created_at);
          const daysDiff = Math.max(0, Math.floor((secondDate.getTime() - firstDate.getTime()) / MS_PER_DAY));
          totalDaysToSecondVisit += daysDiff;
          secondVisitCount += 1;
        }
      }

      const cumulativeRepeatPct = cohortSize > 0 ? round2((cumulativeRepeatCount / cohortSize) * 100) : 0;
      const avgDaysToSecondVisit = secondVisitCount > 0 ? Math.round(totalDaysToSecondVisit / secondVisitCount) : null;

      const totalRealizedRevenue =
        initialRevenue +
        (repeatM1?.revenue || 0) +
        (repeatM2?.revenue || 0) +
        (repeatM3?.revenue || 0) +
        (repeatM4?.revenue || 0) +
        (repeatM5?.revenue || 0);
      const revenuePerPatient = cohortSize > 0 ? Math.round(totalRealizedRevenue / cohortSize) : 0;

      let adSpend: number | null = null;
      const monthSpendConfig = monthlySpends[month];
      if (ch === 'LPWA') {
        adSpend = monthSpendConfig?.lpwa !== undefined ? monthSpendConfig.lpwa : null;
      } else if (ch === 'CTWA') {
        adSpend = monthSpendConfig?.ctwa !== undefined ? monthSpendConfig.ctwa : null;
      } else if (ch === 'ALL') {
        if (monthSpendConfig?.lpwa !== undefined || monthSpendConfig?.ctwa !== undefined) {
          adSpend = (monthSpendConfig?.lpwa || 0) + (monthSpendConfig?.ctwa || 0);
        }
      }

      if (adSpend === null && defaultSpend !== undefined && defaultSpend > 0 && month === currentWibMonth) {
        if (ch === 'ALL') adSpend = defaultSpend;
      }

      const cac =
        (ch === 'LPWA' || ch === 'CTWA') && adSpend !== null && cohortSize > 0
          ? Math.round(adSpend / cohortSize)
          : null;

      const roas =
        (ch === 'LPWA' || ch === 'CTWA') && adSpend !== null && adSpend > 0
          ? round2(totalRealizedRevenue / adSpend)
          : null;

      let paybackStatus: UnifiedMonthlyCohortRow['paybackStatus'] = 'TIDAK_BERLAKU';
      if (ch === 'LPWA' || ch === 'CTWA') {
        if (adSpend === null || adSpend === 0) {
          paybackStatus = 'BELUM_DIISI';
        } else if (roas !== null && roas >= 1.0) {
          paybackStatus = 'BALIK_MODAL';
        } else {
          paybackStatus = 'BELUM_BALIK_MODAL';
        }
      }

      const channelLabel =
        ch === 'ALL'
          ? 'Semua Pasien'
          : ch === 'LPWA'
          ? 'LPWA (Landing Page)'
          : ch === 'CTWA'
          ? 'CTWA (Click to WA)'
          : 'Organik';

      monthlyCohorts.push({
        cohortMonth: month,
        channel: ch,
        channelLabel,
        cohortSize,
        initialRevenue,
        initialDeliveryFee,
        initialUpcomingOrders,
        initialUpcomingRevenue,
        repeatM1,
        repeatM2,
        repeatM3,
        repeatM4,
        repeatM5,
        cumulativeRepeatCount,
        cumulativeRepeatPct,
        avgDaysToSecondVisit,
        totalRealizedRevenue,
        revenuePerPatient,
        adSpend,
        cac,
        roas,
        paybackStatus,
        isOngoing: month === currentWibMonth,
        isSmallSample: cohortSize < minSampleThreshold,
      });
    }
  }

  // Planning calculation: Mature LTV 60-Day (AD patients only, firstVisit >= 60 days ago)
  const matureAdPatients = patientInfos.filter((p) => {
    if (p.channel !== 'LPWA' && p.channel !== 'CTWA') return false;
    const ageDays = (nowMs - p.firstVisitDate.getTime()) / MS_PER_DAY;
    return ageDays >= 60;
  });

  let totalMatureRevenue60d = 0;
  for (const p of matureAdPatients) {
    for (const r of p.reservations) {
      if (r.status !== 'completed') continue;
      const rDate = r.booking_date ? new Date(r.booking_date) : new Date(r.created_at);
      const deltaDays = (rDate.getTime() - p.firstVisitDate.getTime()) / MS_PER_DAY;
      if (deltaDays >= 0 && deltaDays <= 60) {
        totalMatureRevenue60d += await treatmentFeeOf(r);
      }
    }
  }

  const matureSamplePatients = matureAdPatients.length;
  const hasEnoughData = matureSamplePatients >= minSampleThreshold;
  const matureLtv60Days =
    matureSamplePatients > 0 ? Math.round(totalMatureRevenue60d / matureSamplePatients) : null;
  const maxAllowableCac =
    matureLtv60Days !== null ? Math.round(matureLtv60Days * (grossMarginPct / 100)) : null;

  const planning: CohortPlanningMetrics = {
    matureLtv60Days,
    matureSamplePatients,
    hasEnoughData,
    grossMarginPct,
    maxAllowableCac,
    minSampleThreshold,
    dataCutoffDate: todayWibStr,
  };

  // Rolling 3-Month Aggregate
  const recent3Months = allMonths.slice(0, 3);
  const rolling3MonthCohorts: UnifiedMonthlyCohortRow[] = [];

  for (const ch of channels) {
    const rows = monthlyCohorts.filter((r) => recent3Months.includes(r.cohortMonth) && r.channel === ch);
    const cohortSize = rows.reduce((s, r) => s + r.cohortSize, 0);
    const initialRevenue = rows.reduce((s, r) => s + r.initialRevenue, 0);
    const initialDeliveryFee = rows.reduce((s, r) => s + r.initialDeliveryFee, 0);
    const initialUpcomingOrders = rows.reduce((s, r) => s + r.initialUpcomingOrders, 0);
    const initialUpcomingRevenue = rows.reduce((s, r) => s + r.initialUpcomingRevenue, 0);
    const totalRealizedRevenue = rows.reduce((s, r) => s + r.totalRealizedRevenue, 0);
    const revenuePerPatient = cohortSize > 0 ? Math.round(totalRealizedRevenue / cohortSize) : 0;

    let adSpend: number | null = null;
    const spends = rows.map((r) => r.adSpend).filter((s): s is number => s !== null);
    if (spends.length > 0) {
      adSpend = spends.reduce((a, b) => a + b, 0);
    }

    const cac =
      (ch === 'LPWA' || ch === 'CTWA') && adSpend !== null && cohortSize > 0
        ? Math.round(adSpend / cohortSize)
        : null;
    const roas =
      (ch === 'LPWA' || ch === 'CTWA') && adSpend !== null && adSpend > 0
        ? round2(totalRealizedRevenue / adSpend)
        : null;

    let paybackStatus: UnifiedMonthlyCohortRow['paybackStatus'] = 'TIDAK_BERLAKU';
    if (ch === 'LPWA' || ch === 'CTWA') {
      if (adSpend === null || adSpend === 0) paybackStatus = 'BELUM_DIISI';
      else if (roas !== null && roas >= 1.0) paybackStatus = 'BALIK_MODAL';
      else paybackStatus = 'BELUM_BALIK_MODAL';
    }

    const channelLabel =
      ch === 'ALL'
        ? 'Semua Pasien (3 Bln)'
        : ch === 'LPWA'
        ? 'LPWA (3 Bln)'
        : ch === 'CTWA'
        ? 'CTWA (3 Bln)'
        : 'Organik (3 Bln)';

    rolling3MonthCohorts.push({
      cohortMonth:
        recent3Months.length > 1
          ? `${recent3Months[recent3Months.length - 1]} s.d. ${recent3Months[0]}`
          : recent3Months[0] || currentWibMonth,
      channel: ch,
      channelLabel,
      cohortSize,
      initialRevenue,
      initialDeliveryFee,
      initialUpcomingOrders,
      initialUpcomingRevenue,
      repeatM1: null,
      repeatM2: null,
      repeatM3: null,
      repeatM4: null,
      repeatM5: null,
      cumulativeRepeatCount: undefined,
      cumulativeRepeatPct: undefined,
      avgDaysToSecondVisit: null,
      totalRealizedRevenue,
      revenuePerPatient,
      adSpend,
      cac,
      roas,
      paybackStatus,
      isOngoing: true,
      isSmallSample: cohortSize < minSampleThreshold,
    });
  }

  return { monthlyCohorts, rolling3MonthCohorts, planning };
}
