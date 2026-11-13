/**
 * DOM-02: tipe & konstanta buku alamat pelanggan (dipisah dari logika).
 */
import { z } from 'zod';

export const MAX_SAVED_ADDRESSES = 10;
export const SAME_POINT_MAX_METERS = 150;
/** Batas panjang label kartu alamat (teknis, bukan data bisnis) — UI + API + domain. */
export const MAX_ADDRESS_LABEL_LENGTH = 60;

/** Normalisasi label: trim, buang kosong, potong ke batas maksimum. */
export function normalizeAddressLabel(value?: string | null): string | null {
  const clean = String(value ?? '').trim();
  if (!clean) return null;
  return clean.slice(0, MAX_ADDRESS_LABEL_LENGTH);
}

export const SavedCustomerAddressSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  address: z.string().default(''),
  kelurahan: z.string().nullable().optional().default(null),
  kecamatan: z.string().nullable().optional().default(null),
  kota: z.string().nullable().optional().default(null),
  lat: z.number().nullable().optional().default(null),
  lng: z.number().nullable().optional().default(null),
  distanceKm: z.number().nullable().optional().default(null),
  ongkir: z.number().nullable().optional().default(null),
  landmark: z.string().nullable().optional().default(null),
  locationSource: z
    .enum(['gps_pin', 'estimated_area', 'manual_staff'])
    .nullable()
    .optional()
    .default(null),
  isPrimary: z.boolean().optional().default(false),
  createdAt: z.string().optional().default(() => new Date().toISOString()),
  lastUsedAt: z.string().optional().default(() => new Date().toISOString()),
});

export type SavedCustomerAddress = z.infer<typeof SavedCustomerAddressSchema>;

export interface UpsertSavedAddressInput {
  id?: string;
  label?: string;
  address?: string | null;
  kelurahan?: string | null;
  kecamatan?: string | null;
  kota?: string | null;
  lat?: number | null;
  lng?: number | null;
  distanceKm?: number | null;
  ongkir?: number | null;
  landmark?: string | null;
  locationSource?: 'gps_pin' | 'estimated_area' | 'manual_staff' | null;
  isPrimary?: boolean;
}

export interface UpsertResult {
  list: SavedCustomerAddress[];
  entry: SavedCustomerAddress;
}
