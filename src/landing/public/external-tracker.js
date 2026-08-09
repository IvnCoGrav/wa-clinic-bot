/*!
 * external-tracker.js
 * Jembatan Landing Page Eksternal -> endpoint /cta wa-clinic-bot (Skema 2: URL Redirect).
 *
 * Skema kerja:
 *   1. Landing Page Eksternal (WordPress / Elementor / HTML polos) memakai tombol CTA
 *      yang mengarah ke endpoint /cta bot:  https://<domain-bot>.com/cta?slug=SLUG_ANDA
 *   2. Skrip ini menyalin parameter atribusi dari address bar (fbclid, gclid, utm_*, dll)
 *      ke query string link CTA tersebut secara otomatis.
 *   3. Endpoint /cta yang memproses atribusi itu (generate trackingCode + event Meta
 *      Pixel saat redirect ke WhatsApp) — jadi tetap berfungsi penuh tanpa perlu
 *      mengubah manual tombol CTA di setiap LP Eksternal.
 *
 * Petunjuk pemasangan lengkap: docs/INTEGRASI_LANDING_EXTERNAL.md
 *
 * Sifat skrip:
 *   - READ-ONLY dan fail-open: hanya MENAMBAH query string pada link ber-arah /cta;
 *     tidak mengubah DOM lain, tidak menimpa event handler, tidak menambah listener.
 *     Error apa pun (mis. `URL`/`URLSearchParams` tidak tersedia) di-swallow —
 *     tombol CTA tetap berfungsi normal.
 *   - Idempoten: link yang sudah diproses diberi atribut `data-external-tracker-applied`.
 *     Parameter yang SUDAH ada di href tidak ditimpa (contoh: ?slug= di link tetap aman).
 *   - Auto-scan ulang via MutationObserver untuk menangkap tombol CTA yang baru dirender
 *     oleh Elementor / WP Builder setelah DOMContentLoaded.
 */
(function () {
  'use strict';

  // Whitelist parameter atribusi yang disalin dari address bar ke link CTA.
  // Parameter skema sistem (slug, p, phone, msg, greetings, dll.) sengaja TIDAK
  // ikut: itu bagian dari link CTA itu sendiri (di-set oleh pemilik LP) — tidak
  // boleh tertimpa oleh param acak yang kebetulan muncul di URL LP.
  var TRACKED_PARAMS = [
    // Meta / Facebook & Instagram ads
    'fbclid', 'fbp', 'fbc',
    // Google Ads
    'gclid', 'gclsrc', 'wbraid', 'gbraid',
    // Microsoft / Bing ads
    'msclkid',
    // TikTok ads
    'ttclid',
    // UTM standar
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
    // Lainnya (IG story / share)
    'igshid'
  ];

  // Path endpoint tujuan terdapat. Harus sesuai dengan rute `/cta` milik bot.
  var CTA_PATH = '/cta';

  // Membaca semua param atribusi dari address bar (search + bagian hash bila dipakai).
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
    } catch (e) {
      /* fail-open: URLSearchParams gagal parse -> tidak ada yang disalin */
    }
    return params;
  }

  // Salin atribusi ke satu link. Gagal diam-diam untuk link non-/cta.
  function applyToAnchor(anchor, params) {
    var href = anchor.getAttribute('href');
    if (!href || typeof URL === 'undefined') return;
    var url;
    try {
      url = new URL(href, window.location.href);
    } catch (e) {
      return;
    }
    // Hanya link path exact /cta (apapun origin / domainnya).
    if (url.pathname !== CTA_PATH) return;

    var changed = false;
    for (var key in params) {
      if (Object.prototype.hasOwnProperty.call(params, key) && !url.searchParams.has(key)) {
        url.searchParams.set(key, params[key]);
        changed = true;
      }
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
    var params = collectUrlParams();
    if (!Object.keys(params).length) return; // tak ada atribusi -> selesai

    function scanNow() {
      scan(document.querySelectorAll('a[href]'), params);
    }
    scanNow();

    // Pantau skenario konten dinamis (Elementor, WP, SPA) yang menambahkan CTA.
    if (typeof window.MutationObserver === 'function') {
      var debounceId = null;
      var observer = new MutationObserver(function () {
        // Throttle (debounce) 250 ms: skrip tidak mengubah atribut (hanya query link),
        // dan observer hanya memantau childList -> tidak ada loop umpan balik.
        if (debounceId) return;
        debounceId = setTimeout(function () {
          debounceId = null;
          scanNow();
        }, 250);
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  // Jalankan segera bila DOM sudah siap; kalau belum, tunggu DOMContentLoaded.
  if (document.body) {
    boot();
  } else if (document.addEventListener) {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    window.addEventListener('load', boot);
  }
})();