/**
 * Helper waktu WIB (Waktu Indonesia Barat / UTC+7) untuk kecerdasan AI.
 * Memberikan info jam presisi dan label waktu (pagi, siang, sore, malam)
 * agar sapaan AI 100% akurat sesuai waktu lokal.
 */

export interface WibTimeInfo {
  hourWib: number;
  timeOfDay: 'pagi' | 'siang' | 'sore' | 'malam';
  greetingRecommendation: string;
  wibTimeString: string;
}

export function getWibTimeInfo(nowDate: Date = new Date()): WibTimeInfo {
  // WIB is UTC+7
  const wibDate = new Date(nowDate.getTime() + 7 * 60 * 60 * 1000);
  const hourWib = wibDate.getUTCHours();
  const minutes = String(wibDate.getUTCMinutes()).padStart(2, '0');

  let timeOfDay: 'pagi' | 'siang' | 'sore' | 'malam' = 'pagi';
  let greetingRecommendation = 'Selamat Pagi';

  if (hourWib >= 3 && hourWib < 11) {
    timeOfDay = 'pagi';
    greetingRecommendation = 'Selamat Pagi';
  } else if (hourWib >= 11 && hourWib < 15) {
    timeOfDay = 'siang';
    greetingRecommendation = 'Selamat Siang';
  } else if (hourWib >= 15 && hourWib < 18) {
    timeOfDay = 'sore';
    greetingRecommendation = 'Selamat Sore';
  } else {
    timeOfDay = 'malam';
    greetingRecommendation = 'Selamat Malam';
  }

  return {
    hourWib,
    timeOfDay,
    greetingRecommendation,
    wibTimeString: `${String(hourWib).padStart(2, '0')}:${minutes} WIB (${greetingRecommendation})`,
  };
}
