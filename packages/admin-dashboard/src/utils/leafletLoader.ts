/**
 * leafletLoader.ts
 * Lazy-loader CDN untuk Leaflet + MarkerCluster. Dipakai HANYA saat tab peta dibuka,
 * sehingga bundle admin tidak membengkak dan dependency runtime npm tetap nol.
 *
 * Catatan: script & css dimuat dari CDN (unpkg). Butuh koneksi internet selain tile peta.
 * Lihat docs/KNOWN_ISSUES.md untuk limitasi & opsi migrasi ke npm.
 */

const LEAFLET_VER = '1.9.4';
const MARKERCLUSTER_VER = '1.5.3';

const CDN_ASSETS = {
  css: [
    `https://unpkg.com/leaflet@${LEAFLET_VER}/dist/leaflet.css`,
    `https://unpkg.com/leaflet.markercluster@${MARKERCLUSTER_VER}/dist/MarkerCluster.css`,
    `https://unpkg.com/leaflet.markercluster@${MARKERCLUSTER_VER}/dist/MarkerCluster.Default.css`,
  ],
};

let loadPromise: Promise<void> | null = null;

function waitForCss(href: string): Promise<void> {
  const id = `leaflet-cdn-css-${href}`;
  const existing = document.getElementById(id) as HTMLLinkElement | null;
  if (existing) {
    if (existing.dataset.loaded === 'true') return Promise.resolve();
    return new Promise((resolve) => {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => resolve(), { once: true });
    });
  }
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = () => {
      link.dataset.loaded = 'true';
      resolve();
    };
    link.onerror = () => resolve();
    document.head.appendChild(link);
  });
}

function injectScript(src: string): Promise<void> {
  const id = `leaflet-cdn-js-${src}`;
  const existing = document.getElementById(id) as HTMLScriptElement | null;
  if (existing) {
    if (existing.dataset.loaded === 'true') return Promise.resolve();
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Gagal memuat script: ${src}`)), {
        once: true,
      });
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.id = id;
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => reject(new Error(`Gagal memuat script: ${src}`));
    document.head.appendChild(script);
  });
}

const LEAFLET_URL = `https://unpkg.com/leaflet@${LEAFLET_VER}/dist/leaflet.js`;
const MARKERCLUSTER_URL = `https://unpkg.com/leaflet.markercluster@${MARKERCLUSTER_VER}/dist/leaflet.markercluster.js`;

/**
 * Memuat Leaflet + MarkerCluster dari CDN. Idempotent: pemanggilan berulang
 * mengembalikan promise yang sama sehingga tidak dobel-load.
 *
 * MarkerCluster bersifat OPSIONAL: bila plugin gagal dimuat, peta tetap berfungsi
 * dengan fallback LayerGroup (tanpa clustering) alih-alih gagal total.
 */
export function loadLeaflet(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    await Promise.all(CDN_ASSETS.css.map(waitForCss));
    await injectScript(LEAFLET_URL);
    const w = window as unknown as { L?: unknown };
    if (!w.L) {
      throw new Error('Leaflet gagal diinisialisasi dari CDN.');
    }
    try {
      await injectScript(MARKERCLUSTER_URL);
    } catch {
      // Plugin clustering tidak wajib; peta tetap tampil dengan LayerGroup biasa.
      console.warn('[leafletLoader] MarkerCluster gagal dimuat, lanjut tanpa clustering.');
    }
  })().catch((err) => {
    loadPromise = null;
    throw err;
  });
  return loadPromise;
}
