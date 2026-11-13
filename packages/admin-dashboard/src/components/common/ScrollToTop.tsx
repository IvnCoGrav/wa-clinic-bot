import { useEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/**
 * Memulihkan posisi gulir: PUSH membuka halaman dari atas, POP (tombol Back)
 * mengembalikan posisi sebelumnya. Tanpa ini, halaman baru terbuka di tengah
 * karena SPA tidak mereset scroll.
 */
export const ScrollToTop: React.FC = () => {
  const { pathname } = useLocation();
  const navType = useNavigationType();
  const positions = useRef<Record<string, number>>({});

  useEffect(() => {
    if (navType === 'POP') {
      window.scrollTo(0, positions.current[pathname] ?? 0);
    } else {
      window.scrollTo(0, 0);
    }
    return () => {
      positions.current[pathname] = window.scrollY;
    };
  }, [pathname, navType]);

  return null;
};
