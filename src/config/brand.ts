/**
 * brand.ts
 * Sumber tunggal identitas brand (nama bisnis, nama bot, panggilan customer).
 * Wajib: seluruh komponen (bot engine, dashboard, click-catcher) memakai brand dari sini,
 * bukan string literal tersebar. Nilai default ini adalah fallback — nantinya bisa
 * di-override per-tenant dari DB (Fase 2).
 */

export interface BrandIdentity {
  botDisplayName: string;
  businessName: string;
  serviceType: string;
  addressTermForCustomer: string;
}

export const DEFAULT_BRAND_IDENTITY: BrandIdentity = {
  botDisplayName: "Bidan Yusi",
  businessName: "Kala Moms and Baby Spa",
  serviceType: "Homecare — treatment dipanggil langsung ke rumah customer",
  addressTermForCustomer: "Bunda", // panggilan ke customer, singkatan informal: "bund"
};

let currentBrand: BrandIdentity = { ...DEFAULT_BRAND_IDENTITY };

export function getBrandIdentity(): BrandIdentity {
  return currentBrand;
}

export function setBrandIdentity(partial: Partial<BrandIdentity>): BrandIdentity {
  currentBrand = { ...currentBrand, ...partial };
  return currentBrand;
}

export function resetBrandIdentity(): void {
  currentBrand = { ...DEFAULT_BRAND_IDENTITY };
}
