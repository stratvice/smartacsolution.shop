'use strict';
/**
 * Assembles everything the public page renders, straight from the database.
 *
 * A tiny in-process cache keeps the page fast, and every admin write calls
 * invalidate() — so "save in admin" is immediately visible on the public site.
 */
const prisma = require('../lib/prisma');

let cached = null;
let cachedAt = 0;
const TTL = 30 * 1000;

function invalidate() {
  cached = null;
  cachedAt = 0;
}

/** site_settings rows -> a flat { key: value } object for templates. */
function settingsMap(rows) {
  return rows.reduce((acc, r) => {
    acc[r.key] = r.value;
    return acc;
  }, {});
}

async function getContent({ fresh = false } = {}) {
  if (!fresh && cached && Date.now() - cachedAt < TTL) return cached;

  const [sectionRows, services, testimonials, faqs, settingRows] = await Promise.all([
    prisma.pageSection.findMany({ orderBy: { order: 'asc' } }),
    prisma.service.findMany({ where: { isActive: true }, orderBy: [{ order: 'asc' }, { id: 'asc' }] }),
    prisma.testimonial.findMany({ where: { isActive: true }, orderBy: [{ order: 'asc' }, { id: 'asc' }] }),
    prisma.faq.findMany({ where: { isActive: true }, orderBy: [{ order: 'asc' }, { id: 'asc' }] }),
    prisma.siteSetting.findMany({ orderBy: [{ group: 'asc' }, { order: 'asc' }] }),
  ]);

  const sections = {};
  for (const row of sectionRows) {
    sections[row.key] = { ...row.content, _active: row.isActive, _label: row.label };
  }

  cached = {
    sections,
    services,
    testimonials,
    faqs,
    settings: settingsMap(settingRows),
    settingRows,
  };
  cachedAt = Date.now();
  return cached;
}

/** All settings as { key: value }, always fresh (used by the admin forms). */
async function getSettings() {
  const rows = await prisma.siteSetting.findMany({ orderBy: [{ group: 'asc' }, { order: 'asc' }] });
  return { map: settingsMap(rows), rows };
}

module.exports = { getContent, getSettings, invalidate };
