'use strict';
const fs = require('fs');
require('./load-env');
const path = require('path');

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

/** Is there a mail program at this path that we are allowed to run? */
function hasSendmail(path) {
  if (!path) return false;
  try {
    fs.accessSync(path, fs.constants.X_OK);
    return true;
  } catch (err) {
    return false;
  }
}

/** Do two addresses (either may carry a display name) share a domain? */
function sameDomain(a, b) {
  const domain = (value) => {
    const match = String(value || '').match(/@([^s>]+)/);
    return match ? match[1].toLowerCase() : '';
  };
  const left = domain(a);
  return Boolean(left) && left === domain(b);
}

/** noreply@<the site's own domain>, for transports with no account behind them. */
function defaultFromAddress(appUrl) {
  try {
    const host = new URL(appUrl).hostname.replace(/^www./, '');
    if (!host || host === 'localhost') return '';
    return 'noreply@' + host;
  } catch (err) {
    return '';
  }
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
  // Where local uploads are written. Must point OUTSIDE the deployed tree on
  // any host that builds each release into a new directory (Hostinger, and
  // most PaaS), or every uploaded image is deleted by the next deploy while
  // its Media row survives and 404s.
  uploadDir: process.env.UPLOAD_DIR
    ? path.resolve(process.env.UPLOAD_DIR)
    : path.join(__dirname, '..', '..', 'public', 'uploads'),

  corsOrigins: list(process.env.CORS_ORIGINS),

  geo: {
    nominatimUrl: process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org/reverse',
    nominatimUserAgent: process.env.NOMINATIM_USER_AGENT || 'websaf-locator/1.0',
    ipGeoUrl: process.env.IP_GEO_URL || 'https://ipwho.is',
    cacheTtlMin: int(process.env.GEO_CACHE_TTL_MIN, 720),
  },

  // Transactional email. Credentials are server-side only: never exposed to a
  // template, an API response or the browser.
  //
  // EMAIL_DRIVER picks the transport:
  //   resend   - Resend HTTP API. Needs a domain verified with Resend.
  //   smtp     - any SMTP server, Gmail included. Needs no domain
  //              verification, which is why it is the quickest way to start.
  //   sendmail - hand the message to the host's own mail program. No
  //              credential at all, but it only exists on hosts that provide
  //              one, and mail sent this way is more likely to be filtered
  //              because it is not signed.
  //
  // Left unset, the driver is chosen from what is actually available rather
  // than defaulting to a provider that has not been configured: a site with no
  // mail credentials still sends through the host if there is one to use. An
  // explicit EMAIL_DRIVER always wins.
  email: {
    driver: (process.env.EMAIL_DRIVER || '').toLowerCase(),
    smtp: {
      // Gmail defaults, so that case needs only SMTP_USER, SMTP_PASS, EMAIL_FROM.
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: int(process.env.SMTP_PORT, 587),
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
      // 465 is implicit TLS; 587 upgrades via STARTTLS.
      secure: bool(process.env.SMTP_SECURE, int(process.env.SMTP_PORT, 587) === 465),
    },
    resendApiKey: process.env.RESEND_API_KEY || '',
    from: process.env.EMAIL_FROM || '',
    // Where the host's mail program lives. Standard on Linux; overridable for
    // hosts that put it elsewhere.
    sendmailPath: process.env.SENDMAIL_PATH || '/usr/sbin/sendmail',
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
    email: process.env.SEED_ADMIN_EMAIL || 'admin@smartacsolution.shop',
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
// Settle on one transport now, so nothing downstream has to guess: take
// whatever is actually usable, in order of how well it delivers.
function usableDriver(name) {
  if (name === 'smtp') return Boolean(env.email.smtp.user && env.email.smtp.pass);
  if (name === 'resend') return Boolean(env.email.resendApiKey);
  if (name === 'sendmail') return hasSendmail(env.email.sendmailPath);
  return false;
}

const chosen = env.email.driver;
if (!chosen) {
  env.email.driver =
    ['smtp', 'resend', 'sendmail'].find(usableDriver) || 'resend'; // nothing available; report against this
} else if (!usableDriver(chosen) && usableDriver('sendmail')) {
  // A driver was named but its credentials were never filled in, which is the
  // usual state of a config copied from the example. Silently sending nothing
  // is the worst outcome, so use the host's mail program and say so.
  env.email.driver = 'sendmail';
  console.warn(
    '[config] EMAIL_DRIVER=' +
      chosen +
      ' has no credentials, so lead notifications will go through the host mail program instead. ' +
      'Fill in the credentials to use ' +
      chosen +
      '.'
  );
}

// The host's mail program has no account behind it, so the only address it is
// entitled to send as is one at the site's own domain. Anything else -- a
// leftover placeholder, or a Gmail address meant for the SMTP driver -- fails
// SPF at the receiving end and is rejected or filed as spam. Replace it rather
// than send something that will not arrive.
if (env.email.driver === 'sendmail') {
  const ours = defaultFromAddress(env.appUrl);
  if (ours && !sameDomain(env.email.from, ours)) env.email.from = ours;
}

// Email is optional: the site and lead capture work fully without it, so this
// is a warning rather than a boot failure.
const EMAIL_REQUIREMENTS = {
  smtp: { ok: () => env.email.smtp.user && env.email.smtp.pass && env.email.from, missing: 'SMTP_USER, SMTP_PASS and EMAIL_FROM' },
  resend: { ok: () => env.email.resendApiKey && env.email.from, missing: 'RESEND_API_KEY and EMAIL_FROM' },
  sendmail: { ok: () => env.email.from && hasSendmail(env.email.sendmailPath), missing: 'a mail program at ' + env.email.sendmailPath },
};
const requirement = EMAIL_REQUIREMENTS[env.email.driver] || EMAIL_REQUIREMENTS.resend;
if (!requirement.ok()) {
  console.warn(
    '[config] Lead email notifications are inactive — set ' +
      requirement.missing +
      ' to enable them. Leads are still saved normally.'
  );
} else if (env.email.driver === 'sendmail') {
  console.warn(
    '[config] Sending lead notifications through the host mail program as ' +
      env.email.from +
      '. Unsigned mail is filtered more often, so check the spam folder if one does not arrive.'
  );
}
// Local storage is only lossy when the upload directory sits inside the
// deployed tree, since a release-per-directory host deletes it on each deploy.
// Pointing UPLOAD_DIR outside that tree makes local storage perfectly safe.
if (env.isProd && env.storageDriver === 'local') {
  const insideAppTree = !path
    .relative(path.join(__dirname, '..', '..'), env.uploadDir)
    .startsWith('..');
  if (insideAppTree) {
    console.warn(
      `[config] STORAGE_DRIVER=local with UPLOAD_DIR inside the app (${env.uploadDir}) — uploads are deleted on every deploy. Set UPLOAD_DIR to a path outside the deployed tree, or use cloudinary.`
    );
  }
}

module.exports = env;
