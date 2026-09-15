'use strict';
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const cookieParser = require('cookie-parser');

const env = require('./config/env');
const prisma = require('./lib/prisma');
const { HttpError } = require('./lib/http');
const { loadAdmin, requireAdminApi } = require('./middleware/auth');
const { adminApiLimiter } = require('./middleware/rateLimit');

const publicRoutes = require('./routes/public');
const publicApi = require('./routes/api.public');
const adminRoutes = require('./routes/admin');
const { router: adminApi } = require('./routes/api.admin');

const app = express();

// Behind a proxy (Render/Railway/nginx) so req.ip and rate limiting see the
// real client address rather than the proxy's.
app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.disable('x-powered-by');

// ---------------------------------------------------------------- security
// The page loads Bootstrap/jQuery/Owl/AOS/Font Awesome from CDNs and uses
// inline styles, so the CSP allows exactly those origins and nothing else.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'", // the original page ships inline init scripts
          'https://cdn.jsdelivr.net',
          'https://cdnjs.cloudflare.com',
          'https://code.jquery.com',
        ],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          'https://cdn.jsdelivr.net',
          'https://cdnjs.cloudflare.com',
          'https://fonts.googleapis.com',
        ],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https://res.cloudinary.com', 'https:'],
        connectSrc: ["'self'"],
        frameSrc: ["'self'", 'https://www.google.com'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
        upgradeInsecureRequests: env.isProd ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    // Cloudinary/CDN images are cross-origin; allow them to render.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// Same-origin by default; CORS_ORIGINS opens the *public* API to named hosts.
const corsOptions = env.corsOrigins.length
  ? {
      origin: (origin, cb) =>
        !origin || env.corsOrigins.includes(origin)
          ? cb(null, true)
          : cb(new HttpError(403, 'Origin not allowed.')),
      credentials: false,
      methods: ['GET', 'POST'],
    }
  : { origin: false };

app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

app.use(
  express.static(path.join(__dirname, '..', 'public'), {
    maxAge: env.isProd ? '7d' : 0,
    etag: true,
  })
);

// Uploads are served from their configured location rather than from within
// public/, so they can live outside the deployed tree and survive a deploy.
app.use(
  '/uploads',
  express.static(env.uploadDir, { maxAge: env.isProd ? '7d' : 0, etag: true, fallthrough: true })
);

// Makes req.admin available to every route and view.
app.use(loadAdmin);
app.use((req, res, next) => {
  res.locals.admin = req.admin;
  res.locals.currentPath = req.path;
  next();
});

// ------------------------------------------------------------------ routes
// /api/admin must be mounted before /api: the public router ends in a
// catch-all 404 that would otherwise swallow every admin API request.
app.use('/api/admin', adminApiLimiter, requireAdminApi, adminApi);
app.use('/api', cors(corsOptions), publicApi);
app.use('/admin', adminRoutes);
app.use('/', publicRoutes);

app.get('/healthz', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, db: 'up' });
  } catch {
    res.status(503).json({ ok: false, db: 'down' });
  }
});

// --------------------------------------------------------------- 404 + 500
app.use((req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found.' });
  res.status(404).render('404', { title: 'Page not found' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;

  // Log the real error server-side; never leak internals to the client.
  if (status >= 500) console.error('[error]', err);
  else if (!env.isProd) console.warn(`[${status}]`, err.message);

  const safeMessage =
    status < 500 && err.expose !== false ? err.message : 'Something went wrong. Please try again.';

  if (req.path.startsWith('/api') || req.xhr || req.accepts(['html', 'json']) === 'json') {
    return res.status(status).json({
      error: safeMessage,
      ...(err.details ? { details: err.details } : {}),
    });
  }
  res.status(status).render('error', { title: 'Error', status, message: safeMessage });
});

// ------------------------------------------------------------------- boot
const server = app.listen(env.port, () => {
  console.log(`\n  ${'='.repeat(52)}`);
  console.log(`  24x7 Customer Support  —  ${env.nodeEnv}`);
  console.log(`  Website      ${env.appUrl}`);
  console.log(`  Admin panel  ${env.appUrl}/admin`);
  console.log(`  Image store  ${require('./lib/storage').activeDriver()}`);
  console.log(`  ${'='.repeat(52)}\n`);
});

async function shutdown(signal) {
  console.log(`\n[${signal}] shutting down…`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = app;
