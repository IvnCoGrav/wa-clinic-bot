import { CustomerGoalSession } from './goal-tracker';
import { treatmentCatalogService } from '../../services/treatment-catalog.service';
import type { ExtractedEntities } from '../../slot-engine/types';

export interface V3SummaryOptions {
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  customerInput?: string;
}

/**
 * V3ConversationSummarizer — native V3 (0 token, <1ms)
 * Porting dari src/slot-engine/conversation-summarizer.ts agar menerima
 * CustomerGoalSession secara langsung tanpa adapter CustomerSlate.
 */
export class V3ConversationSummarizer {
  public static summarize(
    session: CustomerGoalSession,
    incomingText: string,
    options?: V3SummaryOptions
  ): string {
    const history = options?.history || [];
    const customerInput = options?.customerInput || incomingText || '';
    const sudahDibahas: string[] = [];
    const janganDiulang: string[] = [];
    const botRepliesCount = history.filter((h) => h.role === 'assistant').length;

    // 1. Lokasi & ongkir
    if (session.location?.kelurahan || session.location?.distanceKm != null) {
      const locLabel = session.location.kelurahan || session.location.kecamatan || 'lokasi Bunda';
      const distLabel = session.location.distanceKm != null ? `, ~${session.location.distanceKm} km` : '';
      const promo = session.location.ongkirPromo;
      if (promo != null) {
        sudahDibahas.push(`Ongkir Rp ${promo.toLocaleString('id-ID')} promo (${locLabel}${distLabel})`);
        janganDiulang.push('Info ongkir atau perhitungan jarak (sudah disampaikan di chat atas)');
      } else {
        sudahDibahas.push(`Lokasi: ${locLabel}${distLabel}`);
      }
    }

    // 2. Usia anak
    const ageMonths = session.childProfile?.ageMonths ?? session.children?.[0]?.ageMonths ?? null;
    if (ageMonths != null && ageMonths > 0) {
      sudahDibahas.push(`Usia si kecil: ${ageMonths} bulan`);
      janganDiulang.push('Menanyakan usia atau umur anak (sudah diketahui)');
    }

    // 3. Keluhan & treatment
    if (session.selectedTreatment) {
      sudahDibahas.push(`Treatment yang dipilih/ditanyakan: *${session.selectedTreatment}*`);
      janganDiulang.push('Menanyakan ulang "rencana mau treatment apa" dari awal');
    } else {
      const symptoms = [
        ...(session.childProfile?.symptoms || []),
        ...((session.children || []).flatMap((c) => c.symptoms || [])),
      ].filter((s, i, arr) => arr.indexOf(s) === i);
      if (symptoms.length > 0) {
        const candidates = ageMonths != null
          ? treatmentCatalogService.filterServicesByAudience(treatmentCatalogService.getAllServices(true), { ageMonths })
          : treatmentCatalogService.getAllServices(true);
        const suggested = candidates.find((s) => s.name.toLowerCase().includes('pulih'))?.name || candidates[0]?.name || 'treatment sesuai katalog';
        sudahDibahas.push(`Keluhan si kecil: ${symptoms.join(', ')} (disarankan *${suggested}* dari katalog aktif)`);
        janganDiulang.push('Menanyakan ulang keluhan si kecil');
      }
    }

    // 4. Formulir reservasi
    if (session.booking?.preferredDate || session.booking?.reservationId) {
      sudahDibahas.push('Format formulir reservasi sudah pernah dibahas');
      janganDiulang.push('Mengirim ulang teks formulir reservasi panjang (cukup ingatkan melengkapi data)');
    }

    // 5. Sapaan pembuka
    if (botRepliesCount > 0) {
      janganDiulang.push('Sapaan pembuka "Halo Bunda!" atau perkenalan diri "Perkenalkan saya Bidan Yusi..." (ini percakapan lanjutan, langsung jawab inti)');
    }

    // 6. Hari/jadwal
    const rawInputLower = customerInput.toLowerCase();
    const hasDayMention = /\b(hari\s+(?:senin|selasa|rabu|kamis|jumat|sabtu|minggu)|besok|lusa|weekend|akhir\s+pekan|sabtu|minggu|senin|selasa|rabu|kamis|jumat)\b/i.test(rawInputLower);
    if (hasDayMention) {
      janganDiulang.push('Menanyakan "mau treatment di hari apa" karena Bunda sudah menyebutkan hari');
    }

    // 7. Cool-off
    const recentAssistantMsgs = history.filter((h) => h.role === 'assistant').slice(-2);
    const askedLocationRecently = recentAssistantMsgs.some((m) => {
      const c = (m.content || '').toLowerCase();
      return c.includes('daerah atau kelurahan') || c.includes('kelurahan mana') || c.includes('rumahnya dimana') || c.includes('lokasi rumah') || c.includes('alamat rumah');
    });
    if (askedLocationRecently) {
      janganDiulang.push('Menanyakan alamat/kelurahan rumah Bunda lagi (karena baru saja ditanyakan dan Bunda sedang fokus berkonsultasi). Berikan jawaban empatik tanpa menodong alamat!');
    }
    const askedScheduleRecently = recentAssistantMsgs.some((m) => {
      const c = (m.content || '').toLowerCase();
      return c.includes('di hari apa') || c.includes('jadwal kunjungan') || c.includes('jadwal bidan') || c.includes('ketersediaan jadwal') || c.includes('rencana mau treatment di hari apa');
    });
    if (askedScheduleRecently && !hasDayMention) {
      janganDiulang.push('Menanyakan "mau treatment di hari apa" atau menodong jadwal kunjungan lagi (karena baru saja ditanyakan). Jawab dengan ramah tanpa menodong!');
    }

    // 8. Topik sedang dibahas (simplified)
    let sedangDibahas = 'Bunda mengajukan pertanyaan seputar layanan';
    let yangPerluDijawab = 'Jawab pertanyaan Bunda dengan ramah dan solutif sebagai Bidan Yusi, lalu arahkan ke langkah berikutnya';
    if (hasDayMention) {
      sedangDibahas = 'Bunda menanyakan ketersediaan jadwal';
      yangPerluDijawab = 'Sampaikan bahwa ketersediaan jadwal Bidan yang bertugas akan dibantu cekkan terlebih dahulu (DILARANG bilang "Tentu bisa" sepihak).';
    } else if (rawInputLower.includes('menit') || rawInputLower.includes('durasi') || rawInputLower.includes('berapa lama')) {
      sedangDibahas = 'Bunda menanyakan durasi waktu pelaksanaan perawatan';
      yangPerluDijawab = 'Sebutkan durasi pelaksanaan secara jelas beserta manfaat relaksasinya.';
    } else if (rawInputLower.includes('berapa') || rawInputLower.includes('harga') || rawInputLower.includes('tarif') || rawInputLower.includes('biaya')) {
      sedangDibahas = 'Bunda menanyakan tarif / harga layanan';
      yangPerluDijawab = 'Sebutkan tarif promo paket yang relevan secara jelas dan transparan sesuai data katalog grounding.';
    } else if (rawInputLower.includes('cukur') && (rawInputLower.includes('berapa') || rawInputLower.includes('biaya'))) {
      sedangDibahas = 'Bunda menanyakan TARIF biaya cukur rambut';
      yangPerluDijawab = 'Sebutkan biaya cukur rambut dan akumulasikan ke total biaya.';
    }

    const sudahDibahasStr = sudahDibahas.length > 0 ? sudahDibahas.map((s) => `• ${s}`).join('\n') : '• Percakapan baru dimulai (Turn awal)';
    const janganDiulangStr = janganDiulang.length > 0 ? janganDiulang.map((j) => `• 🚫 ${j}`).join('\n') : '• Tidak ada larangan khusus';

    return `[RINGKASAN KONTEKS PERCAKAPAN SAAT INI]
STATUS DATA YANG SUDAH DILALUI:
${sudahDibahasStr}

FOKUS SAAT INI:
• ⏳ Sedang ditanyakan: ${sedangDibahas}
• 🎯 Yang wajib dijawab: ${yangPerluDijawab}

PANDUAN ANTI-PENGULANGAN (WAJIB DIPATUHI):
${janganDiulangStr}`;
  }
}
