/**
 * Notification Sound & Web Notification Service
 * Menggunakan Web Audio API sintetis (WhatsApp-style chime) + Haptic Vibration + HTML5 Audio Fallback + Web Notifications
 * 100% Offline, Zero external MP3 dependency, Anti-blocking AudioContext auto-unlock untuk iOS Safari & Android Chrome.
 */

let audioCtxInstance: AudioContext | null = null;
let isAudioUnlocked = false;
let wavDataUriCache: string | null = null;

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
 * Dipakai sebagai fallback saat Web Audio API di-suspend oleh browser.
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
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
  view.setUint16(22, 1, true); // NumChannels (1 = Mono)
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, sampleRate * 2, true); // ByteRate
  view.setUint16(32, 2, true); // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample

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
      // Tone 1
      const env = Math.max(0, 1 - i / splitSample);
      sample = Math.sin(2 * Math.PI * freq1 * t) * env * 0.5;
    } else {
      // Tone 2
      const t2 = (i - splitSample) / sampleRate;
      const env = Math.exp(-t2 * 9.0);
      sample = Math.sin(2 * Math.PI * freq2 * t) * env * 0.7;
    }
    const intSample = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));
    view.setInt16(44 + i * 2, intSample, true);
  }

  // Convert buffer to base64
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

/**
 * Standard iOS & Android Web Audio Unlocker
 * Wajib memainkan silent buffer saat user interaction (touch/click) pertama kali.
 */
export function unlockAudioContext(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

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

/**
 * Auto-unlock AudioContext on first user interaction (touch/click/keydown)
 */
export function initAudioUnlock(): () => void {
  if (typeof window === 'undefined') return () => {};

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

/**
 * Mainkan nada chime pesan masuk khas WhatsApp (G5 784Hz -> C6 1046.5Hz) + Getaran Haptik
 * Dilengkapi dual engine: Web Audio API Synthesizer + HTML5 Audio Element Fallback.
 */
export function playIncomingMessageSound(): void {
  if (!isSoundEnabled()) return;

  // 1. Haptic Vibration (Khusus Smartphone Android/didukung)
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate([120, 80, 150]);
    }
  } catch (_) {}

  // 2. Web Audio API Two-Tone Synthesizer
  let playedWebAudio = false;
  try {
    const ctx = getAudioContext();
    if (ctx && ctx.state !== 'suspended') {
      const now = ctx.currentTime;

      // Tone 1: G5 - 784 Hz
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(783.99, now);
      gain1.gain.setValueAtTime(0.35, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.12);

      // Tone 2: C6 - 1046.5 Hz (Bright Crystal WhatsApp Tone)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1046.5, now + 0.08);
      gain2.gain.setValueAtTime(0.45, now + 0.08);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.08);
      osc2.stop(now + 0.42);

      playedWebAudio = true;
    } else if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  } catch (_) {
    playedWebAudio = false;
  }

  // 3. HTML5 Audio Data-URI Fallback jika Web Audio API terhalang / suspended
  if (!playedWebAudio) {
    try {
      const audio = new Audio(getWavDataUri());
      audio.volume = 0.85;
      audio.play().catch(() => {});
    } catch (_) {}
  }
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
