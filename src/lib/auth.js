'use strict';
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const env = require('../config/env');

const ROUNDS = 12;

const hashPassword = (plain) => bcrypt.hash(plain, ROUNDS);
const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

function signToken(admin) {
  return jwt.sign(
    { sub: admin.id, email: admin.email, username: admin.username, role: admin.role },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, env.jwtSecret);
  } catch {
    return null;
  }
}

function setAuthCookie(res, token) {
  res.cookie(env.cookieName, token, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000,
    path: '/',
  });
}

function clearAuthCookie(res) {
  res.clearCookie(env.cookieName, { path: '/' });
}

/** Password policy enforced on create and on change. */
function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return 'Password must be at least 10 characters.';
  if (!/[a-z]/.test(pw)) return 'Password must contain a lowercase letter.';
  if (!/[A-Z]/.test(pw)) return 'Password must contain an uppercase letter.';
  if (!/[0-9]/.test(pw)) return 'Password must contain a number.';
  return null;
}

module.exports = {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  setAuthCookie,
  clearAuthCookie,
  passwordProblem,
};
