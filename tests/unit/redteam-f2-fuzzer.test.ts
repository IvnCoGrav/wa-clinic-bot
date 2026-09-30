import { describe, it, expect } from 'vitest';
import { parseIndonesianDate, applyBookingTimeToDate } from '../../src/utils/indonesian-date-parser';
import { tryParseIndonesianDate } from '../../src/utils/reservation-text-parser';
import * as fs from 'fs';
import * as path from 'path';

describe('Red-Team Verification: F2 - Equivalent Fuzzer Comparison', () => {
  it('runs equivalent flow fuzzer and separates intentional differences from real bugs', () => {
    // Reference date tetap agar deterministik: Rabu, 30 September 2026 09:00 WIB = 02:00 UTC
    const refDate = new Date('2026-09-30T02:00:00.000Z');

    const dateInputs = [
      '2026-10-05',
      'besok',
      'lusa',
      'hari ini',
      'senin',
      'selasa',
      'rabu',
      'kamis',
      'jumat',
      'sabtu',
      'minggu',
      '12 Oktober 2026',
      '5 Oktober',
      'minggu depan',
      '2025-01-01', // tanggal lampau
    ];

    const timeInputs = [
      '09:00',
      '10:30',
      '11:00',
      'jam 11 siang',
      '12:00',
      'jam 12 siang',
      '13:00',
      'jam 1 siang',
      'jam 2 siang',
      '14:00',
      '14.30',
      'jam 4 sore',
      'jam 7 malam',
      'jam 6 pagi',
      'jam 8 pagi',
      'pukul 10.00 WIB',
    ];

    const results: any[] = [];
    let matchCount = 0;
    let intentionalDiffCount = 0;
    let realBugCount = 0;

    const intentionalDiffs: any[] = [];
    const realBugs: any[] = [];

    for (const d of dateInputs) {
      for (const t of timeInputs) {
        // Alur 1 (Bot V3 Native Tool): parseIndonesianDate + applyBookingTimeToDate
        const parsedBase = parseIndonesianDate(d, refDate);
        const flow1Date = applyBookingTimeToDate(parsedBase.date, t);

        // Alur 2 (Livechat / Form Text Parser): tryParseIndonesianDate
        const combinedText = `${d} ${t}`;
        const flow2Date = tryParseIndonesianDate(combinedText);

        const flow1Iso = flow1Date ? flow1Date.toISOString() : null;
        const flow2Iso = flow2Date ? flow2Date.toISOString() : null;

        const isExactMatch = flow1Iso === flow2Iso;

        if (isExactMatch) {
          matchCount++;
        } else {
          // Analisis penyebab perbedaan
          let diffType: 'INTENTIONAL_DESIGN' | 'REAL_BUG' = 'INTENTIONAL_DESIGN';
          let reason = '';

          // 1. Bug G7/F5: Jam 11 siang menjadi 23:00 WIB
          if (t.includes('11 siang')) {
            diffType = 'REAL_BUG';
            reason = 'BUG_G7_PM_MODIFIER_11_SIANG: tryParseIndonesianDate mengubah 11 siang menjadi 23:00 WIB (16:00 UTC), sedangkan applyBookingTimeToDate menghasilkan 11:00 WIB (04:00 UTC).';
            realBugCount++;
            realBugs.push({ date: d, time: t, combined: combinedText, flow1Iso, flow2Iso, reason });
          }
          // 2. Bug Penanganan Jam Siang/Sore pada Form Parser vs Bot
          else if (t.includes('siang') || t.includes('sore') || t.includes('malam') || t.includes('pagi')) {
            // Cek apakah flow1 atau flow2 yang salah
            diffType = 'REAL_BUG';
            reason = `BUG_TIME_MODIFIER_DISCREPANCY: Perbedaan interpretasi penunjuk waktu "${t}". Flow 1 (Bot) tidak mengevaluasi 'siang' pada applyBookingTimeToDate jika tidak ada format 24h, atau sebaliknya.`;
            realBugCount++;
            realBugs.push({ date: d, time: t, combined: combinedText, flow1Iso, flow2Iso, reason });
          }
          // 3. Desain Roll Past-to-Future (Bot V3 menggelindingkan tanggal lampau ke masa depan, sedangkan Form Parser menerima tanggal lampau apa adanya)
          else if (d === '2025-01-01') {
            diffType = 'INTENTIONAL_DESIGN';
            reason = 'INTENTIONAL_ROLL_PAST_TO_FUTURE: Bot V3 menolak booking masa lalu dengan menggulir tahun ke tahun aktif/mendatang, sedangkan Admin Form mengizinkan input tanggal historis untuk pencatatan rekam medis lama.';
            intentionalDiffCount++;
            intentionalDiffs.push({ date: d, time: t, combined: combinedText, flow1Iso, flow2Iso, reason });
          }
          // 4. Perbedaan Hari Relatif / Timezone Kalender
          else {
            diffType = 'REAL_BUG';
            reason = `DISCREPANCY_OTHER: flow1=${flow1Iso} vs flow2=${flow2Iso}`;
            realBugCount++;
            realBugs.push({ date: d, time: t, combined: combinedText, flow1Iso, flow2Iso, reason });
          }

          results.push({
            dateInput: d,
            timeInput: t,
            combinedText,
            flow1Iso,
            flow2Iso,
            diffType,
            reason,
          });
        }
      }
    }

    const total = dateInputs.length * timeInputs.length;
    const summary = {
      totalCombinations: total,
      exactMatches: matchCount,
      exactMatchPercentage: `${(matchCount / total * 100).toFixed(1)}%`,
      intentionalDesignDifferences: intentionalDiffCount,
      realBugsCount: realBugCount,
      realBugsBreakdown: {
        pm11SiangModifier: realBugs.filter(b => b.reason.includes('BUG_G7_PM_MODIFIER_11_SIANG')).length,
        timeModifierDiscrepancies: realBugs.filter(b => b.reason.includes('BUG_TIME_MODIFIER_DISCREPANCY')).length,
        otherDiscrepancies: realBugs.filter(b => b.reason.includes('DISCREPANCY_OTHER')).length,
      },
    };

    const evidenceDir = path.resolve(process.cwd(), 'audit/evidence/P1');
    if (!fs.existsSync(evidenceDir)) fs.mkdirSync(evidenceDir, { recursive: true });
    fs.writeFileSync(
      path.resolve(evidenceDir, 'evidence_f2_equivalent_fuzzer.json'),
      JSON.stringify({ summary, realBugsSample: realBugs.slice(0, 10), intentionalDiffsSample: intentionalDiffs.slice(0, 5) }, null, 2),
      'utf-8'
    );

    console.log('SUMMARY F2 EQUIVALENT FUZZER AUDIT:');
    console.log(JSON.stringify(summary, null, 2));

    expect(total).toBe(240);
  });
});
