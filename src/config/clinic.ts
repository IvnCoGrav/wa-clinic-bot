import dotenv from 'dotenv';
dotenv.config();

export interface ClinicConfig {
  lat: number;
  lng: number;
  name: string;
  maxDeliveryDistanceKm: number;
  humanHandlingTimeoutHours: number;
}

export const clinicConfig: ClinicConfig = {
  // Koordinat lokasi fisik moms & baby spa (Default: Waru Sidoarjo)
  lat: parseFloat(process.env.CLINIC_LAT || '-7.2574719'),
  lng: parseFloat(process.env.CLINIC_LNG || '112.7520883'),
  name: process.env.CLINIC_NAME || 'Kala Moms and Baby Spa',

  // Batas maksimal jangkauan pengiriman/treatment (dalam kilometer).
  // Dipakai sebagai cap atas fallback; sumber utama coverage = tier ongkir dari DB.
  maxDeliveryDistanceKm: parseFloat(process.env.MAX_DELIVERY_DISTANCE_KM || '30'),

  // Timeout auto-release status human handling (dalam jam)
  humanHandlingTimeoutHours: parseFloat(process.env.HUMAN_HANDLING_TIMEOUT_HOURS || '6'),
};
