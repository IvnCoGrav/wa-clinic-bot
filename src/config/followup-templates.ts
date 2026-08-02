/**
 * Rolling Templates Engine for Reminders & Follow-Ups
 * Provides multiple natural Indonesian variations per trigger stage
 * to prevent repetitive bot messaging patterns and maintain high engagement.
 */

import { getBrandIdentity } from './brand';

export interface FollowUpTemplateParams {
  name: string;
  time?: string;
  babyName?: string;
  treatmentName?: string;
  index?: number;
}

export type FollowUpTemplateType =
  | 'REMINDER_H0'
  | 'REVIEW_H1_BABY'
  | 'REVIEW_H1_MOMS'
  | 'NO_PURCHASE_1'
  | 'NO_PURCHASE_2'
  | 'NO_PURCHASE_3'
  | 'NEXT_TREATMENT_1'
  | 'NEXT_TREATMENT_2'
  | 'NEXT_TREATMENT_3';

export const FOLLOWUP_ROLLING_TEMPLATES: Record<
  FollowUpTemplateType,
  Array<(params: FollowUpTemplateParams) => string>
> = {
  // 1. Reminder Hari-H (06:00 WIB)
  REMINDER_H0: [
    ({ name, time }) =>
      `Selamat pagi Bunda ${name}! ✨ Reminder untuk jadwal treatment homecare ${getBrandIdentity().businessName} hari ini jam ${time || 'sesuai kesepakatan'} ya bund. Tim bidan kami akan datang sesuai jadwal. Sampai jumpa Bunda! 🥰`,
    ({ name, time }) =>
      `Halo Bunda ${name}, selamat pagi! 🌸 Mengingatkan kembali jadwal treatment ${getBrandIdentity().businessName} hari ini pukul ${time || 'sesuai kesepakatan'} ya. Mohon disiapkan tempat yang nyaman ya bund. Terimakasih! ✨`,
    ({ name, time }) =>
      `Pagi Bunda ${name}! 🥰 Nanti jam ${time || 'sesuai kesepakatan'} tim bidan ${getBrandIdentity().businessName} akan menuju ke rumah Bunda untuk treatment. Sampai ketemu nanti ya bund! ✨`,
  ],

  // 2. Review H+1 Baby (07:00 WIB)
  REVIEW_H1_BABY: [
    ({ name, babyName }) =>
      `Selamat pagi Bunda ${name}! 🌸 Bagaimana kabar dek ${babyName || 'si kecil'} setelah treatment kemarin bund? Semoga tidurnya lebih nyenyak dan makin sehat ya! Jika ada masukan, kabari Bidan ya bund 🥰`,
    ({ name, babyName }) =>
      `Halo Bunda ${name}! ✨ Bidan mau tanya nih, gimana perkembangan dek ${babyName || 'si kecil'} setelah dipijat kemarin? Semoga makin aktif & rewelnya berkurang ya bund. Sehat selalu! ❤️`,
    ({ name, babyName }) =>
      `Pagi Bunda ${name}! 🥰 Semoga dek ${babyName || 'si kecil'} makin ceria & rileks ya pasca treatment kemarin. Kalau mau konsultasi atau tanya-tanya seputar perawatan bayi, jangan ragu chat Bidan lagi ya bund! ✨`,
  ],

  // 3. Review H+1 Moms (07:00 WIB)
  REVIEW_H1_MOMS: [
    ({ name }) =>
      `Selamat pagi Bunda ${name}! 🌸 Bagaimana kondisi badan Bunda setelah treatment kemarin? Semoga pegalnya berkurang & makin rileks ya bund. Jika ada keluhan, kabari Bidan ya! 🥰`,
    ({ name }) =>
      `Halo Bunda ${name}! ✨ Semoga istirahatnya makin nyenyak & tubuh terasa lebih segar setelah treatment kemarin ya bund. Terimakasih sudah memercayakan perawatan ke ${getBrandIdentity().businessName}! ❤️`,
    ({ name }) =>
      `Pagi Bunda ${name}! 🥰 Bidan berharap badan Bunda terasa jauh lebih enteng & segar hari ini. Kalau butuh reservasi atau perawatan lanjutan, Bidan siap bantu kapan saja ya bund! ✨`,
  ],

  // 4. Follow-Up No Purchase Stage 1 (Hari ke-3)
  NO_PURCHASE_1: [
    ({ name }) =>
      `Halo Bunda ${name}! ✨ Kemarin sempat tanya-tanya treatment homecare ${getBrandIdentity().businessName} ya bund. Apakah ada yang mau ditanyakan lagi atau mau Bidan bantu jadwalkan? 😊`,
    ({ name }) =>
      `Pagi Bunda ${name}! 🌸 Masih bingung pilih paket treatment yang cocok untuk si kecil? Bidan siap bantu rekomendasikan lho bund, mumpung ada promo bulan ini! 🤗`,
    ({ name }) =>
      `Salam Bunda ${name}! ✨ Kalau Bunda butuh informasi tambahan seputar perawatan bayi/ibu hamil, jangan ragu tanya Bidan ya bund. Kami siap datang langsung ke rumah! 🥰`,
  ],

  // 5. Follow-Up No Purchase Stage 2 (Hari ke-7)
  NO_PURCHASE_2: [
    ({ name }) =>
      `Halo Bunda ${name}! 🌸 Sudah seminggu nih sejak Bunda kontak ${getBrandIdentity().businessName}. Si kecil sedang rewel atau butuh pijat relaksasi bund? Bidan ada slot kosong minggu ini lho! 🥰`,
    ({ name }) =>
      `Pagi Bunda ${name}! ✨ Bidan cuma mau kasih info nih, promo potongan ongkir & voucher treatment homecare masih berlaku ya bund. Mau dijadwalkan minggu ini? 😊`,
    ({ name }) =>
      `Selamat pagi Bunda ${name}! 💖 Momen tumbuh kembang si kecil sangat berharga. Yuk bantu stimulasi & relaksasinya lewat pijat bayi homecare dari bidan bersertifikat! ✨`,
  ],

  // 6. Follow-Up No Purchase Stage 3 (Hari ke-14)
  NO_PURCHASE_3: [
    ({ name }) =>
      `Halo Bunda ${name}! 💖 Ini pesan sapaan terakhir dari Bidan ya bund. Kalau sewaktu-waktu si kecil atau Bunda butuh treatment homecare, simpan kontak ${getBrandIdentity().businessName} ini ya! 🤗✨`,
    ({ name }) =>
      `Pagi Bunda ${name}! 🌸 Bidan selalu mendoakan si kecil sehat & Bunda tetap bahagia. Jika nanti butuh perawatan bayi/ibu hamil, bisa langsung hubungi kami kembali ya bund! 🥰`,
    ({ name }) =>
      `Salam hangat Bunda ${name}! ✨ Terima kasih sudah pernah menghubungi ${getBrandIdentity().businessName}. Jangan sungkan chat Bidan kapan pun butuh layanan pijat homecare terpercaya ya bund! ❤️`,
  ],

  // 7. Follow-Up Next Treatment Stage 1 (Bulan ke-1)
  NEXT_TREATMENT_1: [
    ({ name }) =>
      `Halo Bunda ${name}! 🌸 Sudah 1 bulan nih sejak treatment terakhir di ${getBrandIdentity().businessName}. Saatnya si kecil pijat rutin bulanan nih bund, supaya tumbuh kembangnya makin optimal! 🥰`,
    ({ name }) =>
      `Selamat pagi Bunda ${name}! ✨ Pijat rutin 1 bulan sekali sangat bagus untuk menjaga kelenturan otot & kualitas tidur si kecil lho bund. Mau Bidan jadwalkan minggu ini? 😊`,
    ({ name }) =>
      `Pagi Bunda ${name}! 💖 Tidak terasa sudah sebulan lalu ya bund. Yuk amankan slot treatment rutin si kecil atau ibu hamil/nifas minggu ini bersama Bidan ${getBrandIdentity().businessName}! ✨`,
  ],

  // 8. Follow-Up Next Treatment Stage 2 (Bulan ke-2)
  NEXT_TREATMENT_2: [
    ({ name }) =>
      `Halo Bunda ${name}! 💖 Sudah 2 bulan tidak kelihatan nih. Si kecil sudah tambah pinter apa aja bund? Jangan lupa agendakan pijat stimulasi tumbuh kembang ya bund! 🥰`,
    ({ name }) =>
      `Pagi Bunda ${name}! 🌸 Tubuh Bunda atau si kecil sudah terasa pegal/capek lagi? Yuk manjakan diri & si kecil dengan perawatan homecare ${getBrandIdentity().businessName} bulan ini bund! ✨`,
    ({ name }) =>
      `Salam hangat Bunda ${name}! ✨ Bidan siap bantu reservasi pijat rutin bulanan lagi nih bund. Bidan favorit Bunda masih tersedia lho! Mau pilih hari apa bund? 😊`,
  ],

  // 9. Follow-Up Next Treatment Stage 3 (Bulan ke-3)
  NEXT_TREATMENT_3: [
    ({ name }) =>
      `Halo Bunda ${name}! 🌸 Sudah 3 bulan sejak perawatan terakhir. Ini reminder perawatan rutin terakhir dari Bidan ya bund. Semoga si kecil selalu sehat & makin aktif! 🥰`,
    ({ name }) =>
      `Pagi Bunda ${name}! ✨ Kalau si kecil butuh pijat tumbuh kembang atau Bunda butuh relaksasi, Bidan ${getBrandIdentity().businessName} selalu siap kapan saja ya bund. Sehat selalu! ❤️`,
    ({ name }) =>
      `Salam Bunda ${name}! 💖 Terima kasih telah menjadi pelanggan setia ${getBrandIdentity().businessName}. Simpan kontak ini ya bund, kapan pun butuh treatment homecare kami siap datang! ✨`,
  ],
};

/**
 * Generates a rolling follow-up message with template rotation.
 * If index is specified, uses that variation. Otherwise picks deterministically based on timestamp/id or randomly.
 */
export function getRollingFollowUpMessage(
  type: FollowUpTemplateType,
  params: FollowUpTemplateParams
): { text: string; templateIndex: number } {
  const templates = FOLLOWUP_ROLLING_TEMPLATES[type];
  if (!templates || templates.length === 0) {
    return { text: `Halo Bunda ${params.name}!`, templateIndex: 0 };
  }

  let idx = 0;
  if (typeof params.index === 'number' && params.index >= 0) {
    idx = params.index % templates.length;
  } else {
    // Pick randomly or based on minute
    idx = Math.floor(Math.random() * templates.length);
  }

  const fn = templates[idx];
  return {
    text: fn(params),
    templateIndex: idx + 1, // 1-indexed for UI display
  };
}
