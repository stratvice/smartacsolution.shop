'use strict';
/**
 * Server-side geolocation helpers.
 *
 * Both providers are keyless and are called from the server (never the
 * browser) so no third-party key or client IP handling leaks into the page.
 * Every function degrades to null rather than throwing — location is a
 * personalisation nicety and must never block a page load or a lead.
 */
const env = require('../config/env');
const { fetchWithTimeout } = require('./http');

// Small in-process LRU-ish cache; keeps us well inside provider rate limits.
const cache = new Map();
const MAX_CACHE = 500;
const TTL = env.geo.cacheTtlMin * 60 * 1000;

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > TTL) {
    cache.delete(key);
    return undefined;
  }
  return hit.value;
}
function cacheSet(key, value) {
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), value });
}

function normalise(city, state, country, source, lat, lon) {
  if (!city && !state && !country) return null;
  return {
    city: city || null,
    state: state || null,
    country: country || null,
    source,
    latitude: typeof lat === 'number' ? lat : null,
    longitude: typeof lon === 'number' ? lon : null,
  };
}

/** Reverse geocode GPS coordinates via OpenStreetMap Nominatim. */
async function reverseGeocode(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  const key = `rg:${lat.toFixed(3)},${lon.toFixed(3)}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  try {
    const url = `${env.geo.nominatimUrl}?format=jsonv2&lat=${lat}&lon=${lon}&zoom=10&addressdetails=1`;
    const res = await fetchWithTimeout(
      url,
      { headers: { 'User-Agent': env.geo.nominatimUserAgent, Accept: 'application/json' } },
      6000
    );
    if (!res.ok) throw new Error(`nominatim ${res.status}`);
    const data = await res.json();
    const a = data.address || {};
    const city =
      a.city || a.town || a.village || a.municipality || a.county || a.state_district || null;
    const value = normalise(city, a.state || null, a.country || null, 'gps', lat, lon);
    cacheSet(key, value);
    return value;
  } catch (err) {
    console.warn('[geo] reverse geocode failed:', err.message);
    cacheSet(key, null);
    return null;
  }
}

/** Extract the caller's public IP, honouring a trusted proxy header. */
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  const ip = (Array.isArray(fwd) ? fwd[0] : (fwd || '').split(',')[0].trim()) || req.ip || '';
  return ip.replace(/^::ffff:/, '');
}

function isPrivateIp(ip) {
  if (!ip) return true;
  if (ip === '::1' || ip === '127.0.0.1') return true;
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|fc|fd)/i.test(ip);
}

/** IP-based fallback when the browser denies or cannot provide geolocation. */
async function lookupByIp(ip) {
  // A private/loopback IP (local dev) has no meaningful geolocation.
  if (isPrivateIp(ip)) return null;

  const key = `ip:${ip}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  try {
    const res = await fetchWithTimeout(`${env.geo.ipGeoUrl}/${encodeURIComponent(ip)}`, {
      headers: { Accept: 'application/json' },
    }, 5000);
    if (!res.ok) throw new Error(`ipwho ${res.status}`);
    const data = await res.json();
    if (data && data.success === false) throw new Error(data.message || 'ip lookup failed');
    const value = normalise(
      data.city,
      data.region,
      data.country,
      'ip',
      typeof data.latitude === 'number' ? data.latitude : null,
      typeof data.longitude === 'number' ? data.longitude : null
    );
    cacheSet(key, value);
    return value;
  } catch (err) {
    console.warn('[geo] ip lookup failed:', err.message);
    cacheSet(key, null);
    return null;
  }
}

module.exports = { reverseGeocode, lookupByIp, clientIp, isPrivateIp };
