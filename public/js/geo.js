/**
 * Visitor location detection.
 *
 * Order of preference:
 *   1. A location already resolved in a previous visit (localStorage).
 *   2. Browser geolocation -> server-side reverse geocode.
 *   3. Server-side IP lookup.
 *
 * The permission prompt is shown at most once ever: the visitor's answer is
 * remembered in localStorage, so a denial is never re-asked. If everything
 * fails the page simply keeps the server-rendered defaults.
 */
(function () {
  'use strict';

  var STORE_KEY = 'websaf_location';
  var ASKED_KEY = 'websaf_geo_asked';
  var TTL_MS = 7 * 24 * 60 * 60 * 1000;

  function readStore(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (e) {
      return null; // private mode / storage blocked
    }
  }
  function writeStore(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (e) {
      /* non-fatal */
    }
  }

  function cached() {
    var raw = readStore(STORE_KEY);
    if (!raw) return null;
    try {
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.at || Date.now() - parsed.at > TTL_MS) return null;
      return parsed.location || null;
    } catch (e) {
      return null;
    }
  }

  function remember(location) {
    if (!location) return;
    writeStore(STORE_KEY, JSON.stringify({ at: Date.now(), location: location }));
  }

  /** Fill the hidden/visible location inputs on the lead form. */
  function applyToForm(location) {
    if (!location) return;
    var set = function (sel, val) {
      document.querySelectorAll(sel).forEach(function (el) {
        // Never overwrite something the visitor typed themselves.
        if (el.dataset.touched === '1') return;
        if (val !== null && val !== undefined) el.value = val;
      });
    };
    set('[data-loc-city]', location.city || '');
    set('[data-loc-state]', location.state || '');
    set('[data-loc-country]', location.country || '');
    set('[data-loc-src]', location.source || '');
    if (location.latitude != null) set('[data-loc-lat]', location.latitude);
    if (location.longitude != null) set('[data-loc-lon]', location.longitude);

    var cityInput = document.querySelector('[data-loc-city]');
    if (cityInput && !cityInput.value) cityInput.placeholder = 'Your city';
  }

  /** Swap {{city}} / {{state}} tokens in any element carrying data-loc-text. */
  function applyToCopy(location) {
    if (!location || !location.city) return;

    document.querySelectorAll('[data-loc-text]').forEach(function (el) {
      var tpl = el.getAttribute('data-loc-text');
      if (!tpl || tpl.indexOf('{{') === -1) return;
      var text = tpl
        .replace(/\{\{\s*city\s*\}\}/gi, location.city || '')
        .replace(/\{\{\s*state\s*\}\}/gi, location.state || '')
        .replace(/\{\{\s*country\s*\}\}/gi, location.country || '');

      // Keep any leading icon; replace only the text node after it.
      var icon = el.querySelector('i');
      el.textContent = ' ' + text.trim();
      if (icon) el.insertBefore(icon, el.firstChild);
    });

    var shortLoc = document.querySelector('[data-loc-short]');
    if (shortLoc && location.city) {
      shortLoc.textContent = location.city + (location.state && location.state !== location.city ? ', ' + location.state : '');
    }
  }

  function apply(location) {
    applyToForm(location);
    applyToCopy(location);
    window.__visitorLocation = location;
    document.dispatchEvent(new CustomEvent('visitor-location', { detail: location }));
  }

  function resolveOnServer(params) {
    return fetch('/api/geo/resolve' + params, { credentials: 'same-origin' })
      .then(function (r) {
        return r.ok ? r.json() : { location: null };
      })
      .then(function (data) {
        return data && data.location ? data.location : null;
      })
      .catch(function () {
        return null; // location is optional — never surface an error
      });
  }

  function ipFallback() {
    return resolveOnServer('').then(function (location) {
      if (location) {
        remember(location);
        apply(location);
      }
    });
  }

  function start() {
    // 1. Anything we already know.
    var known = cached();
    if (known) {
      apply(known);
      return;
    }

    // 2. Browser geolocation — asked at most once per visitor.
    var alreadyAsked = readStore(ASKED_KEY) === '1';
    if (!alreadyAsked && navigator.geolocation && window.isSecureContext) {
      writeStore(ASKED_KEY, '1');
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          var lat = pos.coords.latitude;
          var lon = pos.coords.longitude;
          resolveOnServer('?lat=' + encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lon)).then(
            function (location) {
              if (location) {
                location.latitude = lat;
                location.longitude = lon;
                remember(location);
                apply(location);
              } else {
                ipFallback();
              }
            }
          );
        },
        function () {
          // Denied, unavailable or timed out — fall back silently.
          ipFallback();
        },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 10 * 60 * 1000 }
      );
      return;
    }

    // 3. Permission previously denied, or no geolocation available.
    ipFallback();
  }

  // Mark fields the visitor edits so detection never overwrites their input.
  document.addEventListener(
    'input',
    function (e) {
      var el = e.target;
      if (el && el.matches && el.matches('[data-loc-city],[data-loc-area]')) {
        el.dataset.touched = '1';
      }
    },
    true
  );

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
