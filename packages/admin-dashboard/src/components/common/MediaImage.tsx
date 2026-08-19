import React, { useState, useEffect } from 'react';
import { ImageOff, Loader, X } from 'lucide-react';

export interface ChatMediaData {
  url?: string;
  hdUrl?: string;
  mimeType?: string;
  caption?: string;
}

/**
 * MediaImage — menampilkan gambar Live Chat secara langsung, bersih, dan tajam.
 * - Klik/tap gambar untuk melihat resolusi asli (Full-View Lightbox Modal).
 * - Tanpa tombol download / watermark yang menutupi gambar.
 * - Mendukung tombol Esc dan klik background untuk menutup preview.
 */
export const MediaImage: React.FC<{
  src?: string;
  downloadSrc?: string;
  caption?: string;
  blur?: boolean;
}> = ({ src, downloadSrc, caption }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [isViewerOpen, setIsViewerOpen] = useState(false);

  const previewSrc = src || downloadSrc;
  const originalFullSrc = downloadSrc || src || '';

  // Tutup viewer saat menekan tombol Escape
  useEffect(() => {
    if (!isViewerOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsViewerOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isViewerOpen]);

  if (!previewSrc || error) {
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
      <div className="relative inline-block overflow-hidden rounded-xl group">
        {loading && (
          <div className="absolute inset-0 rounded-xl bg-slate-100/90 flex items-center justify-center text-slate-400 z-10">
            <Loader size={16} className="animate-spin text-[#008069]" />
          </div>
        )}
        <img
          src={previewSrc}
          alt={caption || 'Gambar'}
          loading="lazy"
          onLoad={() => setLoading(false)}
          onError={() => {
            setLoading(false);
            setError(true);
          }}
          onClick={() => setIsViewerOpen(true)}
          title="Klik / tap untuk melihat resolusi asli"
          className="w-full max-w-[220px] sm:max-w-[260px] h-auto max-h-64 object-cover rounded-lg border border-black/10 transition-transform duration-200 hover:opacity-95 hover:scale-[1.01] cursor-pointer"
        />

        {caption && (
          <span className="block mt-1 text-[11px] text-slate-700 font-normal">
            {caption}
          </span>
        )}
      </div>

      {/* Full-Screen Original Resolution Modal */}
      {isViewerOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 select-none animate-in fade-in duration-150"
          onClick={() => setIsViewerOpen(false)}
        >
          {/* Close Button */}
          <button
            type="button"
            onClick={() => setIsViewerOpen(false)}
            title="Tutup (Esc)"
            className="absolute top-3 right-3 sm:top-5 sm:right-5 p-2 rounded-full bg-white/15 hover:bg-white/30 text-white transition cursor-pointer z-50 shadow-lg"
          >
            <X size={22} />
          </button>

          <div
            className="relative max-w-full max-h-full flex flex-col items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={originalFullSrc || previewSrc}
              alt={caption || 'Gambar resolusi asli'}
              className="max-w-[95vw] max-h-[88vh] object-contain rounded-lg shadow-2xl transition-all"
            />
            {caption && (
              <p className="mt-2.5 text-white/90 text-xs sm:text-sm font-medium text-center max-w-xl bg-black/60 px-4 py-1.5 rounded-full backdrop-blur">
                {caption}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
};