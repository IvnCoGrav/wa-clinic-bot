/*!
 * external-tracker.js
 * Jembatan Landing Page Eksternal (Scalev, Berdu, WordPress, HTML) -> Meta Pixel & endpoint /cta wa-clinic-bot.
 *
 * Fitur Utama:
 *   1. Auto Meta Pixel: Otomatis memuat library Meta Pixel (fbevents.js), inisialisasi Pixel ID,
 *      dan menembakkan event PageView di domain eksternal secara non-intrusif & idempoten.
 *   2. Auto UTM & FBCLID Transfer: Menyalin parameter atribusi (fbclid, fbp, fbc, utm_*) dari
 *      address bar ke semua tombol CTA yang mengarah ke endpoint /cta bot.
 *   3. Fail-open & Idempoten: Tidak akan pernah menghentikan alur kerja halaman bila terjadi error jaringan.
 */
(function () {
  'use strict';

  // Default Pixel ID Klinik (Kala Baby Spa)
  var DEFAULT_PIXEL_ID = '1465457801784141';

  // Whitelist parameter atribusi yang disalin dari address bar ke link CTA
  var TRACKED_PARAMS = [
    'fbclid', 'fbp', 'fbc',
    'gclid', 'gclsrc', 'wbraid', 'gbraid',
    'msclkid',
    'ttclid',
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
    'igshid',
    'landing_url'
  ];

  var CTA_PATH = '/cta';

  // -------------------------------------------------------------------------
  // 1. AUTO META PIXEL LOADER & PAGEVIEW
  // -------------------------------------------------------------------------
  function getScriptPixelId() {
    try {
      var currentScript = document.currentScript;
      if (!currentScript) {
        var scripts = document.getElementsByTagName('script');
        for (var i = scripts.length - 1; i >= 0; i--) {
          if (scripts[i].src && scripts[i].src.indexOf('external-tracker.js') !== -1) {
            currentScript = scripts[i];
            break;
          }
        }
      }
      if (currentScript && currentScript.src) {
        var qIdx = currentScript.src.indexOf('?');
        if (qIdx !== -1) {
          var sp = new URLSearchParams(currentScript.src.slice(qIdx + 1));
          var p = sp.get('pixel') || sp.get('p') || sp.get('pixel_id');
          if (p && /^\d+$/.test(p)) return p;
        }
      }
    } catch (_) {}
    return DEFAULT_PIXEL_ID;
  }

  function initMetaPixel() {
    var pixelId = getScriptPixelId();
    if (!pixelId) return;

    // Load Meta Base Code jika window.fbq belum ada
    if (typeof window.fbq === 'undefined') {
      (function (f, b, e, v, n, t, s) {
        if (f.fbq) return;
        n = f.fbq = function () {
          n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
        };
        if (!f._fbq) f._fbq = n;
        n.push = n;
        n.loaded = true;
        n.version = '2.0';
        n.queue = [];
        t = b.createElement(e);
        t.async = true;
        t.src = v;
        s = b.getElementsByTagName(e)[0];
        if (s && s.parentNode) {
          s.parentNode.insertBefore(t, s);
        } else {
          document.head.appendChild(t);
        }
      })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    }

    // Inisialisasi Pixel & Kirim PageView (hanya 1x per lifecycle halaman)
    if (!window._kala_pixel_initialized) {
      window._kala_pixel_initialized = true;
      try {
        window.fbq('init', pixelId);
        window.fbq('track', 'PageView');
      } catch (err) {
        /* fail-open */
      }
    }
  }

  // -------------------------------------------------------------------------
  // 2. AUTO UTM & ATTRIBUTION TO CTA BUTTONS
  // -------------------------------------------------------------------------
  function collectUrlParams() {
    if (typeof window.URLSearchParams === 'undefined') return {};
    var raw = window.location.search || '';
    var hashIndex = window.location.hash.indexOf('?');
    if (hashIndex !== -1) {
      raw += '&' + window.location.hash.slice(hashIndex + 1);
    }
    var params = {};
    try {
      var search = new URLSearchParams(raw);
      for (var i = 0; i < TRACKED_PARAMS.length; i++) {
        var value = search.get(TRACKED_PARAMS[i]);
        if (value !== null && value !== '') {
          params[TRACKED_PARAMS[i]] = value;
        }
      }
    } catch (e) {}
    return params;
  }

  function applyToAnchor(anchor, params) {
    var href = anchor.getAttribute('href');
    if (!href || typeof URL === 'undefined') return;
    var url;
    try {
      url = new URL(href, window.location.href);
    } catch (e) {
      return;
    }
    
    // Cocokkan link yang mengarah ke endpoint /cta
    if (url.pathname !== CTA_PATH && !url.pathname.endsWith('/cta')) return;

    var changed = false;
    for (var key in params) {
      if (Object.prototype.hasOwnProperty.call(params, key) && !url.searchParams.has(key)) {
        url.searchParams.set(key, params[key]);
        changed = true;
      }
    }

    // Selalu sertakan landing_url (URL landing page asli pengunjung saat ini) jika belum ada
    if (!url.searchParams.has('landing_url') && typeof window !== 'undefined' && window.location && window.location.href) {
      url.searchParams.set('landing_url', window.location.href);
      changed = true;
    }

    if (changed) {
      anchor.setAttribute('href', url.toString());
    }
    anchor.setAttribute('data-external-tracker-applied', '1');
  }

  function scan(anchors, params) {
    for (var i = 0; i < anchors.length; i++) {
      if (anchors[i].getAttribute('data-external-tracker-applied')) continue;
      applyToAnchor(anchors[i], params);
    }
  }

  function boot() {
    // 1. Jalankan Auto Meta Pixel
    initMetaPixel();

    // 2. Scan & salin param URL ke CTA
    var params = collectUrlParams();
    function scanNow() {
      if (Object.keys(params).length) {
        scan(document.querySelectorAll('a[href]'), params);
      }
    }
    scanNow();

    // Pantau konten dinamis (Elementor, Scalev, Nuxt SPA)
    if (typeof window.MutationObserver === 'function') {
      var debounceId = null;
      var observer = new MutationObserver(function () {
        if (debounceId) return;
        debounceId = setTimeout(function () {
          debounceId = null;
          scanNow();
        }, 250);
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  // Eksekusi segera
  if (document.body) {
    boot();
  } else if (document.addEventListener) {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    window.addEventListener('load', boot);
  }
})();