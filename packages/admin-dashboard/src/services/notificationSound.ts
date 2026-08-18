/**
 * Notification Sound & Web Notification Service
 * Menggunakan Web Audio API sintetis (WhatsApp-style chime) + Haptic Vibration + HTML5 Notifications
 * 100% Offline, Zero external MP3 dependency, Anti-blocking AudioContext auto-unlock.
 */

let audioCtxInstance: AudioContext | null = null;
let isAudioUnlocked = false;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtxInstance) {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioCtx) {
      audioCtxInstance = new AudioCtx();
    }
  }
  if (audioCtxInstance && audioCtxInstance.state === 'suspended') {
    audioCtxInstance.resume().catch(() => {});
  }
  return audioCtxInstance;
}

/**
 * Auto-unlock AudioContext on first user interaction (touch/click/keydown)
 * Required by iOS Safari & Android Chrome autoplay security policy.
 */
export function initAudioUnlock(): () => void {
  if (typeof window === 'undefined' || isAudioUnlocked) return () => {};

  const unlock = () => {
    const ctx = getAudioContext();
    if (ctx) {
      if (ctx.state === 'suspended') {
        ctx.resume().then(() => {
          isAudioUnlocked = true;
        }).catch(() => {});
      } else {
        isAudioUnlocked = true;
      }
    }
    window.removeEventListener('touchstart', unlock);
    window.removeEventListener('touchend', unlock);
    window.removeEventListener('click', unlock);
    window.removeEventListener('keydown', unlock);
  };

  window.addEventListener('touchstart', unlock, { passive: true });
  window.addEventListener('touchend', unlock, { passive: true });
  window.addEventListener('click', unlock, { passive: true });
  window.addEventListener('keydown', unlock, { passive: true });

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
 */
export function playIncomingMessageSound(): void {
  if (!isSoundEnabled()) return;

  try {
    // 1. Haptic Vibration (Khusus Smartphone Android/didukung)
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate([120, 80, 150]);
    }

    // 2. Web Audio API Two-Tone Synthesizer
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    // Oscillator 1 (Tone Pertama: G5 - 784 Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(783.99, now);
    gain1.gain.setValueAtTime(0.2, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.12);

    // Oscillator 2 (Tone Kedua: C6 - 1046.5 Hz, Bright Crystal WhatsApp tone)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1046.5, now + 0.08);
    gain2.gain.setValueAtTime(0.28, now + 0.08);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.08);
    osc2.stop(now + 0.38);
  } catch (_) {
    // Silently ignore audio playback errors
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
      silent: false, // Browser native sound will play or accompany our chime
    });

    notification.onclick = () => {
      window.focus();
      opts.onClick?.();
      notification.close();
    };

    // Auto-close after 6 seconds
    setTimeout(() => {
      try {
        notification.close();
      } catch (_) {}
    }, 6000);
  } catch (_) {
    // Ignore notification errors in restrictive mobile environments
  }
}
