import React, { createContext, useContext, useEffect, useState } from 'react';
import { apiRequest } from '../services/api';

/**
 * Cfg-015 + KNOWN #358 (A-003 / K-2): identitas brand dashboard TIDAK boleh
 * hardcode (mis. "Kala Spa"). Sumber tunggal non-rahasia: `GET /api/admin/auth/me`
 * → `brand.businessName` & `brand.botDisplayName` sehingga THERAPIST maupun
 * role lain mendapat brand asli tanpa memicu 403 pada `GET /api/admin/settings`.
 *
 * Fallback netral "Klinik"/"Admin" dipakai hanya sampai respons pertama tiba
 * atau saat belum login / DB offline — bukan nama bisnis tertentu.
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
      '/api/admin/auth/me'
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
