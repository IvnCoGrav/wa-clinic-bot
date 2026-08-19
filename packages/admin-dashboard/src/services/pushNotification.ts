import { apiRequest } from './api';

/**
 * Konversi VAPID Public Key base64 URL-safe menjadi Uint8Array untuk PushManager.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export interface PushStatus {
  supported: boolean;
  permission: NotificationPermission;
  subscribed: boolean;
  subscription: PushSubscription | null;
}

/**
 * Cek apakah browser mendukung Web Push Notification dan status saat ini.
 */
export async function getPushSubscriptionStatus(): Promise<PushStatus> {
  if (
    typeof window === 'undefined' ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window) ||
    !('Notification' in window)
  ) {
    return {
      supported: false,
      permission: 'denied',
      subscribed: false,
      subscription: null,
    };
  }

  const permission = Notification.permission;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return {
      supported: true,
      permission,
      subscribed: !!subscription,
      subscription,
    };
  } catch {
    return {
      supported: true,
      permission,
      subscribed: false,
      subscription: null,
    };
  }
}

/**
 * Mendaftarkan perangkat ke Web Push Notification (VAPID).
 */
export async function subscribeToPushNotifications(
  userType = 'ADMIN',
  userId?: string
): Promise<{ success: boolean; error?: string }> {
  if (
    typeof window === 'undefined' ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window) ||
    !('Notification' in window)
  ) {
    return { success: false, error: 'Web Push tidak didukung di browser ini' };
  }

  try {
    // 1. Minta izin notifikasi browser
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return { success: false, error: 'Izin notifikasi ditolak oleh pengguna' };
    }

    // 2. Ambil VAPID Public Key dari backend server
    const keyRes = await apiRequest<{ success: boolean; publicKey: string }>('/api/admin/push/public-key');
    if (!keyRes.success || !keyRes.publicKey) {
      return { success: false, error: 'Gagal mengambil VAPID key dari server' };
    }

    const applicationServerKey = urlBase64ToUint8Array(keyRes.publicKey);

    // 3. Daftarkan Service Worker dan buat Push Subscription
    let registration: ServiceWorkerRegistration;
    try {
      const reg = await navigator.serviceWorker.getRegistration('/admin/');
      if (reg) {
        registration = reg;
      } else {
        registration = await navigator.serviceWorker.register('/admin/sw.js', { scope: '/admin/' });
      }
    } catch {
      registration = await navigator.serviceWorker.ready;
    }

    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey as any,
      });
    }

    // 4. Kirim data PushSubscription ke backend
    await apiRequest('/api/admin/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({
        subscription: subscription.toJSON(),
        userType,
        userId,
      }),
    });

    console.log('[WEB PUSH] Perangkat berhasil berlangganan Push Notification!');
    return { success: true };
  } catch (err: any) {
    console.warn('[WEB PUSH] Pendaftaran push notification gagal:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Membatalkan langganan Web Push Notification.
 */
export async function unsubscribeFromPushNotifications(): Promise<{ success: boolean; error?: string }> {
  try {
    if (!('serviceWorker' in navigator)) return { success: true };
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();
      await apiRequest('/api/admin/push/unsubscribe', {
        method: 'POST',
        body: JSON.stringify({ endpoint }),
      });
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Mengirim notifikasi uji coba ke perangkat.
 */
export async function sendTestPush(): Promise<{ success: boolean }> {
  try {
    const status = await getPushSubscriptionStatus();
    const endpoint = status.subscription?.endpoint;
    return await apiRequest('/api/admin/push/test', {
      method: 'POST',
      body: JSON.stringify({ endpoint }),
    });
  } catch {
    return { success: false };
  }
}
