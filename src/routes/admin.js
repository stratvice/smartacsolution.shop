'use strict';
/**
 * Admin panel pages (server-rendered EJS) plus the login/logout handlers.
 * Data mutations all go through /api/admin/* — these routes only read.
 */
const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const auth = require('../lib/auth');
const storage = require('../lib/storage');
const mailer = require('../lib/mailer');
const { asyncHandler } = require('../lib/http');
const { requireAdminPage } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rateLimit');
const { validate } = require('../middleware/validate');
const { getSettings } = require('../services/content');
const notifier = require('../services/leadNotifier');
const { leadWhere, leadQuerySchema, STATUSES } = require('./api.admin');

const router = express.Router();

// Brand name for every admin view. Read here rather than threaded through each
// render() call, because the login page renders from several places and before
// any session exists. Falls back if the database is unreachable, so a DB outage
// still shows a usable login screen rather than a template error.
router.use(async (_req, res, next) => {
  try {
    const { map } = await getSettings();
    res.locals.company = map.company_name || 'Smart ac solution Goa';
  } catch {
    res.locals.company = 'Smart ac solution Goa';
  }
  next();
});

const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your email or username.').max(160),
  password: z.string().min(1, 'Enter your password.').max(200),
  next: z.string().trim().max(300).optional().or(z.literal('')),
});

/** Only allow same-site relative redirects after login. */
function safeNext(next) {
  if (!next || typeof next !== 'string') return '/admin/dashboard';
  if (!next.startsWith('/') || next.startsWith('//')) return '/admin/dashboard';
  return next;
}

// ------------------------------------------------------------------- login

router.get('/login', (req, res) => {
  if (req.admin) return res.redirect('/admin/dashboard');
  res.render('admin/login', {
    title: 'Sign in',
    error: null,
    values: {},
    next: typeof req.query.next === 'string' ? req.query.next : '',
  });
});

router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).render('admin/login', {
        title: 'Sign in',
        error: parsed.error.issues[0].message,
        values: { identifier: req.body.identifier || '' },
        next: req.body.next || '',
      });
    }
    const { identifier, password } = parsed.data;
    const id = identifier.toLowerCase();

    const admin = await prisma.admin.findFirst({
      where: { OR: [{ email: id }, { username: id }] },
    });

    // Same message and comparable timing whether the user exists or not.
    const ok = admin && admin.isActive && (await auth.verifyPassword(password, admin.passwordHash));
    if (!ok) {
      if (!admin) await auth.hashPassword(password); // equalise response time
      return res.status(401).render('admin/login', {
        title: 'Sign in',
        error: 'Invalid credentials.',
        values: { identifier },
        next: parsed.data.next || '',
      });
    }

    await prisma.admin.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
    auth.setAuthCookie(res, auth.signToken(admin));
    res.redirect(safeNext(parsed.data.next));
  })
);

router.post('/logout', (req, res) => {
  auth.clearAuthCookie(res);
  res.redirect('/admin/login');
});
router.get('/logout', (req, res) => {
  auth.clearAuthCookie(res);
  res.redirect('/admin/login');
});

// ------------------------------------------------- everything below is gated

router.use(requireAdminPage);

router.get('/', (_req, res) => res.redirect('/admin/dashboard'));

router.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const [total, byStatus, servicesCount, recent, testimonials, faqs, media] = await Promise.all([
      prisma.lead.count(),
      prisma.lead.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.service.count(),
      prisma.lead.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
      prisma.testimonial.count(),
      prisma.faq.count(),
      prisma.media.count(),
    ]);
    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const row of byStatus) counts[row.status] = row._count._all;

    // Daily volume for the last 14 days, zero-filled so the chart keeps an
    // even axis on quiet days rather than collapsing the gaps.
    const DAYS = 14;
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - (DAYS - 1));

    const rows = await prisma.$queryRawUnsafe(
      'SELECT DATE(createdAt) AS d, COUNT(*) AS n FROM leads WHERE createdAt >= ? GROUP BY DATE(createdAt) ORDER BY d',
      since
    );
    const byDay = new Map(
      rows.map((r) => [
        r.d instanceof Date ? r.d.toISOString().slice(0, 10) : String(r.d).slice(0, 10),
        Number(r.n),
      ])
    );
    const daily = [];
    for (let i = 0; i < DAYS; i++) {
      const day = new Date(since);
      day.setDate(since.getDate() + i);
      const key = day.toISOString().slice(0, 10);
      daily.push({ date: key, label: day.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), count: byDay.get(key) || 0 });
    }

    // Last 7 days against the 7 before it, for the trend arrow.
    const thisWeek = daily.slice(7).reduce((a, d) => a + d.count, 0);
    const lastWeek = daily.slice(0, 7).reduce((a, d) => a + d.count, 0);

    res.render('admin/dashboard', {
      title: 'Dashboard',
      active: 'dashboard',
      total,
      counts,
      servicesCount,
      testimonials,
      faqs,
      media,
      recent,
      STATUSES,
      daily,
      thisWeek,
      lastWeek,
    });
  })
);

router.get(
  '/leads',
  asyncHandler(async (req, res) => {
    const parsed = leadQuerySchema.safeParse(req.query);
    const f = parsed.success
      ? parsed.data
      : { page: 1, perPage: 25, sort: 'createdAt', dir: 'desc' };

    const where = leadWhere(f);
    const [total, leads, serviceRows, cityRows] = await Promise.all([
      prisma.lead.count({ where }),
      prisma.lead.findMany({
        where,
        orderBy: { [f.sort]: f.dir },
        skip: (f.page - 1) * f.perPage,
        take: f.perPage,
      }),
      // Distinct values drive the filter dropdowns.
      prisma.lead.findMany({
        where: { service: { not: null } },
        distinct: ['service'],
        select: { service: true },
        take: 100,
      }),
      prisma.lead.findMany({
        where: { city: { not: null } },
        distinct: ['city'],
        select: { city: true },
        take: 200,
      }),
    ]);

    res.render('admin/leads', {
      title: 'Leads',
      active: 'leads',
      leads,
      total,
      filters: f,
      query: req.query,
      STATUSES,
      serviceOptions: serviceRows.map((r) => r.service).filter(Boolean).sort(),
      cityOptions: cityRows.map((r) => r.city).filter(Boolean).sort(),
      pages: Math.max(1, Math.ceil(total / f.perPage)),
    });
  })
);

router.get(
  '/landing-page',
  asyncHandler(async (req, res) => {
    const [sections, media] = await Promise.all([
      prisma.pageSection.findMany({ orderBy: { order: 'asc' } }),
      prisma.media.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }),
    ]);
    const byKey = Object.fromEntries(sections.map((s) => [s.key, s]));
    res.render('admin/landing-page', {
      title: 'Landing Page',
      active: 'landing-page',
      sections,
      byKey,
      media,
    });
  })
);

router.get(
  '/services',
  asyncHandler(async (_req, res) => {
    const [services, media] = await Promise.all([
      prisma.service.findMany({ orderBy: [{ order: 'asc' }, { id: 'asc' }] }),
      prisma.media.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }),
    ]);
    res.render('admin/services', { title: 'Services', active: 'services', services, media });
  })
);

router.get(
  '/testimonials',
  asyncHandler(async (_req, res) => {
    const [testimonials, media] = await Promise.all([
      prisma.testimonial.findMany({ orderBy: [{ order: 'asc' }, { id: 'asc' }] }),
      prisma.media.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }),
    ]);
    res.render('admin/testimonials', {
      title: 'Testimonials',
      active: 'testimonials',
      testimonials,
      media,
    });
  })
);

router.get(
  '/faqs',
  asyncHandler(async (_req, res) => {
    const faqs = await prisma.faq.findMany({ orderBy: [{ order: 'asc' }, { id: 'asc' }] });
    res.render('admin/faqs', { title: 'FAQs', active: 'faqs', faqs });
  })
);

router.get(
  '/media',
  asyncHandler(async (_req, res) => {
    const media = await prisma.media.findMany({ orderBy: { createdAt: 'desc' } });
    res.render('admin/media', {
      title: 'Media',
      active: 'media',
      media,
      driver: storage.activeDriver(),
      cloudReady: storage.cloudinaryConfigured(),
    });
  })
);

router.get(
  '/settings',
  asyncHandler(async (req, res) => {
    const { rows, map } = await getSettings();
    const media = await prisma.media.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
    const groups = {};
    for (const row of rows) (groups[row.group] = groups[row.group] || []).push(row);

    // The notification group gets its own purpose-built card (toggle + repeater)
    // rather than the generic key/value fields, so hide it from the generic list.
    delete groups.notifications;

    res.render('admin/settings', {
      title: 'Settings',
      active: 'settings',
      groups,
      media,
      admin: req.admin,
      notify: {
        enabled: ['true', '1', 'on', 'yes'].includes(
          String(map[notifier.ENABLED_KEY] || '').trim().toLowerCase()
        ),
        recipients: notifier.parseRecipients(map[notifier.RECIPIENTS_KEY]).valid,
        // Booleans and a message only — the API key never reaches a template.
        transportReady: mailer.isConfigured(),
        transportProblem: mailer.configProblem(),
        enabledKey: notifier.ENABLED_KEY,
        recipientsKey: notifier.RECIPIENTS_KEY,
        maxRecipients: notifier.MAX_RECIPIENTS,
      },
    });
  })
);

module.exports = router;
