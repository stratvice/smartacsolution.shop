'use strict';
/**
 * Admin API. Every route below sits behind requireAdminApi (applied in
 * server.js) except /auth/login and /auth/logout.
 */
const express = require('express');
const multer = require('multer');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const env = require('../config/env');
const storage = require('../lib/storage');
const { asyncHandler, HttpError } = require('../lib/http');
const { validate } = require('../middleware/validate');
const { requireAdminApi } = require('../middleware/auth');
const { adminApiLimiter, testEmailLimiter } = require('../middleware/rateLimit');
const notifier = require('../services/leadNotifier');
const content = require('../services/content');
const { slugify } = require('../lib/format');
const auth = require('../lib/auth');

const router = express.Router();

const STATUSES = ['NEW', 'CONTACTED', 'INTERESTED', 'CONVERTED', 'CLOSED'];

// Any successful write drops the public-page cache so the site is live at once.
function live(res, payload) {
  content.invalidate();
  return res.json(payload);
}

// ------------------------------------------------------------------- leads

const leadQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(['', ...STATUSES]).optional(),
  service: z.string().trim().max(120).optional(),
  city: z.string().trim().max(120).optional(),
  from: z.string().trim().max(30).optional(),
  to: z.string().trim().max(30).optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(25),
  sort: z.enum(['createdAt', 'updatedAt', 'name', 'status']).default('createdAt'),
  dir: z.enum(['asc', 'desc']).default('desc'),
});

/** Turn validated filters into a Prisma where clause. Exported for the pages. */
function leadWhere(f) {
  const where = {};
  if (f.q) {
    where.OR = [
      { name: { contains: f.q, mode: 'insensitive' } },
      { phone: { contains: f.q } },
      { email: { contains: f.q, mode: 'insensitive' } },
      { message: { contains: f.q, mode: 'insensitive' } },
      { city: { contains: f.q, mode: 'insensitive' } },
    ];
  }
  if (f.status) where.status = f.status;
  if (f.service) where.service = { contains: f.service, mode: 'insensitive' };
  if (f.city) where.city = { contains: f.city, mode: 'insensitive' };
  if (f.from || f.to) {
    where.createdAt = {};
    if (f.from) {
      const d = new Date(f.from);
      if (!Number.isNaN(d.getTime())) where.createdAt.gte = d;
    }
    if (f.to) {
      const d = new Date(f.to);
      if (!Number.isNaN(d.getTime())) {
        d.setHours(23, 59, 59, 999); // make "to" inclusive of the whole day
        where.createdAt.lte = d;
      }
    }
    if (!Object.keys(where.createdAt).length) delete where.createdAt;
  }
  return where;
}

router.get(
  '/leads',
  validate(leadQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const f = req.validatedQuery;
    const where = leadWhere(f);
    const [total, leads] = await Promise.all([
      prisma.lead.count({ where }),
      prisma.lead.findMany({
        where,
        orderBy: { [f.sort]: f.dir },
        skip: (f.page - 1) * f.perPage,
        take: f.perPage,
      }),
    ]);
    res.json({ total, page: f.page, perPage: f.perPage, leads });
  })
);

router.get(
  '/leads/export',
  validate(leadQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const leads = await prisma.lead.findMany({
      where: leadWhere(req.validatedQuery),
      orderBy: { createdAt: 'desc' },
      take: 10000,
    });

    const columns = [
      'id', 'name', 'phone', 'email', 'service', 'message', 'city', 'state',
      'country', 'source', 'utmSource', 'utmMedium', 'utmCampaign', 'status',
      'notes', 'createdAt', 'updatedAt',
    ];
    // Prefix formula-triggering characters so a cell can't execute in Excel.
    const cell = (v) => {
      if (v === null || v === undefined) return '';
      let s = v instanceof Date ? v.toISOString() : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    };

    const csv =
      columns.join(',') +
      '\n' +
      leads.map((l) => columns.map((c) => cell(l[c])).join(',')).join('\n') +
      '\n';

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leads-${stamp}.csv"`);
    res.send('﻿' + csv); // BOM so Excel reads UTF-8 correctly
  })
);

router.get(
  '/leads/:id',
  asyncHandler(async (req, res) => {
    const lead = await prisma.lead.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        leadNotes: {
          orderBy: { createdAt: 'desc' },
          include: { admin: { select: { username: true, name: true } } },
        },
      },
    });
    if (!lead) throw new HttpError(404, 'Lead not found.');
    res.json(lead);
  })
);

router.patch(
  '/leads/:id',
  validate(
    z.object({
      status: z.enum(STATUSES).optional(),
      notes: z.string().trim().max(5000).optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const data = {};
    if (req.body.status) data.status = req.body.status;
    if (req.body.notes !== undefined) data.notes = req.body.notes || null;
    if (!Object.keys(data).length) throw new HttpError(422, 'Nothing to update.');

    const lead = await prisma.lead
      .update({ where: { id }, data })
      .catch(() => { throw new HttpError(404, 'Lead not found.'); });
    res.json(lead);
  })
);

router.post(
  '/leads/:id/notes',
  validate(z.object({ body: z.string().trim().min(1, 'Note cannot be empty.').max(5000) })),
  asyncHandler(async (req, res) => {
    const leadId = Number(req.params.id);
    const exists = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true } });
    if (!exists) throw new HttpError(404, 'Lead not found.');

    const note = await prisma.leadNote.create({
      data: { leadId, adminId: req.admin.id, body: req.body.body },
      include: { admin: { select: { username: true, name: true } } },
    });
    await prisma.lead.update({ where: { id: leadId }, data: { updatedAt: new Date() } });
    res.status(201).json(note);
  })
);

router.delete(
  '/leads/:id',
  asyncHandler(async (req, res) => {
    await prisma.lead
      .delete({ where: { id: Number(req.params.id) } })
      .catch(() => { throw new HttpError(404, 'Lead not found.'); });
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------- sections

router.get(
  '/sections',
  asyncHandler(async (_req, res) => {
    res.json(await prisma.pageSection.findMany({ orderBy: { order: 'asc' } }));
  })
);

router.put(
  '/sections/:key',
  validate(z.object({ content: z.any(), isActive: z.boolean().optional() })),
  asyncHandler(async (req, res) => {
    const key = req.params.key;
    const existing = await prisma.pageSection.findUnique({ where: { key } });
    if (!existing) throw new HttpError(404, 'Section not found.');

    const section = await prisma.pageSection.update({
      where: { key },
      data: {
        content: req.body.content ?? existing.content,
        isActive: req.body.isActive ?? existing.isActive,
      },
    });
    live(res, section);
  })
);

// ---------------------------------------------------------------- services

const serviceSchema = z.object({
  title: z.string().trim().min(2).max(160),
  slug: z.string().trim().max(80).optional().or(z.literal('')),
  description: z.string().trim().min(2).max(4000),
  badge: z.string().trim().max(60).optional().or(z.literal('')),
  icon: z.string().trim().max(80).optional().or(z.literal('')),
  iconStyle: z.string().trim().max(300).optional().or(z.literal('')),
  imageUrl: z.string().trim().max(600).optional().or(z.literal('')),
  imageAlt: z.string().trim().max(200).optional().or(z.literal('')),
  buttonText: z.string().trim().max(60).optional().or(z.literal('')),
  buttonLink: z.string().trim().max(600).optional().or(z.literal('')),
  buttonIcon: z.string().trim().max(80).optional().or(z.literal('')),
  order: z.coerce.number().int().min(0).max(9999).optional(),
  isActive: z.coerce.boolean().optional(),
});

router.get(
  '/services',
  asyncHandler(async (_req, res) => {
    res.json(await prisma.service.findMany({ orderBy: [{ order: 'asc' }, { id: 'asc' }] }));
  })
);

router.post(
  '/services',
  validate(serviceSchema),
  asyncHandler(async (req, res) => {
    const b = req.body;
    let slug = slugify(b.slug || b.title);
    // Slugs are unique; suffix on collision rather than failing the save.
    if (await prisma.service.findUnique({ where: { slug } })) slug = `${slug}-${Date.now() % 10000}`;

    const service = await prisma.service.create({
      data: {
        title: b.title,
        slug,
        description: b.description,
        badge: b.badge || null,
        icon: b.icon || 'fa fa-snowflake',
        iconStyle: b.iconStyle || null,
        imageUrl: b.imageUrl || null,
        imageAlt: b.imageAlt || null,
        buttonText: b.buttonText || 'Call Now',
        buttonLink: b.buttonLink || '#contact',
        buttonIcon: b.buttonIcon || 'fab fa-whatsapp',
        order: b.order ?? 0,
        isActive: b.isActive ?? true,
      },
    });
    content.invalidate();
    res.status(201).json(service);
  })
);

router.put(
  '/services/:id',
  validate(serviceSchema.partial()),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const b = req.body;
    const data = {};
    for (const k of ['title', 'description', 'icon', 'buttonText', 'buttonLink', 'buttonIcon']) {
      if (b[k] !== undefined && b[k] !== '') data[k] = b[k];
    }
    for (const k of ['badge', 'iconStyle', 'imageUrl', 'imageAlt']) {
      if (b[k] !== undefined) data[k] = b[k] || null;
    }
    if (b.order !== undefined) data.order = b.order;
    if (b.isActive !== undefined) data.isActive = b.isActive;
    if (b.slug) data.slug = slugify(b.slug);

    const service = await prisma.service
      .update({ where: { id }, data })
      .catch(() => { throw new HttpError(404, 'Service not found.'); });
    live(res, service);
  })
);

router.delete(
  '/services/:id',
  asyncHandler(async (req, res) => {
    await prisma.service
      .delete({ where: { id: Number(req.params.id) } })
      .catch(() => { throw new HttpError(404, 'Service not found.'); });
    live(res, { ok: true });
  })
);

// ------------------------------------------------------------ testimonials

const testimonialSchema = z.object({
  name: z.string().trim().min(2).max(120),
  location: z.string().trim().max(160).optional().or(z.literal('')),
  review: z.string().trim().min(2).max(3000),
  rating: z.coerce.number().min(0).max(5).optional(),
  imageUrl: z.string().trim().max(600).optional().or(z.literal('')),
  order: z.coerce.number().int().min(0).max(9999).optional(),
  isActive: z.coerce.boolean().optional(),
});

router.get(
  '/testimonials',
  asyncHandler(async (_req, res) => {
    res.json(await prisma.testimonial.findMany({ orderBy: [{ order: 'asc' }, { id: 'asc' }] }));
  })
);

router.post(
  '/testimonials',
  validate(testimonialSchema),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const row = await prisma.testimonial.create({
      data: {
        name: b.name,
        location: b.location || null,
        review: b.review,
        rating: b.rating ?? 5,
        imageUrl: b.imageUrl || null,
        order: b.order ?? 0,
        isActive: b.isActive ?? true,
      },
    });
    content.invalidate();
    res.status(201).json(row);
  })
);

router.put(
  '/testimonials/:id',
  validate(testimonialSchema.partial()),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const data = {};
    if (b.name) data.name = b.name;
    if (b.review) data.review = b.review;
    if (b.location !== undefined) data.location = b.location || null;
    if (b.imageUrl !== undefined) data.imageUrl = b.imageUrl || null;
    if (b.rating !== undefined) data.rating = b.rating;
    if (b.order !== undefined) data.order = b.order;
    if (b.isActive !== undefined) data.isActive = b.isActive;

    const row = await prisma.testimonial
      .update({ where: { id: Number(req.params.id) }, data })
      .catch(() => { throw new HttpError(404, 'Testimonial not found.'); });
    live(res, row);
  })
);

router.delete(
  '/testimonials/:id',
  asyncHandler(async (req, res) => {
    await prisma.testimonial
      .delete({ where: { id: Number(req.params.id) } })
      .catch(() => { throw new HttpError(404, 'Testimonial not found.'); });
    live(res, { ok: true });
  })
);

// -------------------------------------------------------------------- FAQs

const faqSchema = z.object({
  question: z.string().trim().min(2).max(500),
  answer: z.string().trim().min(2).max(4000),
  order: z.coerce.number().int().min(0).max(9999).optional(),
  isActive: z.coerce.boolean().optional(),
});

router.get(
  '/faqs',
  asyncHandler(async (_req, res) => {
    res.json(await prisma.faq.findMany({ orderBy: [{ order: 'asc' }, { id: 'asc' }] }));
  })
);

router.post(
  '/faqs',
  validate(faqSchema),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const row = await prisma.faq.create({
      data: {
        question: b.question,
        answer: b.answer,
        order: b.order ?? 0,
        isActive: b.isActive ?? true,
      },
    });
    content.invalidate();
    res.status(201).json(row);
  })
);

router.put(
  '/faqs/:id',
  validate(faqSchema.partial()),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const data = {};
    if (b.question) data.question = b.question;
    if (b.answer) data.answer = b.answer;
    if (b.order !== undefined) data.order = b.order;
    if (b.isActive !== undefined) data.isActive = b.isActive;

    const row = await prisma.faq
      .update({ where: { id: Number(req.params.id) }, data })
      .catch(() => { throw new HttpError(404, 'FAQ not found.'); });
    live(res, row);
  })
);

router.delete(
  '/faqs/:id',
  asyncHandler(async (req, res) => {
    await prisma.faq
      .delete({ where: { id: Number(req.params.id) } })
      .catch(() => { throw new HttpError(404, 'FAQ not found.'); });
    live(res, { ok: true });
  })
);

// ------------------------------------------------------------------- media

const path = require('path');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxUploadMb * 1024 * 1024, files: 1 },
  // Cheap pre-filter on the extension only. The client-declared mimetype is
  // not trusted — the real check is a content sniff once the buffer is in
  // memory (see verifyImage), because clients routinely send
  // application/octet-stream for perfectly valid images.
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!storage.EXT_MIME[ext]) {
      return cb(new HttpError(422, `Unsupported file extension: ${ext || '(none)'}`));
    }
    cb(null, true);
  },
});

/** Confirm the bytes really are an image and return the true MIME type. */
function verifyImage(file) {
  const sniff = storage.sniffImage(file.buffer, file.originalname);
  if (!sniff.ok) throw new HttpError(422, sniff.reason);
  file.mimetype = sniff.mime; // store the sniffed type, not the claimed one
  return file;
}

router.get(
  '/media',
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = Math.min(100, Math.max(1, Number(req.query.perPage) || 60));
    const [total, items] = await Promise.all([
      prisma.media.count(),
      prisma.media.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
    ]);
    res.json({ total, page, perPage, items, driver: storage.activeDriver() });
  })
);

router.post(
  '/media',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(422, 'No file received.');
    const stored = await storage.upload(verifyImage(req.file));
    const media = await prisma.media.create({
      data: { ...stored, alt: (req.body.alt || '').trim() || null },
    });
    content.invalidate();
    res.status(201).json(media);
  })
);

/** Replace the binary behind an existing Media row — its URL updates in place. */
router.put(
  '/media/:id',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.media.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Media not found.');

    const data = {};
    if (req.body.alt !== undefined) data.alt = (req.body.alt || '').trim() || null;

    if (req.file) {
      const stored = await storage.upload(verifyImage(req.file));
      Object.assign(data, stored);
      // Drop the old binary only after the new one is safely stored.
      await storage.destroy(existing);
    }
    if (!Object.keys(data).length) throw new HttpError(422, 'Nothing to update.');

    const media = await prisma.media.update({ where: { id }, data });
    live(res, media);
  })
);

router.delete(
  '/media/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.media.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Media not found.');
    await prisma.media.delete({ where: { id } });
    await storage.destroy(existing);
    live(res, { ok: true });
  })
);

// ---------------------------------------------------------------- settings

router.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    res.json(await prisma.siteSetting.findMany({ orderBy: [{ group: 'asc' }, { order: 'asc' }] }));
  })
);

router.put(
  '/settings',
  validate(z.object({ settings: z.record(z.string(), z.string().max(5000)) })),
  asyncHandler(async (req, res) => {
    if (!Object.keys(req.body.settings).length) throw new HttpError(422, 'No settings supplied.');

    // Server-side validation of the notification recipients. The browser checks
    // these too, but that check is a convenience — this one is the guarantee.
    const rawRecipients = req.body.settings[notifier.RECIPIENTS_KEY];
    if (rawRecipients !== undefined) {
      const { valid, invalid } = notifier.parseRecipients(rawRecipients);
      if (invalid.length) {
        throw new HttpError(422, 'Some notification email addresses are not valid.', [
          { field: notifier.RECIPIENTS_KEY, message: `Not a valid email address: ${invalid.join(', ')}` },
        ]);
      }
      if (valid.length > notifier.MAX_RECIPIENTS) {
        throw new HttpError(
          422,
          `Too many notification recipients (maximum ${notifier.MAX_RECIPIENTS}).`
        );
      }
      // Store the cleaned, de-duplicated list rather than the raw text.
      req.body.settings[notifier.RECIPIENTS_KEY] = notifier.serialiseRecipients(valid);
    }

    // Read after normalisation so the cleaned recipient list is what gets stored.
    const entries = Object.entries(req.body.settings);

    await prisma.$transaction(
      entries.map(([key, value]) => {
        // A key this feature owns must keep its own group/label if it is being
        // created here rather than by the seed, or it renders under the wrong
        // heading in the admin panel.
        const def = notifier.SETTING_DEFS[key];
        return prisma.siteSetting.upsert({
          where: { key },
          update: { value },
          create: def
            ? { key, value, group: def.group, label: def.label, type: def.type, order: def.order }
            : { key, value, group: 'general', label: key },
        });
      })
    );
    live(res, { ok: true, updated: entries.length });
  })
);

// ----------------------------------------------------- email notifications

/**
 * Whether notifications can actually go out right now.
 * Reports only booleans and a human-readable reason — never the credential.
 */
router.get(
  '/notifications/status',
  asyncHandler(async (_req, res) => {
    const config = await notifier.getConfig();
    res.json({
      enabled: config.enabled,
      recipients: config.recipients,
      transportReady: config.transportReady,
      problem: config.transportProblem,
    });
  })
);

/** Send a test notification to every configured recipient. */
router.post(
  '/notifications/test',
  testEmailLimiter,
  asyncHandler(async (req, res) => {
    const who = req.admin ? req.admin.username : 'admin';
    const result = await notifier.sendTestEmail(who);

    if (!result.ok) {
      // 502: the request was fine, the downstream provider was not. Responding
      // directly rather than throwing — the global handler replaces the message
      // of any 5xx with a generic one, and here the admin needs the real reason
      // (already sanitised of anything secret by the mailer).
      return res.status(502).json({ ok: false, error: result.error || 'Test email failed.' });
    }
    res.json({
      ok: true,
      recipients: result.recipients,
      message: `Test email sent to ${result.recipients.length} recipient${result.recipients.length === 1 ? '' : 's'}.`,
    });
  })
);

// -------------------------------------------------------------- dashboard

router.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const [total, byStatus, services, recent] = await Promise.all([
      prisma.lead.count(),
      prisma.lead.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.service.count(),
      prisma.lead.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
    ]);
    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const row of byStatus) counts[row.status] = row._count._all;
    res.json({ total, counts, services, recent });
  })
);

// -------------------------------------------------------------- own account

router.post(
  '/account/password',
  validate(
    z.object({
      currentPassword: z.string().min(1, 'Enter your current password.'),
      newPassword: z.string().min(1),
    })
  ),
  asyncHandler(async (req, res) => {
    const problem = auth.passwordProblem(req.body.newPassword);
    if (problem) throw new HttpError(422, problem);

    const admin = await prisma.admin.findUnique({ where: { id: req.admin.id } });
    if (!admin || !(await auth.verifyPassword(req.body.currentPassword, admin.passwordHash))) {
      throw new HttpError(401, 'Current password is incorrect.');
    }
    await prisma.admin.update({
      where: { id: admin.id },
      data: { passwordHash: await auth.hashPassword(req.body.newPassword) },
    });
    res.json({ ok: true });
  })
);

module.exports = { router, requireAdminApi, adminApiLimiter, leadWhere, leadQuerySchema, STATUSES };
