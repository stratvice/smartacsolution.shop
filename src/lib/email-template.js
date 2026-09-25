'use strict';
/**
 * Lead-notification email markup.
 *
 * Table-based, inline-styled and single-column by design — that is what renders
 * reliably in Gmail, Outlook and Apple Mail. Colours match the site palette.
 * A plain-text alternative is generated alongside for text-only clients.
 */
const { telLink, waLink, phoneDigits, mapsLink } = require('./format');

const NAVY = '#0e2a47';
const ORANGE = '#f7941d';
const TEAL = '#00b2a9';
const INK = '#1f2d3d';
const MUTED = '#6b7a8c';
const LINE = '#e3e9ef';

function esc(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const dash = (v) => (v === null || v === undefined || v === '' ? '—' : v);

/** "Mapusa, Goa, India" from whichever parts are known. */
function locationLine(lead) {
  const parts = [lead.city, lead.state, lead.country].filter(Boolean);
  return parts.length ? parts.join(', ') : '—';
}

/** Readable, unambiguous timestamp in the configured display timezone. */
function formatDate(value, timeZone) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timeZone || 'UTC',
    }).format(d) + (timeZone ? ` (${timeZone})` : ' UTC');
  } catch {
    return d.toISOString();
  }
}

function row(label, value, opts = {}) {
  const content = opts.html || esc(dash(value));
  return `
        <tr>
          <td style="padding:11px 0 3px 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.2;letter-spacing:.7px;text-transform:uppercase;color:${MUTED};font-weight:bold;">${esc(label)}</td>
        </tr>
        <tr>
          <td style="padding:0 0 11px 0;border-bottom:1px solid ${LINE};font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:${INK};word-break:break-word;">${content}</td>
        </tr>`;
}

/**
 * Build the notification email for one lead.
 * `opts.companyName` titles the email; `opts.adminUrl` links back to the panel.
 */
function leadEmail(lead, opts = {}) {
  const company = opts.companyName || 'Smart ac solution Goa';
  const timeZone = opts.timeZone || 'Asia/Kolkata';
  const created = formatDate(lead.createdAt || new Date(), timeZone);
  const location = locationLine(lead);
  const digits = phoneDigits(lead.phone);

  const waText = `Hello ${lead.name || ''}, thank you for contacting ${company}.`;
  const callHref = telLink(lead.phone);
  const waHref = waLink(lead.phone, waText);
  const map = mapsLink(lead);
  const mapHtml = map
    ? `<a href="${esc(map.href)}" style="color:${NAVY};text-decoration:none;font-weight:bold;">Open in Google Maps</a>` +
      (map.precise
        ? ''
        : `<span style="color:${MUTED};font-weight:normal;"> (approximate, from the area given)</span>`)
    : '';

  const phoneHtml = digits
    ? `<a href="${esc(callHref)}" style="color:${NAVY};text-decoration:none;font-weight:bold;">${esc(lead.phone)}</a>`
    : esc(dash(lead.phone));
  const emailHtml = lead.email
    ? `<a href="mailto:${esc(lead.email)}" style="color:${NAVY};text-decoration:none;">${esc(lead.email)}</a>`
    : '—';
  const messageHtml = lead.message ? esc(lead.message).replace(/\n/g, '<br/>') : '—';

  const button = (href, label, bg) => `
                  <td style="padding:0 8px 8px 0;">
                    <a href="${esc(href)}" style="display:inline-block;background:${bg};color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;line-height:1;padding:14px 22px;border-radius:6px;">${esc(label)}</a>
                  </td>`;

  const actions = digits
    ? `
        <tr>
          <td style="padding:20px 0 4px 0;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
              ${button(callHref, '\u{1F4DE} Call Lead', TEAL)}
              ${button(waHref, '\u{1F4AC} WhatsApp Lead', '#25d366')}
            </tr></table>
          </td>
        </tr>`
    : '';

  const adminButton = opts.adminUrl
    ? `
        <tr>
          <td style="padding:4px 0 0 0;">
            <a href="${esc(opts.adminUrl)}" style="display:inline-block;background:${NAVY};color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;line-height:1;padding:13px 20px;border-radius:6px;">Open in Admin Panel</a>
          </td>
        </tr>`
    : '';

  const banner = opts.isTest
    ? `
        <tr>
          <td style="padding:0 0 16px 0;">
            <div style="background:#fff6e5;border-left:4px solid ${ORANGE};padding:12px 14px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:${INK};border-radius:0 4px 4px 0;">
              <strong>This is a test email.</strong> It was sent from the admin panel to confirm that lead notifications are working. No real enquiry was received.
            </div>
          </td>
        </tr>`
    : '';

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(opts.subject || 'New Lead Received')}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f9;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(lead.name || 'New enquiry')} · ${esc(dash(lead.phone))} · ${esc(location)}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f4f6f9;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%;max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(14,42,71,.08);">
          <tr>
            <td style="background:${NAVY};padding:24px 28px;">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:1.2px;text-transform:uppercase;color:${ORANGE};font-weight:bold;">${esc(company)}</div>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:23px;line-height:1.3;color:#ffffff;font-weight:bold;padding-top:6px;">${opts.isTest ? 'Test Notification' : 'New Lead Received'}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 28px 28px 28px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                ${banner}
                ${row('Name', lead.name)}
                ${row('Phone', null, { html: phoneHtml })}
                ${row('Email', null, { html: emailHtml })}
                ${row('Service', lead.service)}
                ${row('Message', null, { html: messageHtml })}
                ${row('Location', location)}
                ${row('Location link', null, { html: mapHtml })}
                ${row('Source', lead.source)}
                ${row('Date & Time', created)}
                ${row('UTM Source', lead.utmSource)}
                ${row('UTM Medium', lead.utmMedium)}
                ${row('UTM Campaign', lead.utmCampaign)}
                ${actions}
                ${adminButton}
              </table>
            </td>
          </tr>
          <tr>
            <td style="background:#f8fafc;padding:16px 28px;border-top:1px solid ${LINE};font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:${MUTED};">
              Automated notification from the ${esc(company)} website.<br/>
              Change who receives these in the admin panel under Settings &rsaquo; Lead Email Notifications.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    opts.isTest ? '*** TEST EMAIL — no real enquiry was received. ***\n' : '',
    opts.isTest ? 'Test Notification' : 'New Lead Received',
    '='.repeat(28),
    `Name:          ${dash(lead.name)}`,
    `Phone:         ${dash(lead.phone)}`,
    `Email:         ${dash(lead.email)}`,
    `Service:       ${dash(lead.service)}`,
    `Message:       ${dash(lead.message)}`,
    `Location:      ${location}`,
    `Location link: ${map ? map.href : '—'}`,
    `Source:        ${dash(lead.source)}`,
    `Date & Time:   ${created}`,
    `UTM Source:    ${dash(lead.utmSource)}`,
    `UTM Medium:    ${dash(lead.utmMedium)}`,
    `UTM Campaign:  ${dash(lead.utmCampaign)}`,
    '',
    digits ? `Call:     ${callHref}` : '',
    digits ? `WhatsApp: ${waHref}` : '',
    opts.adminUrl ? `Admin:    ${opts.adminUrl}` : '',
  ]
    .filter((l) => l !== '')
    .join('\n');

  return { html, text };
}

module.exports = { leadEmail, locationLine, formatDate };
