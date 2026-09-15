'use strict';
const env = require('../config/env');
const prisma = require('../lib/prisma');
const { verifyToken } = require('../lib/auth');
const { HttpError } = require('../lib/http');

/** Resolve req.admin from the auth cookie, if present and still valid. */
async function loadAdmin(req, _res, next) {
  req.admin = null;
  const token = req.cookies ? req.cookies[env.cookieName] : null;
  if (!token) return next();

  const payload = verifyToken(token);
  if (!payload) return next();

  try {
    const admin = await prisma.admin.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, username: true, name: true, role: true, isActive: true },
    });
    // A deactivated or deleted admin must not keep a usable session.
    if (admin && admin.isActive) req.admin = admin;
  } catch (err) {
    console.warn('[auth] admin lookup failed:', err.message);
  }
  next();
}

/** Gate admin *pages* — redirects a signed-out visitor to the login screen. */
function requireAdminPage(req, res, next) {
  if (req.admin) return next();
  const next_ = encodeURIComponent(req.originalUrl || '/admin/dashboard');
  return res.redirect(`/admin/login?next=${next_}`);
}

/** Gate admin *APIs* — answers 401 JSON, never a redirect. */
function requireAdminApi(req, _res, next) {
  if (req.admin) return next();
  return next(new HttpError(401, 'Authentication required.'));
}

module.exports = { loadAdmin, requireAdminPage, requireAdminApi };
