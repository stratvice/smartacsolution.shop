'use strict';
/**
 * Public site: the landing page, sitemap.xml and robots.txt.
 * Everything rendered here comes from the database.
 */
const express = require('express');
const env = require('../config/env');
const prisma = require('../lib/prisma');
const { asyncHandler } = require('../lib/http');
const { getContent } = require('../services/content');
const geo = require('../lib/geo');
const fmt = require('../lib/format');

const router = express.Router();

/**
 * Server-side location for the *first* paint. The browser may refine this
 * later via the geolocation API (see public/js/geo.js). Never throws.
 */
async function initialLocation(req, settings) {
  const defaults = {
    city: settings.default_city || '',
    state: settings.default_state || '',
    country: settings.default_country || 'India',
  };

  // A location the browser already resolved and stored is echoed back to us
  // in a cookie, so a returning visitor gets personalised copy immediately.
  const cookie = req.cookies && req.cookies.visitor_loc;
  if (cookie) {
    try {
      const parsed = JSON.parse(cookie);
      if (parsed && (parsed.city || parsed.state)) {
        return {
          city: parsed.city || null,
          state: parsed.state || null,
          country: parsed.country || null,
          source: parsed.source || 'cookie',
          defaults,
        };
      }
    } catch {
      /* malformed cookie — fall through to the IP lookup */
    }
  }

  // No IP lookup here, deliberately. The displayed location comes only from a
  // location the visitor explicitly granted (remembered in the cookie above);
  // otherwise the page shows the configured defaults.
  //
  // IP geolocation guesses the visitor's own city, which is the wrong question
  // for a business that serves one area: a browser in Uttar Pradesh was being
  // shown "#1 Appliance Repair in Dadri" on a Goa service. Falling back to the
  // configured city is both accurate and better for conversion.
  //
  // IP lookup is still used when a lead is submitted (routes/api.public.js) to
  // enrich the record, where a best guess beats storing nothing.
  return { city: null, state: null, country: null, source: null, defaults };
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const content = await getContent();
    const location = await initialLocation(req, content.settings);

    res.render('index', {
      ...content,
      location,
      appUrl: env.appUrl,
      utm: {
        source: req.query.utm_source || '',
        medium: req.query.utm_medium || '',
        campaign: req.query.utm_campaign || '',
      },
      fmt,
    });
  })
);

router.get(
  '/robots.txt',
  asyncHandler(async (_req, res) => {
    const { settings } = await getContent();
    const robots = settings.seo_robots || 'index, follow';
    const disallowAll = /noindex/i.test(robots);
    res.type('text/plain').send(
      [
        'User-agent: *',
        disallowAll ? 'Disallow: /' : 'Disallow: /admin',
        disallowAll ? '' : 'Disallow: /api/admin',
        '',
        `Sitemap: ${env.appUrl.replace(/\/$/, '')}/sitemap.xml`,
        '',
      ].join('\n')
    );
  })
);

router.get(
  '/sitemap.xml',
  asyncHandler(async (_req, res) => {
    const { settings, services } = await getContent();
    const base = (settings.seo_canonical_url || env.appUrl).replace(/\/$/, '');
    const latest = await prisma.service.findFirst({ orderBy: { updatedAt: 'desc' } });
    const lastmod = (latest ? latest.updatedAt : new Date()).toISOString().slice(0, 10);

    const urls = [
      { loc: base + '/', priority: '1.0', changefreq: 'weekly' },
      ...services.map((s) => ({
        loc: `${base}/#services`,
        priority: '0.8',
        changefreq: 'monthly',
        _slug: s.slug,
      })),
    ];
    // De-duplicate the anchor URLs — one entry per distinct loc.
    const seen = new Set();
    const unique = urls.filter((u) => (seen.has(u.loc) ? false : seen.add(u.loc)));

    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      unique
        .map(
          (u) =>
            `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n` +
            `    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`
        )
        .join('\n') +
      '\n</urlset>\n';

    res.type('application/xml').send(xml);
  })
);

module.exports = router;
