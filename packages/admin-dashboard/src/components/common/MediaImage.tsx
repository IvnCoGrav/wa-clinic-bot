import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ImageOff, Loader, X, ArrowLeft, Sparkles, Check, ZoomIn, ZoomOut, Download } from 'lucide-react';

export interface ChatMediaData {
  url?: string;
  hdUrl?: string;
  thumbUrl?: string;
  mimeType?: string;
  caption?: string;
}

/**
 * MediaImage — Komponen penampilan gambar di Live Chat & Dashboard.
 * 1. Default saat dibuka: Menampilkan resolusi standar (preview) yang jelas dan cepat.
 * 2. Tombol HD On-Demand: Gambar resolusi penuh (HD) hanya dimuat saat tombol "HD" diklik oleh user.
 * 3. Mobile Friendly: Skema navigasi kembali yang jelas (Header Bar 'Kembali', Bottom Bar 'Kembali ke Chat',
 *    Swipe-down gesture untuk dismiss, Back button browser/Android, dan Escape key).
 */
export const MediaImage: React.FC<{
  src?: string;
  downloadSrc?: string;
  thumbUrl?: string;
  caption?: string;
  blur?: boolean;
  alt?: string;
}> = ({ src, downloadSrc, thumbUrl, caption, alt }) => {
  const [thumbnailLoading, setThumbnailLoading] = useState(true);
  const [error, setError] = useState(false);
  const [isViewerOpen, setIsViewerOpen] = useState(false);

  // HD on-demand states
  const [isHdRequested, setIsHdRequested] = useState(false);
  const [isHdLoading, setIsHdLoading] = useState(false);
  const [isHdLoaded, setIsHdLoaded] = useState(false);
  const [isZoomed, setIsZoomed] = useState(false);

  // Mobile swipe/pull down to dismiss states
  const [touchTranslateY, setTouchTranslateY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const touchStartYRef = useRef<number>(0);
  const isHistoryPushedRef = useRef<boolean>(false);

  // Standard preview (jelas, cepat, hemat kuota) vs HD original
  const standardSrc = src || thumbUrl || downloadSrc || '';
  const hdSrc = downloadSrc || src || '';
  const hasHdOption = Boolean(hdSrc && standardSrc && hdSrc !== standardSrc);

  // Current active modal source (hanya beralih ke HD jika sudah diminta & berhasil di-load)
  const activeModalSrc = isHdLoaded && hdSrc ? hdSrc : standardSrc;

  // Tutup viewer modal & reset state
  const closeViewer = useCallback(() => {
    setIsViewerOpen(false);
    setIsZoomed(false);
    setIsHdRequested(false);
    setIsHdLoading(false);
    setIsHdLoaded(false);
    setTouchTranslateY(0);
    setIsDragging(false);

    if (isHistoryPushedRef.current) {
      isHistoryPushedRef.current = false;
      if (window.history.state?.modal === 'media-viewer') {
        window.history.back();
      }
    }
  }, []);

  // Buka viewer modal dengan browser history push (agar tombol back Android menutup modal)
  const openViewer = () => {
    setIsViewerOpen(true);
    setIsZoomed(false);
    setIsHdRequested(false);
    setIsHdLoading(false);
    setIsHdLoaded(false);
    setTouchTranslateY(0);

    try {
      window.history.pushState({ modal: 'media-viewer' }, '');
      isHistoryPushedRef.current = true;
    } catch (_) {}
  };

  // Muat gambar HD hanya saat tombol HD ditekan
  const handleLoadHd = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!hasHdOption || isHdLoading || isHdLoaded) return;

    setIsHdRequested(true);
    setIsHdLoading(true);

    const img = new Image();
    img.src = hdSrc;
    img.onload = () => {
      setIsHdLoaded(true);
      setIsHdLoading(false);
    };
    img.onerror = () => {
      setIsHdLoading(false);
    };
  };

  // Keyboard Escape & Browser Popstate (Android Back) listeners + Body Scroll Lock
  useEffect(() => {
    if (!isViewerOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeViewer();
      }
    };

    const handlePopState = () => {
      if (isHistoryPushedRef.current) {
        isHistoryPushedRef.current = false;
        setIsViewerOpen(false);
        setIsZoomed(false);
      }
    };

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('popstate', handlePopState);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [isViewerOpen, closeViewer]);

  // Touch Drag-to-Dismiss handlers untuk smartphone
  const handleTouchStart = (e: React.TouchEvent) => {
    if (isZoomed) return;
    if (e.touches.length === 1) {
      touchStartYRef.current = e.touches[0].clientY;
      setIsDragging(true);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging || isZoomed) return;
    if (e.touches.length === 1) {
      const currentY = e.touches[0].clientY;
      const deltaY = currentY - touchStartYRef.current;
      if (deltaY > 0) {
        setTouchTranslateY(deltaY);
      } else {
        setTouchTranslateY(deltaY * 0.2); // resistansi saat geser ke atas
      }
    }
  };

  const handleTouchEnd = () => {
    if (!isDragging || isZoomed) return;
    setIsDragging(false);
    if (touchTranslateY > 80) {
      closeViewer();
    } else {
      setTouchTranslateY(0);
    }
  };

  if (!standardSrc || error) {
    return (
      <div className="w-56 h-36 rounded-xl bg-slate-100 border border-slate-200 flex flex-col items-center justify-center text-slate-500 text-[10px] space-y-1.5 px-3 text-center">
        <ImageOff size={18} className="text-slate-400" />
        <span className="font-medium text-slate-500 leading-tight">
          Gambar tidak tersedia
        </span>
      </div>
    );
  }

  return (
    <>
      {/* Inline Chat Bubble Thumbnail */}
      <div className="relative inline-block overflow-hidden rounded-xl group max-w-full">
        {thumbnailLoading && (
          <div className="absolute inset-0 rounded-xl bg-slate-100/90 flex items-center justify-center text-slate-400 z-10">
            <Loader size={16} className="animate-spin text-[#008069]" />
          </div>
        )}
        <img
          src={standardSrc}
          alt={caption || alt || 'Gambar'}
          loading="lazy"
          onLoad={() => setThumbnailLoading(false)}
          onError={() => {
            setThumbnailLoading(false);
            setError(true);
          }}
          onClick={openViewer}
          title="Klik / tap untuk melihat foto"
          className="w-full max-w-[220px] sm:max-w-[260px] h-auto max-h-64 object-cover rounded-lg border border-black/10 transition-transform duration-200 hover:opacity-95 hover:scale-[1.01] cursor-pointer"
        />

        {caption && (
          <span className="block mt-1 text-[11px] text-slate-700 font-normal break-words">
            {caption}
          </span>
        )}
      </div>

      {/* Full-Screen Lightbox Modal with Mobile Header & HD On-Demand */}
      {isViewerOpen && (
        <div
          className="fixed inset-0 z-[100] bg-black/95 sm:bg-black/90 backdrop-blur-sm flex flex-col justify-between select-none animate-in fade-in duration-150"
          onClick={closeViewer}
        >
          {/* Top Navigation Header Bar (Safe Area Friendly) */}
          <div
            className="w-full bg-black/80 sm:bg-black/60 backdrop-blur-md border-b border-white/10 px-3 py-2.5 sm:px-5 sm:py-3 flex items-center justify-between z-50 shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Left: Kembali ke Chat Button */}
            <button
              type="button"
              onClick={closeViewer}
              title="Kembali ke Chat (Esc)"
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-white/15 hover:bg-white/25 active:bg-white/35 text-white text-xs font-semibold shadow-sm transition cursor-pointer touch-manipulation"
            >
              <ArrowLeft size={16} />
              <span className="inline sm:hidden">Kembali</span>
              <span className="hidden sm:inline">Kembali ke Chat</span>
            </button>

            {/* Center: Title / HD Status Indicator */}
            <div className="flex items-center space-x-1.5 max-w-[40%] sm:max-w-[50%] truncate text-center">
              <span className="text-white/90 text-xs sm:text-sm font-semibold truncate">
                {caption ? caption : 'Lihat Foto'}
              </span>
              {isHdLoaded && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500 text-white shrink-0 tracking-wider">
                  HD
                </span>
              )}
            </div>

            {/* Right: Actions (HD toggle, Zoom, Close) */}
            <div className="flex items-center space-x-1.5 sm:space-x-2">
              {/* HD Button: Hanya muat HD saat tombol ini ditekan */}
              {hasHdOption && (
                <>
                  {!isHdRequested && !isHdLoaded && (
                    <button
                      type="button"
                      onClick={handleLoadHd}
                      title="Klik untuk memuat resolusi penuh (HD)"
                      className="flex items-center space-x-1 px-2.5 py-1.5 rounded-full bg-amber-500/90 hover:bg-amber-500 active:bg-amber-600 text-white text-[11px] font-bold shadow-sm transition cursor-pointer touch-manipulation ring-1 ring-amber-300/50 animate-pulse"
                    >
                      <Sparkles size={13} />
                      <span>Muat HD</span>
                    </button>
                  )}

                  {isHdLoading && (
                    <div className="flex items-center space-x-1 px-2.5 py-1.5 rounded-full bg-slate-800 text-slate-200 text-[11px] font-medium border border-slate-700">
                      <Loader size={13} className="animate-spin text-amber-400" />
                      <span>Memuat HD...</span>
                    </div>
                  )}

                  {isHdLoaded && (
                    <div className="flex items-center space-x-1 px-2.5 py-1.5 rounded-full bg-emerald-600/90 text-white text-[11px] font-bold shadow-xs">
                      <Check size={13} />
                      <span>HD Aktif</span>
                    </div>
                  )}
                </>
              )}

              {/* Zoom In/Out Button (Desktop & Tablet) */}
              <button
                type="button"
                onClick={() => setIsZoomed(!isZoomed)}
                title={isZoomed ? 'Perkecil' : 'Perbesar'}
                className="hidden sm:flex p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition cursor-pointer"
              >
                {isZoomed ? <ZoomOut size={17} /> : <ZoomIn size={17} />}
              </button>

              {/* Close Button */}
              <button
                type="button"
                onClick={closeViewer}
                title="Tutup (Esc)"
                className="p-1.5 sm:p-2 rounded-full bg-white/15 hover:bg-white/25 active:bg-white/35 text-white transition cursor-pointer touch-manipulation"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Main Image Stage with Touch Drag Support */}
          <div
            className="flex-1 min-h-0 flex flex-col items-center justify-center p-2 sm:p-4 overflow-hidden relative"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            <div
              className={`relative max-w-full max-h-full flex flex-col items-center justify-center transition-all ${
                isDragging ? 'duration-0' : 'duration-200'
              }`}
              style={{
                transform: `translateY(${touchTranslateY}px) ${isZoomed ? 'scale(1.5)' : 'scale(1)'}`,
                opacity: Math.max(0.2, 1 - touchTranslateY / 250),
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <img
                src={activeModalSrc}
                alt={caption || alt || 'Gambar Foto'}
                onClick={() => setIsZoomed(!isZoomed)}
                className={`max-w-[96vw] sm:max-w-[90vw] max-h-[72vh] sm:max-h-[80vh] object-contain rounded-lg shadow-2xl transition-transform ${
                  isZoomed ? 'cursor-zoom-out' : 'cursor-zoom-in'
                }`}
              />

              {caption && (
                <p className="mt-2 text-white/95 text-xs sm:text-sm font-medium text-center max-w-xl bg-black/75 px-4 py-1.5 rounded-full backdrop-blur-md shadow-md">
                  {caption}
                </p>
              )}
            </div>
          </div>

          {/* Mobile Bottom Quick Dismiss Bar */}
          <div
            className="w-full flex sm:hidden items-center justify-center pb-5 pt-1 px-4 z-50 shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={closeViewer}
              className="px-5 py-2 rounded-full bg-white/20 active:bg-white/35 text-white text-xs font-semibold backdrop-blur-md border border-white/25 shadow-lg flex items-center space-x-2 transition cursor-pointer touch-manipulation"
            >
              <ArrowLeft size={15} />
              <span>Kembali ke Chat</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
};