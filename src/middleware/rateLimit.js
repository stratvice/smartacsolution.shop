'use strict';
const rateLimit = require('express-rate-limit');
const env = require('../config/env');

const json = (message) => (req, res) =>
  res.status(429).json({ error: message, retryAfter: res.getHeader('Retry-After') || null });

/** Brute-force protection on the admin login form. */
const loginLimiter = rateLimit({
  windowMs: env.rate.loginWindowMin * 60 * 1000,
  max: env.rate.loginMax,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (req, res) => {
    const msg = `Too many login attempts. Try again in ${env.rate.loginWindowMin} minutes.`;
    if (req.accepts('html') && !req.xhr) {
      return res.status(429).render('admin/login', {
        title: 'Sign in',
        error: msg,
        values: {},
        next: '',
      });
    }
    return res.status(429).json({ error: msg });
  },
});

/** Stops a bot from flooding the leads table from the public form. */
const leadLimiter = rateLimit({
  windowMs: env.rate.leadWindowMin * 60 * 1000,
  max: env.rate.leadMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: json('Too many submissions from this network. Please try again shortly.'),
});

/** Generous cap on the keyless geo endpoints. */
const geoLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: json('Too many location lookups.'),
});

/**
 * Test emails are admin-only but still cost real provider quota, so they get a
 * tighter cap than the blanket admin limit.
 */
const testEmailLimiter = rateLimit({
  windowMs: env.rate.testEmailWindowMin * 60 * 1000,
  max: env.rate.testEmailMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: json(
    `Too many test emails. Try again in ${env.rate.testEmailWindowMin} minutes.`
  ),
});

/** Blanket cap on authenticated admin APIs. */
const adminApiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  handler: json('Too many requests.'),
});

module.exports = { loginLimiter, leadLimiter, geoLimiter, adminApiLimiter, testEmailLimiter };
