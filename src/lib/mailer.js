'use strict';
/**
 * Transactional email transport.
 *
 * Two drivers, chosen by EMAIL_DRIVER:
 *
 *   resend - Resend's HTTP API, called with fetchWithTimeout (the same pattern
 *            src/lib/geo.js uses), so a slow provider can never hang a request.
 *            Requires a domain verified with Resend.
 *   smtp   - any SMTP server, Gmail included, via nodemailer. Needs no domain
 *            verification, so it can start sending before DNS is sorted.
 *
 * Credentials live in the environment only. They are never read from the
 * database, never sent to the browser, and never written to a log line.
 */
const env = require('../config/env');
const { fetchWithTimeout } = require('./http');

function usingSmtp() {
  return env.email.driver === 'smtp';
}

/** True when the server has everything it needs to actually send. */
function isConfigured() {
  if (usingSmtp()) return Boolean(env.email.smtp.user && env.email.smtp.pass && env.email.from);
  return Boolean(env.email.resendApiKey && env.email.from);
}

/**
 * Why sending is not possible, phrased for an admin reading the UI.
 * Returns null when the transport is ready.
 */
function configProblem() {
  if (usingSmtp()) {
    if (!env.email.smtp.user) return 'Email service is not configured on the server (SMTP_USER is not set).';
    if (!env.email.smtp.pass) return 'Email service is not configured on the server (SMTP_PASS is not set).';
    if (!env.email.from) return 'Email service is not configured on the server (EMAIL_FROM is not set).';
    return null;
  }
  if (!env.email.resendApiKey) return 'Email service is not configured on the server (RESEND_API_KEY is not set).';
  if (!env.email.from) return 'Email service is not configured on the server (EMAIL_FROM is not set).';
  return null;
}

/**
 * Strip anything secret-shaped out of a provider message before it is logged
 * or shown to an admin. Resend echoes the request back on some errors.
 */
function sanitise(message) {
  let out = String(message || '')
    .replace(/re_[A-Za-z0-9_-]{6,}/g, '[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
  // SMTP servers echo the username, and some echo the auth line verbatim.
  const pass = env.email.smtp && env.email.smtp.pass;
  if (pass) out = out.split(pass).join('[redacted]');
  return out.slice(0, 300);
}

/**
 * Send one email to one or more recipients.
 *
 * Resend puts every address in `to` on the same message, so all recipients
 * receive an identical notification. Resolves { ok, id } or { ok:false, error }
 * — it never throws, because no caller should fail because of email.
 */
/**
 * One shared transporter: nodemailer pools connections, and rebuilding it per
 * send would open a new TLS handshake for every lead.
 */
let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  const nodemailer = require('nodemailer');
  transporter = nodemailer.createTransport({
    host: env.email.smtp.host,
    port: env.email.smtp.port,
    secure: env.email.smtp.secure,
    auth: { user: env.email.smtp.user, pass: env.email.smtp.pass },
    connectionTimeout: env.email.timeoutMs,
    greetingTimeout: env.email.timeoutMs,
    socketTimeout: env.email.timeoutMs,
  });
  return transporter;
}

async function sendViaSmtp({ recipients, subject, html, text, replyTo }) {
  try {
    const info = await getTransporter().sendMail({
      from: env.email.from,
      to: recipients.join(', '),
      subject,
      html,
      ...(text ? { text } : {}),
      ...(replyTo || env.email.replyTo ? { replyTo: replyTo || env.email.replyTo } : {}),
    });
    return { ok: true, id: (info && info.messageId) || null };
  } catch (err) {
    const code = err && err.code ? err.code + ': ' : '';
    // Gmail rejects a normal account password with EAUTH; say so plainly,
    // because it is the single most common setup mistake.
    const hint =
      err && err.responseCode === 535
        ? ' Gmail needs an App Password (with 2-Step Verification on), not your normal account password.'
        : '';
    return { ok: false, error: 'SMTP send failed (' + code + sanitise(err && err.message) + ').' + hint };
  }
}

/** Confirm the credentials work without sending anything. */
async function verify() {
  const problem = configProblem();
  if (problem) return { ok: false, error: problem };
  if (!usingSmtp()) return { ok: true, note: 'Resend is verified by sending; nothing to check up front.' };
  try {
    await getTransporter().verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: sanitise(err && err.message) };
  }
}

async function send({ to, subject, html, text, replyTo }) {
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!recipients.length) return { ok: false, error: 'No recipients configured.' };

  const problem = configProblem();
  if (problem) return { ok: false, error: problem };

  if (usingSmtp()) return sendViaSmtp({ recipients, subject, html, text, replyTo });

  const payload = {
    from: env.email.from,
    to: recipients,
    subject,
    html,
    ...(text ? { text } : {}),
    ...(replyTo || env.email.replyTo ? { reply_to: replyTo || env.email.replyTo } : {}),
  };

  try {
    const res = await fetchWithTimeout(
      env.email.apiUrl,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.email.resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
      env.email.timeoutMs
    );

    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      const detail = sanitise(body && (body.message || body.error || body.name));
      return {
        ok: false,
        error: detail ? `Email provider rejected the request (${res.status}): ${detail}` : `Email provider returned ${res.status}.`,
      };
    }
    return { ok: true, id: (body && body.id) || null };
  } catch (err) {
    const reason = err && err.name === 'AbortError' ? 'timed out' : sanitise(err && err.message);
    return { ok: false, error: `Could not reach the email provider (${reason}).` };
  }
}

module.exports = { send, verify, isConfigured, configProblem, sanitise, usingSmtp };
