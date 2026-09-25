'use strict';

/** Digits-only phone, suitable for tel: and wa.me links. */
function phoneDigits(phone) {
  return String(phone || '').replace(/[^\d+]/g, '').replace(/^\+?/, '');
}

function telLink(phone) {
  const raw = String(phone || '').replace(/[^\d+]/g, '');
  return raw ? `tel:${raw}` : '#';
}

function waLink(phone, text) {
  const digits = phoneDigits(phone);
  if (!digits) return '#';
  const q = text ? `?text=${encodeURIComponent(text)}` : '';
  return `https://wa.me/${digits}${q}`;
}

/**
 * A map link for a lead.
 *
 * Coordinates give an exact pin, which only exists when the visitor granted
 * location or pressed Detect. Without them, search for whatever place name
 * was captured instead: less precise, but still worth a tap when someone is
 * deciding whether a job is nearby. Null when there is nothing to point at.
 *
 * `precise` lets the caller say which of the two it is, so an approximate
 * link is never passed off as the customer's doorstep.
 */
function mapsLink(lead) {
  const lat = Number(lead && lead.latitude);
  const lon = Number(lead && lead.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    return { href: `https://www.google.com/maps?q=${lat},${lon}`, precise: true };
  }

  const place = [lead && lead.city, lead && lead.state, lead && lead.country]
    .filter(Boolean)
    .join(', ');
  if (!place) return null;

  return {
    href: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(place),
    precise: false,
  };
}

/**
 * Interpolate {{city}} / {{state}} / {{country}} tokens so admins can write
 * location-aware copy such as "AC Repair Services in {{city}}".
 * Unknown location falls back to the configured default city.
 */
function personalise(text, location, defaults = {}) {
  if (!text || typeof text !== 'string') return text || '';
  const city = (location && location.city) || defaults.city || '';
  const state = (location && location.state) || defaults.state || '';
  const country = (location && location.country) || defaults.country || 'India';
  return text
    .replace(/\{\{\s*city\s*\}\}/gi, city)
    .replace(/\{\{\s*state\s*\}\}/gi, state)
    .replace(/\{\{\s*country\s*\}\}/gi, country)
    // Anything still in braces is a typo or a token that was never supported.
    // Printing it puts "{{highlight}}" in a heading on a live page, which is
    // worse than dropping it, so drop it.
    .replace(/\{\{[^}]*\}\}/g, '')
    // Tidy the leftovers when nothing resolved, e.g. "Services in " -> "Services".
    .replace(/\s+in\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Render a 0-5 rating as Font Awesome stars, matching the original markup. */
function starIcons(rating) {
  const r = Math.max(0, Math.min(5, Number(rating) || 0));
  const full = Math.floor(r);
  const half = r - full >= 0.25 && r - full < 0.75;
  const bonus = r - full >= 0.75 ? 1 : 0;
  let out = '';
  for (let i = 0; i < full + bonus; i++) out += '<i class="fa fa-star"></i>';
  if (half) out += '<i class="fa fa-star-half-alt"></i>';
  const rest = 5 - full - bonus - (half ? 1 : 0);
  for (let i = 0; i < rest; i++) out += '<i class="far fa-star"></i>';
  return out;
}

function initial(name) {
  return String(name || '?').trim().charAt(0).toUpperCase() || '?';
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || `item-${Date.now()}`;
}

module.exports = { telLink, waLink, phoneDigits, mapsLink, personalise, starIcons, initial, slugify };
