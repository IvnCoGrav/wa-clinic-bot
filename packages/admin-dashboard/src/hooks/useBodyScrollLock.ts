import { useEffect } from 'react';

/**
 * Hook murni deklaratif berbasis state React untuk mengunci scroll body
 * saat modal, drawer, atau dialog sedang terbuka (isLocked = true).
 * 
 * Keunggulan:
 * - Tidak menggunakan MutationObserver DOM yang berat/berisiko infinite loop.
 * - Memulihkan scroll body secara otomatis saat komponen unmount atau ditutup.
 */
export function useBodyScrollLock(isLocked: boolean): void {
  useEffect(() => {
    if (isLocked) {
      document.body.classList.add('body-scroll-locked');
    } else {
      document.body.classList.remove('body-scroll-locked');
    }

    return () => {
      document.body.classList.remove('body-scroll-locked');
    };
  }, [isLocked]);
}
