'use strict';
/**
 * Public API — exposes only what the landing page needs. No admin data,
 * no internal fields, and every write is rate-limited and validated.
 */
const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const geo = require('../lib/geo');
const { asyncHandler, HttpError } = require('../lib/http');
const { validate } = require('../middleware/validate');
const { leadLimiter, geoLimiter } = require('../middleware/rateLimit');
const { getContent } = require('../services/content');
const { notifyNewLeadInBackground } = require('../services/leadNotifier');

const router = express.Router();

// ----------------------------------------------------------------- schemas

const trimmed = (max) => z.string().trim().max(max);

const leadSchema = z.object({
  name: trimmed(120).min(2, 'Please enter your name.'),
  phone: trimmed(25)
    .min(7, 'Please enter a valid phone number.')
    .regex(/^[+\d][\d\s\-().]{6,}$/, 'Please enter a valid phone number.'),
  email: z.union([z.string().trim().email('Please enter a valid email.'), z.literal('')]).optional(),
  service: trimmed(120).optional().or(z.literal('')),
  message: trimmed(2000).optional().or(z.literal('')),
  area: trimmed(120).optional().or(z.literal('')),
  city: trimmed(120).optional().or(z.literal('')),
  state: trimmed(120).optional().or(z.literal('')),
  country: trimmed(120).optional().or(z.literal('')),
  latitude: z.coerce.number().min(-90).max(90).optional().nullable(),
  longitude: z.coerce.number().min(-180).max(180).optional().nullable(),
  locationSrc: z.enum(['gps', 'ip', 'manual']).optional().nullable(),
  utmSource: trimmed(120).optional().or(z.literal('')),
  utmMedium: trimmed(120).optional().or(z.literal('')),
  utmCampaign: trimmed(120).optional().or(z.literal('')),
  pageUrl: trimmed(500).optional().or(z.literal('')),
  // Honeypot: a real user never fills this hidden field. Deliberately
  // permissive here so a bot gets a normal-looking 201 (handled below)
  // instead of a validation error that tells it what tripped the trap.
  website: z.string().max(200).optional().or(z.literal('')),
});

const reverseSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
});

const blank = (v) => (v === undefined || v === null || v === '' ? null : v);

// ------------------------------------------------------------------ routes

/**
 * Resolve a visitor's location.
 * With lat/lon -> reverse geocode. Without -> IP fallback.
 * Always 200: a failure returns { location: null } so the page carries on.
 */
router.get(
  '/geo/resolve',
  geoLimiter,
  asyncHandler(async (req, res) => {
    const parsed = reverseSchema.safeParse(req.query);

    let location = null;
    if (parsed.success) {
      location = await geo.reverseGeocode(parsed.data.lat, parsed.data.lon);
    }
    if (!location) {
      location = await geo.lookupByIp(geo.clientIp(req));
    }

    if (location) {
      // Remember it so the next server-rendered paint is already personalised.
      res.cookie('visitor_loc', JSON.stringify(location), {
        httpOnly: false,
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000,
        path: '/',
      });
    }
    res.json({ location });
  })
);

/** Submit an enquiry. Location is attached when known, skipped when not. */
router.post(
  '/leads',
  leadLimiter,
  validate(leadSchema),
  asyncHandler(async (req, res) => {
    const b = req.body;

    // Silently accept-and-drop obvious bots so they don't retry.
    if (b.website) return res.status(201).json({ ok: true, id: null });

    // Server-side location backfill: if the browser sent coordinates but no
    // city, resolve it here; otherwise fall back to IP. Never blocks the save.
    let city = blank(b.city);
    let state = blank(b.state);
    let country = blank(b.country);
    let locationSrc = blank(b.locationSrc);

    if (!city && Number.isFinite(b.latitude) && Number.isFinite(b.longitude)) {
      const resolved = await geo.reverseGeocode(b.latitude, b.longitude);
      if (resolved) {
        city = resolved.city;
        state = resolved.state;
        country = resolved.country;
        locationSrc = 'gps';
      }
    }
    if (!city) {
      const byIp = await geo.lookupByIp(geo.clientIp(req));
      if (byIp) {
        city = byIp.city;
        state = byIp.state;
        country = byIp.country;
        locationSrc = 'ip';
      }
    }

    // The free-text "Your Area" field is useful context; keep it on the message.
    const message = [blank(b.message), b.area ? `Area: ${b.area}` : null]
      .filter(Boolean)
      .join('\n\n');

    const lead = await prisma.lead.create({
      data: {
        name: b.name,
        phone: b.phone,
        email: blank(b.email),
        service: blank(b.service),
        message: blank(message),
        city,
        state,
        country,
        latitude: Number.isFinite(b.latitude) ? b.latitude : null,
        longitude: Number.isFinite(b.longitude) ? b.longitude : null,
        locationSrc,
        source: 'website',
        utmSource: blank(b.utmSource),
        utmMedium: blank(b.utmMedium),
        utmCampaign: blank(b.utmCampaign),
        pageUrl: blank(b.pageUrl),
        ipAddress: geo.clientIp(req) || null,
        userAgent: (req.headers['user-agent'] || '').slice(0, 500) || null,
        status: 'NEW',
      },
    });

    console.log(
      `[lead] saved lead #${lead.id} — ${lead.name} / ${lead.phone}${lead.city ? ` / ${lead.city}` : ''}`
    );

    const { sections } = await getContent();
    const successMessage =
      (sections.contact && sections.contact.successMessage) ||
      "Thank you! We've received your request and will call you back shortly.";

    // The visitor is told the enquiry succeeded as soon as it is stored.
    res.status(201).json({ ok: true, id: lead.id, message: successMessage });

    // Only then do we attempt the email, off the request's critical path. A
    // failure is logged and recorded on the lead — it never loses the lead and
    // never changes what the visitor already saw.
    notifyNewLeadInBackground(lead);
  })
);

/** Public, read-only content endpoints (handy for any future front end). */
router.get(
  '/services',
  asyncHandler(async (_req, res) => {
    const { services } = await getContent();
    res.json(
      services.map((s) => ({
        id: s.id,
        title: s.title,
        slug: s.slug,
        description: s.description,
        badge: s.badge,
        icon: s.icon,
        imageUrl: s.imageUrl,
        imageAlt: s.imageAlt,
        buttonText: s.buttonText,
        buttonLink: s.buttonLink,
      }))
    );
  })
);

router.get(
  '/testimonials',
  asyncHandler(async (_req, res) => {
    const { testimonials } = await getContent();
    res.json(
      testimonials.map((t) => ({
        id: t.id,
        name: t.name,
        location: t.location,
        review: t.review,
        rating: t.rating,
        imageUrl: t.imageUrl,
      }))
    );
  })
);

router.get(
  '/faqs',
  asyncHandler(async (_req, res) => {
    const { faqs } = await getContent();
    res.json(faqs.map((f) => ({ id: f.id, question: f.question, answer: f.answer })));
  })
);

/** Public subset of site settings — contact/CTA only, never SEO internals. */
router.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    const { settings } = await getContent();
    const PUBLIC_KEYS = [
      'company_name',
      'phone',
      'whatsapp',
      'email',
      'address',
      'working_hours',
      'maps_url',
      'primary_cta_text',
      'primary_cta_link',
      'secondary_cta_text',
      'secondary_cta_link',
    ];
    const out = {};
    for (const k of PUBLIC_KEYS) if (settings[k] !== undefined) out[k] = settings[k];
    res.json(out);
  })
);

router.all('/{*splat}', (_req, _res, next) => next(new HttpError(404, 'Not found.')));

module.exports = router;
