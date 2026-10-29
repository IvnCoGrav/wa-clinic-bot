import React, { useRef, useState, useEffect } from 'react';
import { RefreshCw, Play } from 'lucide-react';

export interface VoiceNotePlayerProps {
  src: string;
}

export const VoiceNotePlayer: React.FC<VoiceNotePlayerProps> = ({ src }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [hasError, setHasError] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const fmt = (s: number) => {
    if (!isFinite(s) || isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  };

  useEffect(() => {
    let isCancelled = false;
    let localBlobUrl: string | null = null;
    setIsLoading(true);
    setHasError(false);

    fetch(src, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (isCancelled) return;
        localBlobUrl = URL.createObjectURL(blob);
        setBlobUrl(localBlobUrl);
        setIsLoading(false);
      })
      .catch(() => {
        if (isCancelled) return;
        setHasError(true);
        setIsLoading(false);
      });

    return () => {
      isCancelled = true;
      if (localBlobUrl) {
        URL.revokeObjectURL(localBlobUrl);
      }
    };
  }, [src, retryCount]);

  useEffect(() => {
    setHasError(false);
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setCurrent(a.currentTime);
    const onMeta = () => setDuration(a.duration);
    const onEnd = () => setPlaying(false);
    const onError = () => {
      setHasError(true);
      setPlaying(false);
    };
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('loadedmetadata', onMeta);
    a.addEventListener('ended', onEnd);
    a.addEventListener('error', onError);
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('loadedmetadata', onMeta);
      a.removeEventListener('ended', onEnd);
      a.removeEventListener('error', onError);
    };
  }, [blobUrl]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a || hasError || isLoading) return;
    if (playing) {
      a.pause();
      setPlaying(false);
    } else {
      a.play().then(() => setPlaying(true)).catch(() => setHasError(true));
    }
  };

  const seek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    if (audioRef.current) audioRef.current.currentTime = v;
    setCurrent(v);
  };

  if (hasError) {
    return (
      <div className="flex items-center gap-2 py-1.5 min-w-[180px] max-w-[260px] text-warning">
        <button
          type="button"
          onClick={() => setRetryCount((c) => c + 1)}
          title="Coba lagi memuat audio"
          className="w-8 h-8 rounded-full bg-warning hover:bg-warning-hover text-on-solid flex items-center justify-center shrink-0 active:scale-95 transition"
        >
          <RefreshCw size={13} />
        </button>
        <div className="flex-1 min-w-0 text-[11px] leading-tight">
          <p className="font-bold">Audio belum siap / gagal</p>
          <p className="text-warning/80">
            <button
              type="button"
              onClick={() => setRetryCount((c) => c + 1)}
              className="underline text-accent hover:text-accent-hover font-medium mr-1.5"
            >
              Coba lagi
            </button>
            {blobUrl && (
              <a
                href={blobUrl}
                download="voice_note.oga"
                className="underline text-accent hover:text-accent-hover"
              >
                Unduh
              </a>
            )}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2.5 py-1 min-w-[180px] max-w-[260px]">
      <button
        type="button"
        onClick={toggle}
        disabled={isLoading}
        className="w-8 h-8 rounded-full bg-accent text-white flex items-center justify-center shrink-0 shadow-xs active:scale-95 transition disabled:opacity-50"
      >
        {isLoading ? (
          <RefreshCw size={13} className="animate-spin text-white" />
        ) : playing ? (
          <span className="w-2.5 h-2.5 bg-surface rounded-sm" />
        ) : (
          <Play size={14} className="ml-0.5 fill-white" />
        )}
      </button>
      <div className="flex-1 min-w-0">
        <input
          type="range"
          min={0}
          max={duration || 100}
          value={current}
          onChange={seek}
          disabled={isLoading}
          className="w-full accent-accent h-1"
        />
        <div className="flex justify-between text-[10px] font-mono text-ink-2 mt-0.5">
          <span>{fmt(current)}</span>
          <span>{fmt(duration)}</span>
        </div>
      </div>
      {blobUrl && <audio ref={audioRef} src={blobUrl} preload="metadata" className="hidden" />}
    </div>
  );
};
