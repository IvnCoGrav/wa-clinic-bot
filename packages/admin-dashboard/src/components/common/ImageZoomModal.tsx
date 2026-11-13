/**
 * Lightbox gambar sederhana: klik latar atau tombol tutup untuk keluar,
 * tersedia tautan unduh/buka gambar asli.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { Download, X } from 'lucide-react';

interface ImageZoomModalProps {
  url: string;
  onClose: () => void;
}

export const ImageZoomModal: React.FC<ImageZoomModalProps> = ({ url, onClose }) => {
  return createPortal(
    <div
      role="presentation"
      className="modal-backdrop fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn h-[100dvh] w-[100dvw]"
      onClick={onClose}
    >
      <div
        role="presentation"
        className="relative max-w-3xl w-full max-h-[90dvh] flex flex-col items-center justify-center p-2"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            download
            className="p-2 rounded-full bg-white/20 hover:bg-white/40 text-white backdrop-blur-md transition"
            title="Buka / Download Foto Asli"
            aria-label="Buka atau unduh foto asli"
          >
            <Download size={18} />
          </a>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full bg-white/20 hover:bg-white/40 text-white backdrop-blur-md transition cursor-pointer"
            title="Tutup"
            aria-label="Tutup pratinjau gambar"
          >
            <X size={18} />
          </button>
        </div>
        <img src={url} alt="Zoom" className="max-w-full max-h-[85dvh] object-contain rounded-2xl shadow-2xl" />
      </div>
    </div>,
    document.body
  );
};
