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
  function getCookie(name) {
    try {
      var match = document.cookie.match(new RegExp('(^|;\\s*)' + name + '=([^;]*)'));
      return match ? decodeURIComponent(match[2]) : null;
    } catch (_) {
      return null;
    }
  }

  function setCookie(name, value, days) {
    try {
      var d = new Date();
      d.setTime(d.getTime() + (days || 90) * 24 * 60 * 60 * 1000);
      var expires = '; expires=' + d.toUTCString();
      document.cookie = name + '=' + encodeURIComponent(value) + expires + '; path=/; SameSite=Lax';
    } catch (_) {}
  }

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

  function initMetaPixel(pvEventId) {
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
        // Aktifkan Automatic Advanced Matching dengan Geo-Hint 'id' (Indonesia)
        window.fbq('init', pixelId, { country: 'id' });
        window.fbq('track', 'PageView', {}, { eventID: pvEventId });
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

    // Auto-Capture & Format cookie _fbc dari fbclid
    if (params.fbclid && !params.fbc) {
      var fbcValue = 'fb.1.' + Date.now() + '.' + params.fbclid;
      params.fbc = fbcValue;
      setCookie('_fbc', fbcValue, 90);
    } else if (!params.fbc) {
      var existingFbc = getCookie('_fbc');
      if (existingFbc) params.fbc = existingFbc;
    }

    // Capture cookie _fbp jika ada
    if (!params.fbp) {
      var existingFbp = getCookie('_fbp');
      if (existingFbp) params.fbp = existingFbp;
    }

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

  // -------------------------------------------------------------------------
  // 3. SERVER-SIDE PAGEVIEW BEACON
  // -------------------------------------------------------------------------
  function getBaseApiUrl() {
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
        var u = new URL(currentScript.src);
        return u.origin;
      }
    } catch (_) {}
    return 'https://app.kalababyspa.online';
  }

  function sendPageViewBeacon(params, pvEventId) {
    if (window._kala_pageview_tracked) return;
    window._kala_pageview_tracked = true;

    try {
      var baseUrl = getBaseApiUrl();
      var endpoint = baseUrl + '/api/tracking/pageview';
      var payload = {
        eventID: pvEventId,
        landingUrl: window.location.href,
        referrer: document.referrer || null,
        fbclid: params.fbclid || null,
        fbp: params.fbp || null,
        fbc: params.fbc || null,
        utm_source: params.utm_source || null,
        utm_medium: params.utm_medium || null,
        utm_campaign: params.utm_campaign || null,
        utm_term: params.utm_term || null,
        utm_content: params.utm_content || null,
        utm_id: params.utm_id || null,
      };

      var jsonStr = JSON.stringify(payload);
      if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        var blob = new Blob([jsonStr], { type: 'application/json' });
        navigator.sendBeacon(endpoint, blob);
      } else if (typeof fetch === 'function') {
        fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: jsonStr,
          keepalive: true,
          mode: 'cors',
        }).catch(function () {});
      }
    } catch (_) {
      /* fail-open */
    }
  }

  function boot() {
    var pvEventId = 'pv_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);

    // 1. Jalankan Auto Meta Pixel dengan eventID kembar
    initMetaPixel(pvEventId);

    var params = collectUrlParams();

    // 2. Kirim sinyal PageView ke server sistem bot dengan eventID kembar untuk deduplikasi
    sendPageViewBeacon(params, pvEventId);

    // 3. Scan & salin param URL ke CTA
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