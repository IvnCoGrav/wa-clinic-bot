import React, { createContext, useContext, useEffect, useState } from 'react';
import { apiRequest } from '../services/api';

/**
 * Cfg-015: identitas brand dashboard TIDAK boleh hardcode (mis. "Kala Spa").
 * Sumber tunggal: `GET /api/admin/settings` → `brand.businessName` &
 * `brand.botDisplayName` (diisi dari `Tenant.settings.brand` / kolom tenant).
 *
 * Fallback netral "Klinik"/"Admin" dipakai hanya sampai respons pertama tiba
 * atau saat DB offline — bukan nama bisnis tertentu.
 */
export interface BrandIdentity {
  businessName: string;
  botDisplayName: string;
}

const FALLBACK_BRAND: BrandIdentity = {
  businessName: 'Klinik',
  botDisplayName: 'Admin',
};

const BrandContext = createContext<BrandIdentity>(FALLBACK_BRAND);

export const BrandProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [brand, setBrand] = useState<BrandIdentity>(FALLBACK_BRAND);

  useEffect(() => {
    let cancelled = false;
    apiRequest<{ brand?: { businessName?: string; botDisplayName?: string } | null }>(
      '/api/admin/settings'
    )
      .then((res) => {
        if (cancelled) return;
        const b = res?.brand;
        if (!b) return;
        const businessName =
          typeof b.businessName === 'string' && b.businessName.trim()
            ? b.businessName.trim()
            : FALLBACK_BRAND.businessName;
        const botDisplayName =
          typeof b.botDisplayName === 'string' && b.botDisplayName.trim()
            ? b.botDisplayName.trim()
            : FALLBACK_BRAND.botDisplayName;
        setBrand({ businessName, botDisplayName });
      })
      .catch(() => {
        /* DB offline / belum login → fallback netral */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>;
};

export function useBrandIdentity(): BrandIdentity {
  return useContext(BrandContext);
}
