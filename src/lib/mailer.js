'use strict';
/**
 * Transactional email transport (Resend).
 *
 * Talks to Resend's HTTP API directly with fetchWithTimeout — the same pattern
 * src/lib/geo.js uses for its third-party calls — so there is no extra runtime
 * dependency and a slow provider can never hang a request.
 *
 * The API key lives in the environment only. It is never read from the
 * database, never sent to the browser, and never written to a log line.
 */
const env = require('../config/env');
const { fetchWithTimeout } = require('./http');

/** True when the server has everything it needs to actually send. */
function isConfigured() {
  return Boolean(env.email.resendApiKey && env.email.from);
}

/**
 * Why sending is not possible, phrased for an admin reading the UI.
 * Returns null when the transport is ready.
 */
function configProblem() {
  if (!env.email.resendApiKey) return 'Email service is not configured on the server (RESEND_API_KEY is not set).';
  if (!env.email.from) return 'Email service is not configured on the server (EMAIL_FROM is not set).';
  return null;
}

/**
 * Strip anything secret-shaped out of a provider message before it is logged
 * or shown to an admin. Resend echoes the request back on some errors.
 */
function sanitise(message) {
  return String(message || '')
    .replace(/re_[A-Za-z0-9_-]{6,}/g, '[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .slice(0, 300);
}

/**
 * Send one email to one or more recipients.
 *
 * Resend puts every address in `to` on the same message, so all recipients
 * receive an identical notification. Resolves { ok, id } or { ok:false, error }
 * — it never throws, because no caller should fail because of email.
 */
async function send({ to, subject, html, text, replyTo }) {
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!recipients.length) return { ok: false, error: 'No recipients configured.' };

  const problem = configProblem();
  if (problem) return { ok: false, error: problem };

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

module.exports = { send, isConfigured, configProblem, sanitise };
