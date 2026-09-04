import React from 'react';
import { ZoomIn, ZoomOut, RotateCcw, Minimize2, Maximize2, Columns } from 'lucide-react';
import { CalendarZoomState, CalendarZoomPreset } from '../../hooks/useCalendarZoom';

interface CalendarZoomControlsProps {
  zoomState: CalendarZoomState;
  className?: string;
  variant?: 'floating' | 'inline';
}

export const CalendarZoomControls: React.FC<CalendarZoomControlsProps> = ({
  zoomState,
  className = '',
  variant = 'inline',
}) => {
  const { hourHeight, zoomPercent, zoomLevel, zoomIn, zoomOut, resetZoom, setPreset } = zoomState;

  const presets: { id: CalendarZoomPreset; label: string; icon: React.ReactNode }[] = [
    { id: 'compact', label: 'Kompak', icon: <Minimize2 size={12} /> },
    { id: 'normal', label: 'Standar', icon: <Columns size={12} /> },
    { id: 'detailed', label: 'Detail', icon: <Maximize2 size={12} /> },
  ];

  if (variant === 'floating') {
    return (
      <div
        className={`inline-flex items-center gap-1 p-1 bg-white/95 dark:bg-[#111b21]/95 backdrop-blur-md rounded-2xl border border-[#d1d7db] dark:border-[#2a3942] shadow-md text-[#111b21] dark:text-[#e9edef] select-none z-20 ${className}`}
      >
        <button
          type="button"
          onClick={zoomOut}
          className="p-1.5 rounded-xl hover:bg-[#f0f2f5] dark:hover:bg-[#202c33] active:bg-[#e9edef] dark:active:bg-[#2a3942] text-[#54656f] dark:text-[#aebac1] hover:text-[#111b21] dark:hover:text-[#e9edef] transition cursor-pointer"
          title="Perkecil jam (Zoom Out)"
        >
          <ZoomOut size={14} />
        </button>

        {/* Preset Selector */}
        <div className="flex items-center gap-0.5 bg-[#f0f2f5] dark:bg-[#202c33] p-0.5 rounded-xl">
          {presets.map((p) => {
            const isActive = zoomLevel === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPreset(p.id)}
                className={`px-2 py-1 rounded-lg text-[10.5px] font-bold transition-all flex items-center gap-1 cursor-pointer ${
                  isActive
                    ? 'bg-white dark:bg-[#111b21] text-[#008069] dark:text-[#00a884] shadow-2xs'
                    : 'text-[#54656f] dark:text-[#aebac1] hover:text-[#111b21] dark:hover:text-[#e9edef]'
                }`}
              >
                {p.icon}
                <span className="hidden sm:inline">{p.label}</span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={zoomIn}
          className="p-1.5 rounded-xl hover:bg-[#f0f2f5] dark:hover:bg-[#202c33] active:bg-[#e9edef] dark:active:bg-[#2a3942] text-[#54656f] dark:text-[#aebac1] hover:text-[#111b21] dark:hover:text-[#e9edef] transition cursor-pointer"
          title="Perbesar jam (Zoom In)"
        >
          <ZoomIn size={14} />
        </button>

        {hourHeight !== 90 && (
          <button
            type="button"
            onClick={resetZoom}
            className="p-1.5 rounded-xl hover:bg-[#f0f2f5] dark:hover:bg-[#202c33] active:bg-[#e9edef] dark:active:bg-[#2a3942] text-[#8696a0] hover:text-[#008069] dark:hover:text-[#00a884] transition cursor-pointer"
            title="Reset ke 100%"
          >
            <RotateCcw size={12} />
          </button>
        )}
      </div>
    );
  }

  // Inline / Header Variant
  return (
    <div className={`flex items-center gap-1.5 select-none ${className}`}>
      <div className="flex items-center gap-0.5 bg-white dark:bg-[#111b21] border border-[#e9edef] dark:border-[#2a3942] rounded-xl p-0.5 shadow-2xs">
        <button
          type="button"
          onClick={zoomOut}
          className="p-1.5 rounded-lg hover:bg-[#f0f2f5] dark:hover:bg-[#202c33] text-[#54656f] dark:text-[#aebac1] hover:text-[#111b21] dark:hover:text-[#e9edef] transition cursor-pointer"
          title="Zoom Out (Perkecil Kerapatan Jam)"
        >
          <ZoomOut size={13} />
        </button>

        <div className="flex items-center gap-0.5 px-0.5">
          {presets.map((p) => {
            const isActive = zoomLevel === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPreset(p.id)}
                className={`p-1.5 rounded-lg transition-all flex items-center justify-center cursor-pointer ${
                  isActive
                    ? 'bg-[#e8f5f2] dark:bg-[#00a884]/20 text-[#008069] dark:text-[#00a884] border border-[#c2e7e0] dark:border-[#00a884]/40 shadow-2xs'
                    : 'text-[#54656f] dark:text-[#aebac1] hover:bg-[#f0f2f5] dark:hover:bg-[#202c33] hover:text-[#111b21] dark:hover:text-[#e9edef]'
                }`}
                title={`Mode ${p.label}`}
              >
                {p.icon}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={zoomIn}
          className="p-1.5 rounded-lg hover:bg-[#f0f2f5] dark:hover:bg-[#202c33] text-[#54656f] dark:text-[#aebac1] hover:text-[#111b21] dark:hover:text-[#e9edef] transition cursor-pointer"
          title="Zoom In (Perbesar Kerapatan Jam)"
        >
          <ZoomIn size={13} />
        </button>
      </div>

      {hourHeight !== 90 && (
        <button
          type="button"
          onClick={resetZoom}
          className="p-1.5 rounded-xl bg-white dark:bg-[#111b21] border border-[#e9edef] dark:border-[#2a3942] hover:bg-[#f0f2f5] dark:hover:bg-[#202c33] text-[#8696a0] hover:text-[#008069] dark:hover:text-[#00a884] transition shadow-2xs cursor-pointer"
          title="Reset Zoom ke 100%"
        >
          <RotateCcw size={12} />
        </button>
      )}
    </div>
  );
};
