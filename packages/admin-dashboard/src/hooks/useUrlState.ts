import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Menyimpan nilai filter di query string, bukan di state lokal.
 *
 * Efek yang diinginkan: filter tetap sama saat halaman di-refresh, bisa dibagikan
 * lewat tautan, dan tombol Back mengembalikan filter sebelumnya. Nilai default
 * tidak ditulis ke URL supaya tautan tetap bersih.
 */
export function useUrlState(key: string, fallback = ''): [string, (next: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const value = searchParams.get(key) ?? fallback;

  const setValue = useCallback(
    (next: string) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (!next || next === fallback) params.delete(key);
          else params.set(key, next);
          return params;
        },
        { replace: true }
      );
    },
    [key, fallback, setSearchParams]
  );

  return [value, setValue];
}
