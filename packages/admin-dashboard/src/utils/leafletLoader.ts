/**
 * leafletLoader.ts
 * Lazy-loader **lokal** untuk Leaflet + MarkerCluster (vendor di
 * `public/vendor/leaflet/`, same-origin). Dipakai HANYA saat tab peta dibuka,
 * sehingga bundle admin tidak membengkak.
 *
 * KNOWN #344: sebelumnya memuat dari unpkg.com dan diblokir CSP
 * (`script-src 'self'`). Sekarang seluruh aset berasal dari server sendiri agar
 * kebal CDN down/AdBlock dan CSP tetap ketat.
 *
 * Lisensi: Leaflet (BSD-2-Clause) & Leaflet.markercluster (MIT) — file lisensi
 * disertakan di folder vendor.
 */

export interface LeafletAssetUrls {
  base: string;
  css: string[];
  js: string;
  markerClusterJs: string;
}

/** Normalisasi base URL aset (selalu berakhir dengan '/'). */
export function resolveLeafletAssetBase(baseUrl?: string): string {
  const raw = String(baseUrl || '/').trim() || '/';
  const withSlash = raw.endsWith('/') ? raw : `${raw}/`;
  return `${withSlash}vendor/leaflet/`;
}

/**
 * URL aset same-origin. `baseUrl` default mengikuti `import.meta.env.BASE_URL`
 * (Vite: '/admin/') agar tetap benar saat dashboard diserve di sub-path.
 */
export function getLeafletAssetUrls(baseUrl?: string): LeafletAssetUrls {
  const base = resolveLeafletAssetBase(baseUrl);
  return {
    base,
    css: [
      `${base}leaflet.css`,
      `${base}MarkerCluster.css`,
      `${base}MarkerCluster.Default.css`,
    ],
    js: `${base}leaflet.js`,
    markerClusterJs: `${base}leaflet.markercluster.js`,
  };
}

let loadPromise: Promise<void> | null = null;

function waitForCss(href: string): Promise<void> {
  const id = `leaflet-local-css-${href}`;
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
  const id = `leaflet-local-js-${src}`;
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

/**
 * Memuat Leaflet + MarkerCluster dari aset lokal. Idempotent: pemanggilan
 * berulang mengembalikan promise yang sama sehingga tidak dobel-load; bila
 * gagal, promise di-reset agar tombol "Coba Lagi" bisa memuat ulang.
 *
 * MarkerCluster bersifat OPSIONAL: bila plugin gagal dimuat, peta tetap berfungsi
 * dengan fallback LayerGroup (tanpa clustering) alih-alih gagal total.
 */
export function loadLeaflet(): Promise<void> {
  if (loadPromise) return loadPromise;
  const assets = getLeafletAssetUrls(
    typeof import.meta !== 'undefined' ? (import.meta as any)?.env?.BASE_URL : undefined
  );

  loadPromise = (async () => {
    await Promise.all(assets.css.map(waitForCss));
    await injectScript(assets.js);
    const w = window as unknown as { L?: unknown };
    if (!w.L) {
      throw new Error('Leaflet gagal diinisialisasi dari aset lokal.');
    }
    try {
      await injectScript(assets.markerClusterJs);
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
