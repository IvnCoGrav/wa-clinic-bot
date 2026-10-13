import { useState, useCallback } from 'react';
import { extractLatLngFromMapsUrl } from '../utils/geoUtils';
import { apiRequest } from '../services/api';
import { useUiFeedback } from '../components/common/UiFeedback';

export interface ResolvedMapsLocation {
  lat: number;
  lng: number;
  kelurahan?: string;
  kecamatan?: string;
  kota?: string;
  formattedAddress?: string;
  source?: string;
}

/**
 * Hook terpusat untuk mengurai tautan Google Maps (baik koordinat langsung maupun shortlink maps.app.goo.gl).
 * Menggantikan duplikasi regex inline di CustomerEditForm, LocationPickerModal, Reservations, dan TodayTreatments.
 */
export function useMapsShortlinkResolver() {
  const [isResolving, setIsResolving] = useState(false);
  const { toast } = useUiFeedback();

  const resolve = useCallback(
    async (input: string, options: { silent?: boolean } = {}): Promise<ResolvedMapsLocation | null> => {
      const val = (input || '').trim();
      if (!val || val.length < 5) return null;

      // 1. Coba regex lokal instan (0ms) untuk URL dengan koordinat eksplisit
      const parsed = extractLatLngFromMapsUrl(val);
      if (parsed) {
        if (!options.silent) {
          toast('✓ Koordinat berhasil diekstrak dari link Google Maps! 📍', 'success');
        }
        return { lat: parsed.lat, lng: parsed.lng };
      }

      // 2. Jika bukan koordinat langsung tapi memuat URL / shortlink, panggil backend resolver
      setIsResolving(true);
      try {
        const res: any = await apiRequest('/api/admin/customers/resolve-location', {
          method: 'POST',
          body: JSON.stringify({ url: val }),
        });
        if (res?.success && res?.data) {
          const d = res.data;
          if (!options.silent) {
            toast('✓ Alamat & koordinat berhasil diambil dari Google Maps! 📍', 'success');
          }
          return {
            lat: Number(d.lat),
            lng: Number(d.lng),
            kelurahan: d.kelurahan,
            kecamatan: d.kecamatan,
            kota: d.kota,
            formattedAddress: d.formattedAddress,
            source: d.source,
          };
        } else {
          if (!options.silent) {
            toast(res?.error || 'Gagal mengurai tautan Google Maps', 'error');
          }
          return null;
        }
      } catch (err: any) {
        if (!options.silent) {
          toast(err?.message || 'Gagal mengurai tautan Google Maps', 'error');
        }
        return null;
      } finally {
        setIsResolving(false);
      }
    },
    [toast]
  );

  return {
    isResolving,
    resolve,
  };
}
