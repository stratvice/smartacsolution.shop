'use strict';
require('dotenv').config();

function bool(v, dflt = false) {
  if (v === undefined || v === '') return dflt;
  return String(v).toLowerCase() === 'true' || v === '1';
}
function int(v, dflt) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : dflt;
}
function list(v) {
  return String(v || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: (process.env.NODE_ENV || 'development') === 'production',
  port: int(process.env.PORT, 3000),
  appUrl: process.env.APP_URL || `http://localhost:${int(process.env.PORT, 3000)}`,

  databaseUrl: process.env.DATABASE_URL,

  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  cookieName: process.env.COOKIE_NAME || 'websaf_admin',
  cookieSecure: bool(process.env.COOKIE_SECURE, false),

  storageDriver: (process.env.STORAGE_DRIVER || 'local').toLowerCase(),
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
    folder: process.env.CLOUDINARY_FOLDER || 'websaf',
  },
  maxUploadMb: int(process.env.MAX_UPLOAD_MB, 5),

  corsOrigins: list(process.env.CORS_ORIGINS),

  geo: {
    nominatimUrl: process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org/reverse',
    nominatimUserAgent: process.env.NOMINATIM_USER_AGENT || 'websaf-locator/1.0',
    ipGeoUrl: process.env.IP_GEO_URL || 'https://ipwho.is',
    cacheTtlMin: int(process.env.GEO_CACHE_TTL_MIN, 720),
  },

  // Transactional email (Resend). The API key is server-side only: it is never
  // exposed to a template, an API response or the browser.
  email: {
    resendApiKey: process.env.RESEND_API_KEY || '',
    from: process.env.EMAIL_FROM || '',
    replyTo: process.env.EMAIL_REPLY_TO || '',
    apiUrl: process.env.RESEND_API_URL || 'https://api.resend.com/emails',
    timeoutMs: int(process.env.EMAIL_TIMEOUT_MS, 10000),
    timeZone: process.env.EMAIL_TIMEZONE || 'Asia/Kolkata',
  },

  rate: {
    loginMax: int(process.env.LOGIN_RATE_MAX, 5),
    loginWindowMin: int(process.env.LOGIN_RATE_WINDOW_MIN, 15),
    leadMax: int(process.env.LEAD_RATE_MAX, 5),
    leadWindowMin: int(process.env.LEAD_RATE_WINDOW_MIN, 10),
    testEmailMax: int(process.env.TEST_EMAIL_RATE_MAX, 5),
    testEmailWindowMin: int(process.env.TEST_EMAIL_RATE_WINDOW_MIN, 10),
  },

  seedAdmin: {
    email: process.env.SEED_ADMIN_EMAIL || 'admin@24x7support.local',
    username: process.env.SEED_ADMIN_USERNAME || 'admin',
    password: process.env.SEED_ADMIN_PASSWORD || '',
  },
};

// Fail fast on missing secrets rather than booting an insecure server.
const missing = [];
if (!env.databaseUrl) missing.push('DATABASE_URL');
if (!env.jwtSecret || env.jwtSecret.length < 32) missing.push('JWT_SECRET (min 32 chars)');
if (missing.length) {
  console.error(`\n[config] Missing/invalid environment variables: ${missing.join(', ')}`);
  console.error('[config] Copy .env.example to .env and fill it in.\n');
  process.exit(1);
}
// Email is optional: the site and lead capture work fully without it, so this
// is a warning rather than a boot failure.
if (!env.email.resendApiKey || !env.email.from) {
  console.warn(
    '[config] Lead email notifications are inactive — set RESEND_API_KEY and EMAIL_FROM to enable them. Leads are still saved normally.'
  );
}
if (env.isProd && env.storageDriver === 'local') {
  console.warn('[config] STORAGE_DRIVER=local in production — uploads will not survive a redeploy. Use cloudinary.');
}

module.exports = env;
