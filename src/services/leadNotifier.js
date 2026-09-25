'use strict';
/**
 * Lead email notifications.
 *
 * Recipients and the on/off switch live in the existing site_settings table, so
 * they are changed from the admin panel with no code change and no redeploy.
 * The provider credential lives in the environment and is never stored here.
 *
 * Contract with the lead route: notifying NEVER throws and NEVER blocks. A lead
 * that is saved stays saved whatever the email provider does.
 */
const prisma = require('../lib/prisma');
const env = require('../config/env');
const mailer = require('../lib/mailer');
const { leadEmail } = require('../lib/email-template');
const { getSettings } = require('./content');

const ENABLED_KEY = 'lead_email_enabled';
const RECIPIENTS_KEY = 'lead_email_recipients';

/**
 * Metadata for the two settings rows this feature owns. Shared by the seed and
 * by the settings API, so a row created either way lands in the right group and
 * renders under the right heading in the admin panel.
 */
const SETTING_DEFS = {
  [ENABLED_KEY]: {
    value: 'false',
    group: 'notifications',
    label: 'Lead email notifications',
    type: 'text',
    order: 1,
  },
  [RECIPIENTS_KEY]: {
    value: '',
    group: 'notifications',
    label: 'Notification emails',
    type: 'textarea',
    order: 2,
  },
};

// Deliberately conservative: one address, no display names, no bare-IP hosts.
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,24}$/;
const MAX_RECIPIENTS = 25;

function isValidEmail(value) {
  const s = String(value || '').trim();
  return s.length <= 254 && EMAIL_RE.test(s);
}

/**
 * Split the stored recipient blob into addresses.
 * Stored newline-separated; commas and semicolons are accepted so an admin can
 * paste a list in any of the usual shapes. Case-normalised and de-duplicated.
 */
function parseRecipients(raw) {
  const seen = new Set();
  const valid = [];
  const invalid = [];

  for (const piece of String(raw || '').split(/[\n,;]+/)) {
    const address = piece.trim();
    if (!address) continue;
    if (!isValidEmail(address)) {
      invalid.push(address.slice(0, 120));
      continue;
    }
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push(address);
  }
  return { valid, invalid };
}

/** Normalise a recipient list back into the stored newline-separated form. */
function serialiseRecipients(list) {
  return list.join('\n');
}

function truthy(value, dflt = false) {
  if (value === undefined || value === null || value === '') return dflt;
  const s = String(value).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'on' || s === 'yes';
}

/** Current notification config, read fresh from the database each time. */
async function getConfig() {
  const { map } = await getSettings();
  const { valid, invalid } = parseRecipients(map[RECIPIENTS_KEY]);
  return {
    enabled: truthy(map[ENABLED_KEY], false),
    recipients: valid,
    invalid,
    companyName: map.company_name || 'Smart ac solution Goa',
    transportReady: mailer.isConfigured(),
    transportProblem: mailer.configProblem(),
  };
}

/** Subject line, per the agreed format: "New Lead Received - <company>". */
function subjectFor(companyName, isTest) {
  return `${isTest ? 'Test: ' : ''}New Lead Received - ${companyName}`;
}

/**
 * Record the outcome on the lead row. Best-effort: if this write fails the
 * lead itself is still intact, so we only log it.
 */
async function recordOutcome(leadId, data) {
  if (!leadId) return;
  try {
    await prisma.lead.update({ where: { id: leadId }, data });
  } catch (err) {
    console.warn(`[notify] could not record email status on lead #${leadId}: ${err.message}`);
  }
}

/**
 * Send the "new lead" notification for a saved lead.
 *
 * Always resolves. Returns { status, recipients, error } so a caller can log or
 * display the outcome, but the public lead route ignores it by design.
 */
async function notifyNewLead(lead) {
  const leadId = lead && lead.id;

  try {
    const config = await getConfig();

    if (!config.enabled) {
      console.log(`[notify] lead #${leadId}: notifications are switched off — skipping.`);
      return { status: 'NOT_ATTEMPTED', recipients: [], error: null };
    }
    if (!config.recipients.length) {
      const why = 'No valid recipient addresses are configured.';
      console.warn(`[notify] lead #${leadId}: ${why}`);
      await recordOutcome(leadId, { notifyStatus: 'NOT_ATTEMPTED', notifyError: why });
      return { status: 'NOT_ATTEMPTED', recipients: [], error: why };
    }
    if (!config.transportReady) {
      console.warn(`[notify] lead #${leadId}: ${config.transportProblem}`);
      await recordOutcome(leadId, {
        notifyStatus: 'FAILED',
        notifyAt: new Date(),
        notifyRecipients: serialiseRecipients(config.recipients),
        notifyError: config.transportProblem,
      });
      return { status: 'FAILED', recipients: config.recipients, error: config.transportProblem };
    }

    const subject = subjectFor(config.companyName, false);
    const { html, text } = leadEmail(lead, {
      companyName: config.companyName,
      subject,
      adminUrl: `${env.appUrl}/admin/leads`,
      timeZone: env.email.timeZone,
    });

    console.log(
      `[notify] lead #${leadId}: sending notification to ${config.recipients.length} recipient(s): ${config.recipients.join(', ')}`
    );

    const result = await mailer.send({
      to: config.recipients,
      subject,
      html,
      text,
      fromName: config.companyName,
      // Replying to the notification reaches the customer when they left an address.
      replyTo: lead.email || undefined,
    });

    if (result.ok) {
      console.log(`[notify] lead #${leadId}: notification sent successfully (provider id ${result.id || 'n/a'}).`);
      await recordOutcome(leadId, {
        notifyStatus: 'SENT',
        notifyAt: new Date(),
        notifyRecipients: serialiseRecipients(config.recipients),
        notifyError: null,
      });
      return { status: 'SENT', recipients: config.recipients, error: null };
    }

    console.error(`[notify] lead #${leadId}: notification FAILED — ${result.error}`);
    await recordOutcome(leadId, {
      notifyStatus: 'FAILED',
      notifyAt: new Date(),
      notifyRecipients: serialiseRecipients(config.recipients),
      notifyError: mailer.sanitise(result.error),
    });
    return { status: 'FAILED', recipients: config.recipients, error: result.error };
  } catch (err) {
    // Nothing above is allowed to escape — the lead is already safely stored.
    const reason = mailer.sanitise(err && err.message);
    console.error(`[notify] lead #${leadId}: unexpected notification error — ${reason}`);
    await recordOutcome(leadId, { notifyStatus: 'FAILED', notifyAt: new Date(), notifyError: reason });
    return { status: 'FAILED', recipients: [], error: reason };
  }
}

/**
 * Fire the notification after the HTTP response has gone out.
 * setImmediate keeps the visitor's request off the critical path entirely.
 */
function notifyNewLeadInBackground(lead) {
  setImmediate(() => {
    notifyNewLead(lead).catch((err) => {
      console.error('[notify] background notification error —', mailer.sanitise(err && err.message));
    });
  });
}

/**
 * Send a test notification to every currently configured recipient.
 * Unlike notifyNewLead this reports problems to the caller, because an admin
 * pressed a button and is waiting to find out whether it worked.
 */
async function sendTestEmail(triggeredBy) {
  const config = await getConfig();

  if (!config.recipients.length) {
    return { ok: false, error: 'Add at least one recipient email address and save your settings first.' };
  }
  if (!config.transportReady) {
    return { ok: false, error: config.transportProblem };
  }

  const subject = subjectFor(config.companyName, true);
  const sample = {
    id: null,
    name: 'Test Lead',
    phone: '+91 90000 00000',
    email: 'test.lead@example.com',
    service: 'Split AC Repair',
    message: 'This is a sample enquiry message used to preview the notification layout.',
    city: 'Mapusa',
    state: 'Goa',
    country: 'India',
    source: 'admin-test',
    utmSource: 'test',
    utmMedium: 'email',
    utmCampaign: 'notification-check',
    createdAt: new Date(),
  };

  const { html, text } = leadEmail(sample, {
    companyName: config.companyName,
    subject,
    isTest: true,
    adminUrl: `${env.appUrl}/admin/leads`,
    timeZone: env.email.timeZone,
  });

  console.log(
    `[notify] test email requested by ${triggeredBy || 'admin'} → ${config.recipients.length} recipient(s): ${config.recipients.join(', ')}`
  );

  const result = await mailer.send({ to: config.recipients, subject, html, text, fromName: config.companyName });

  if (result.ok) {
    console.log(`[notify] test email sent successfully (provider id ${result.id || 'n/a'}).`);
    return { ok: true, recipients: config.recipients };
  }
  console.error(`[notify] test email FAILED — ${result.error}`);
  return { ok: false, error: result.error, recipients: config.recipients };
}

module.exports = {
  notifyNewLead,
  notifyNewLeadInBackground,
  sendTestEmail,
  getConfig,
  parseRecipients,
  serialiseRecipients,
  isValidEmail,
  ENABLED_KEY,
  RECIPIENTS_KEY,
  SETTING_DEFS,
  MAX_RECIPIENTS,
};
