/**
 * Notification Sound & Web Notification Service
 * Menggunakan Web Audio API sintetis (WhatsApp-style chime) + Haptic Vibration + Pre-blessed HTML5 Audio + Web Notifications
 * 100% Offline, Anti-blocking AudioContext auto-unlock khusus untuk iOS Safari & Android Chrome.
 */

let audioCtxInstance: AudioContext | null = null;
let isAudioUnlocked = false;
let wavDataUriCache: string | null = null;
let singletonAudioElement: HTMLAudioElement | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtxInstance) {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioCtx) {
      audioCtxInstance = new AudioCtx();
    }
  }
  return audioCtxInstance;
}

/**
 * Buat WAV Audio Data URI sintetis (Two-Tone WhatsApp Chime G5 -> C6)
 */
function getWavDataUri(): string {
  if (wavDataUriCache) return wavDataUriCache;

  const sampleRate = 22050;
  const duration = 0.45; // detik
  const numSamples = Math.floor(sampleRate * duration);
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  // RIFF Chunk Descriptor
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(view, 8, 'WAVE');

  // fmt sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);

  // data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, numSamples * 2, true);

  // Generate Samples: Tone 1 (G5 ~784Hz) lalu Tone 2 (C6 ~1046.5Hz)
  const freq1 = 783.99;
  const freq2 = 1046.5;
  const splitSample = Math.floor(sampleRate * 0.1);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    let sample = 0;
    if (i < splitSample) {
      const env = Math.max(0, 1 - i / splitSample);
      sample = Math.sin(2 * Math.PI * freq1 * t) * env * 0.6;
    } else {
      const t2 = (i - splitSample) / sampleRate;
      const env = Math.exp(-t2 * 8.5);
      sample = Math.sin(2 * Math.PI * freq2 * t) * env * 0.85;
    }
    const intSample = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));
    view.setInt16(44 + i * 2, intSample, true);
  }

  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  wavDataUriCache = 'data:audio/wav;base64,' + btoa(binary);
  return wavDataUriCache;
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

function getSingletonAudio(): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null;
  if (!singletonAudioElement) {
    try {
      singletonAudioElement = new Audio(getWavDataUri());
      singletonAudioElement.preload = 'auto';
      singletonAudioElement.volume = 1.0;
      (singletonAudioElement as any).playsInline = true;
    } catch (_) {}
  }
  return singletonAudioElement;
}

/**
 * Standard iOS & Android Web Audio Unlocker
 * Wajib memainkan silent buffer & men-trigger Audio element saat user interaction (touch/click) pertama kali.
 */
export function unlockAudioContext(): void {
  // 1. Unlock Web Audio Context (100% Silent Buffer)
  const ctx = getAudioContext();
  if (ctx) {
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    try {
      const buffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
      isAudioUnlocked = true;
    } catch (_) {}
  }

  // 2. Pre-bless singleton HTML5 Audio Element untuk iOS Safari secara 100% senyap
  const audio = getSingletonAudio();
  if (audio) {
    try {
      audio.volume = 0;
      audio.muted = true;
      audio.play().then(() => {
        audio.pause();
        audio.currentTime = 0;
        audio.volume = 1.0;
        audio.muted = false;
      }).catch(() => {
        audio.volume = 1.0;
        audio.muted = false;
      });
    } catch (_) {}
  }
}

/**
 * Auto-unlock AudioContext on first user interaction (touch/click/keydown)
 */
export function initAudioUnlock(): () => void {
  if (typeof window === 'undefined') return () => {};

  // Pre-initialize singleton audio element
  getSingletonAudio();

  const unlock = () => {
    unlockAudioContext();
    window.removeEventListener('touchstart', unlock);
    window.removeEventListener('touchend', unlock);
    window.removeEventListener('click', unlock);
    window.removeEventListener('keydown', unlock);
  };

  window.addEventListener('touchstart', unlock, { passive: true, capture: true });
  window.addEventListener('touchend', unlock, { passive: true, capture: true });
  window.addEventListener('click', unlock, { passive: true, capture: true });
  window.addEventListener('keydown', unlock, { passive: true, capture: true });

  return () => {
    window.removeEventListener('touchstart', unlock);
    window.removeEventListener('touchend', unlock);
    window.removeEventListener('click', unlock);
    window.removeEventListener('keydown', unlock);
  };
}

export function isSoundEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  const stored = localStorage.getItem('live_chat_sound_enabled');
  return stored === null ? true : stored === 'true';
}

export function setSoundEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('live_chat_sound_enabled', enabled ? 'true' : 'false');
}

const MIN_SOUND_INTERVAL_MS = 2500;
let lastSoundPlayedAt = 0;

/**
 * Mainkan nada chime notifikasi pesan masuk yang jernih & lembut (A5 880Hz -> E6 1318.5Hz) + Getaran Haptik
 * Khusus dipanggil SAAT ADA PESAN BARU MASUK dari pelanggan (bukan untuk klik tombol).
 * Memiliki throttle debounce (minimal 2.5s) agar tidak meledak/burst saat banyak chat masuk serentak.
 */
export function playIncomingMessageSound(force = false): void {
  if (!isSoundEnabled()) return;

  const nowMs = Date.now();
  if (!force && nowMs - lastSoundPlayedAt < MIN_SOUND_INTERVAL_MS) {
    return;
  }
  lastSoundPlayedAt = nowMs;

  // 1. Haptic Vibration (Khusus notifikasi pesan masuk di Smartphone Android)
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate([120, 80, 150]);
    }
  } catch (_) {}

  // 2. Web Audio API Soft Crystal Two-Tone Synthesizer
  try {
    const ctx = getAudioContext();
    if (ctx) {
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      const now = ctx.currentTime;

      // Tone 1: A5 (880 Hz) - Soft Attack & Decay
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(880, now);
      gain1.gain.setValueAtTime(0.001, now);
      gain1.gain.exponentialRampToValueAtTime(0.35, now + 0.02);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.15);

      // Tone 2: E6 (1318.5 Hz) - Warm Crystal Chime
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1318.5, now + 0.09);
      gain2.gain.setValueAtTime(0.001, now + 0.09);
      gain2.gain.exponentialRampToValueAtTime(0.45, now + 0.11);
      gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.09);
      osc2.stop(now + 0.46);
    }
  } catch (_) {}

  // 3. HTML5 Audio Element Playback (Pre-blessed fallback jika Web Audio diblokir)
  try {
    const audio = getSingletonAudio();
    if (audio) {
      audio.currentTime = 0;
      audio.play().catch(() => {});
    }
  } catch (_) {}
}

/**
 * Request permission untuk notifikasi sistem browser (Desktop & Mobile)
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'denied';
  }
  if (Notification.permission === 'granted') {
    return 'granted';
  }
  try {
    return await Notification.requestPermission();
  } catch (_) {
    return 'denied';
  }
}

/**
 * Kirim notifikasi sistem browser (saat tab diminimalkan / di latar belakang)
 */
export function showBrowserNotification(opts: {
  title: string;
  body: string;
  conversationId?: string;
  onClick?: () => void;
}): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  try {
    const notification = new Notification(opts.title, {
      body: opts.body,
      icon: '/favicon.ico',
      tag: opts.conversationId || 'live_chat_incoming',
      silent: false,
    });

    notification.onclick = () => {
      window.focus();
      opts.onClick?.();
      notification.close();
    };

    setTimeout(() => {
      try {
        notification.close();
      } catch (_) {}
    }, 6000);
  } catch (_) {}
}
