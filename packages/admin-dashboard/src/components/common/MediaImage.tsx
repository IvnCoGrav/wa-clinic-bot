import React, { useEffect, useRef, useState } from 'react';
import { ImageOff, Download, Loader } from 'lucide-react';

export interface ChatMediaData {
  url?: string;
  hdUrl?: string;
  mimeType?: string;
  caption?: string;
}

/**
 * MediaImage — menampilkan gambar Live Chat dalam resolusi rendah (low-res)
 * dengan mengompresi via <canvas> di sisi client.
 *
 * - Outbound: memakai url (thumbnail low-res bawaan server) atau menurunkan skala
 *   dari URL HD. Tombol download membuka versi HD.
 * - Inbound: ditampilkan blur + tombol download di tengah ke versi asli (hdUrl).
 * - Bila file sudah dihapus (kadaluarsa), tampil placeholder "Gambar kadaluarsa".
 */
export const MediaImage: React.FC<{
  src?: string;
  downloadSrc?: string;
  caption?: string;
  blur?: boolean;
}> = ({ src, downloadSrc, caption, blur }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!src) {
      setError(true);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(false);
    setThumbUrl(null);

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.addEventListener('load', () => {
      try {
        const maxDim = 480;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        if (!canvasRef.current) {
          canvasRef.current = document.createElement('canvas');
        }
        const canvas = canvasRef.current;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no ctx');
        ctx.drawImage(img, 0, 0, w, h);
        if (!cancelled) setThumbUrl(canvas.toDataURL('image/jpeg', 0.7));
      } catch {
        // gagal proses canvas → pakai src asli sebagai fallback tampilan
        if (!cancelled) setThumbUrl(src);
      } finally {
        if (!cancelled) setLoading(false);
      }
    });
    img.addEventListener('error', () => {
      if (!cancelled) {
        setLoading(false);
        setError(true);
      }
    });
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);

  if (error) {
    return (
      <div className="w-56 h-40 rounded-xl bg-slate-800/80 border border-white/10 flex flex-col items-center justify-center text-slate-500 text-[10px] space-y-2 px-3 text-center">
        <ImageOff size={18} />
        <span>Gambar tidak tersedia (mungkin sudah dihapus setelah masa retensi)</span>
      </div>
    );
  }

  const rendered = thumbUrl || src;
  return (
    <div className="relative group">
      {loading && (
        <div className="absolute inset-0 rounded-xl bg-slate-800/80 flex items-center justify-center text-slate-400">
          <Loader size={16} className="animate-spin" />
        </div>
      )}
      <img
        src={rendered}
        alt={caption || 'Gambar'}
        className={`w-56 h-40 object-cover rounded-xl border border-white/10 ${blur ? 'blur-[10px]' : ''}`}
      />
      {downloadSrc && (
        <a
          href={downloadSrc}
          target="_blank"
          rel="noreferrer"
          title="Lihat / unduh resolusi penuh"
          className="absolute inset-0 flex items-center justify-center group"
        >
          <span className="p-2.5 rounded-full bg-slate-900/80 border border-white/20 text-white shadow-lg hover:bg-pink-500 transition group-hover:scale-105">
            <Download size={16} />
          </span>
        </a>
      )}
      {caption && (
        <span className="absolute bottom-1.5 left-2 right-2 text-[9px] text-white/90 font-sans bg-slate-900/60 rounded px-2 py-0.5 backdrop-blur truncate">
          {caption}
        </span>
      )}
      <canvas ref={canvasRef} className="hidden" width="1" height="1" />
    </div>
  );
};