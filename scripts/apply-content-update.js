'use strict';
/**
 * Apply the reviewed content changes to a database that already has content.
 *
 *   node scripts/apply-content-update.js
 *
 * db:seed deliberately never overwrites an existing value — that is correct,
 * because it must not clobber edits made in the admin. The consequence is that
 * deploying new seed defaults changes nothing on a live site. This script sets
 * the specific values that were agreed, and nothing else.
 *
 * Idempotent: re-running makes no further changes, and it reports exactly what
 * it altered so the result can be checked rather than assumed.
 */
require('../src/config/load-env');
const prisma = require('../src/lib/prisma');
const content = require('../src/services/content');
const COPY = require('../db/copy');

const PHONE = '+91 93688 13078';
const PHONE_RAW = '+919368813078';
const EMAIL = 'smartacsolution.shop@gmail.com';
const COMPANY = 'Smart ac solution Goa';

// Images already deployed under public/images/ by the same commit.
const IMG = {
  hero: '/images/hero-collage-69f02627.jpeg',
  about: [
    '/images/about-1-3ad4f7ce.png',
    '/images/about-2-33f0d76e.png',
    '/images/about-3-0159e3cf.png',
  ],
  // Call Now buttons dial a tel: link, so they take a phone icon. The FAQ
  // "Ask on WhatsApp" button genuinely opens WhatsApp and keeps its own icon.
  serviceButtonIcon: "fa fa-phone",
  // Service cards, keyed by slug. Only the cards listed here are touched.
  services: {
    "split-ac-repair": "/images/split-ac-repair-3e8924f6.png",
    "window-ac-repair": "/images/window-ac-repair-665d7da3.png",
    "ductless-ac-repair": "/images/ductless-ac-repair-dce871a9.png",
  },
};

// Notification recipients. These are admin-editable, so this sets them once
// and then leaves them alone like every other value here.
const LEAD_EMAILS = ['smartacsolution.shop@gmail.com', 'vikash.stratvice@gmail.com'].join('\n');

const SETTINGS = {
  lead_email_enabled: 'true',
  lead_email_recipients: LEAD_EMAILS,
  company_name: COMPANY,
  company_name_accent: 'Goa',
  phone: PHONE,
  whatsapp: PHONE_RAW,
  email: EMAIL,
  short_location: 'Goa',
  address: 'South Goa\nNorth Goa',
  working_hours: 'Mon–Sun: 8AM – 8PM',
  working_hours_full: 'Mon – Sun: 8:00 AM – 8:00 PM',
  // Book Now scrolls to the enquiry form; a tel: link does nothing on desktop.
  primary_cta_link: '#contact',
  nav_cta_link: 'tel:' + PHONE_RAW,
  sticky_cta_text: 'Call Now: ' + PHONE,
  sticky_cta_link: 'tel:' + PHONE_RAW,
  secondary_cta_text: 'Chat Now',
  secondary_cta_link: 'https://wa.link/pbjr74',
  seo_description: COPY.seo.description,
  seo_og_description: COPY.seo.ogDescription,
  seo_title: COMPANY + ' | Home Appliance Repair Experts',
  seo_og_title: COMPANY + ' | Home Appliance Repair Experts',
  seo_og_image: IMG.hero,
};

/**
 * This runs from postinstall so the content lands without shell access to the
 * server. It must therefore run EXACTLY ONCE: re-applying on every deploy
 * would overwrite anything later edited in the admin panel, which is the very
 * thing db:seed's no-clobber rule protects against.
 *
 * A marker row records that this revision has been applied. Bump REVISION only
 * when there is a new one-off content change to push.
 */
const MARKER_KEY = 'content_update_rev';
const REVISION = '2026-09-25-lead-emails';

/** --soft: never fail the build. A deploy must not break because the database
 *  was briefly unreachable; the update can be run again by hand. */
const SOFT = process.argv.includes('--soft');

const changes = [];
const note = (s) => { changes.push(s); };

async function setSetting(key, value) {
  const row = await prisma.siteSetting.findFirst({ where: { key } });
  if (!row) { note(`setting ${key}: missing, skipped`); return; }
  if (row.value === value) return;
  await prisma.siteSetting.update({ where: { key }, data: { value } });
  note(`setting ${key}`);
}

/** Replace old contact details anywhere they appear in free text. */
function scrub(v) {
  if (typeof v !== 'string') return v;
  return v
    .split('24x7 Customer Support').join(COMPANY)
    .split('+91 92725 25956').join(PHONE)
    .split('+919272525956').join(PHONE_RAW)
    .split('9272525956').join('9368813078')
    .split('sac794905@gmail.com').join(EMAIL);
}
function scrubDeep(v) {
  if (typeof v === 'string') return scrub(v);
  if (Array.isArray(v)) return v.map(scrubDeep);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, val] of Object.entries(v)) o[k] = scrubDeep(val);
    return o;
  }
  return v;
}

async function main() {
  const marker = await prisma.siteSetting.findFirst({ where: { key: MARKER_KEY } });
  if (marker && marker.value === REVISION) {
    console.log(`[content] revision ${REVISION} already applied — nothing to do.`);
    console.log('[content] admin edits since then are left untouched.');
    return;
  }

  for (const [k, v] of Object.entries(SETTINGS)) await setSetting(k, v);

  // Any remaining stale mentions in other settings (footer text, SEO copy…).
  for (const row of await prisma.siteSetting.findMany({})) {
    if (SETTINGS[row.key] !== undefined) continue;
    const next = scrub(row.value);
    if (next !== row.value) { await prisma.siteSetting.update({ where: { key: row.key }, data: { value: next } }); note(`setting ${row.key} (scrubbed)`); }
  }

  // --- hero: imagery, counters, and the Book Now button --------------------
  const heroRow = await prisma.pageSection.findFirst({ where: { key: 'hero' } });
  if (heroRow) {
    const hero = scrubDeep({ ...heroRow.content });
    hero.imageUrl = IMG.hero;
    hero.imageAlt = COMPANY;
    hero.primaryBtnLink = '#contact';
    hero.primaryBtnIcon = '';
    hero.secondaryBtnText = 'Chat Now';
    hero.secondaryBtnLink = 'https://wa.link/pbjr74';
    hero.secondaryBtnIcon = 'fab fa-whatsapp';
    hero.description = COPY.hero.description;
    hero.stats = [
      { value: 9000, label: 'Jobs Done', accent: false },
      { value: 8500, label: 'Happy Customers', accent: true },
      { value: 70, label: 'Expert Staff', accent: false },
    ];
    await prisma.pageSection.update({ where: { key: 'hero' }, data: { content: hero } });
    note('section hero (images, counters, Book Now)');
  }

  // --- about: three images, matching counters ------------------------------
  const aboutRow = await prisma.pageSection.findFirst({ where: { key: 'about' } });
  if (aboutRow) {
    const about = scrubDeep({ ...aboutRow.content });
    about.images = (about.images || []).map((img, i) => ({ ...img, url: IMG.about[i] || img.url }));
    about.description = COPY.about.description;
    about.features = (about.features || []).map(function (ft, i) {
      return COPY.about.features[i] ? { ...ft, description: COPY.about.features[i] } : ft;
    });
    about.stats = [
      { value: 9000, label: 'Work Done' },
      { value: 8500, label: 'Clients' },
      { value: 70, label: 'Staff' },
    ];
    await prisma.pageSection.update({ where: { key: 'about' }, data: { content: about } });
    note('section about (images, counters)');
  }

  // --- why section: card copy ----------------------------------------------
  const whyRow = await prisma.pageSection.findFirst({ where: { key: 'why' } });
  if (whyRow) {
    const why = scrubDeep({ ...whyRow.content });
    // The last card is a call-to-action tile, not a reason — leave it alone.
    why.description = COPY.intros.why;
    const cards = why.cards || why.items || [];
    let i = 0;
    why[why.cards ? 'cards' : 'items'] = cards.map(function (card) {
      const next = COPY.why[i];
      i += 1;
      return next ? { ...card, description: next } : card;
    });
    await prisma.pageSection.update({ where: { key: 'why' }, data: { content: why } });
    note('section why (card copy)');
  }

  // --- FAQ heading: the intro line above the accordion ---------------------
  const faqRow = await prisma.pageSection.findFirst({ where: { key: 'faq_header' } });
  if (faqRow && faqRow.content && faqRow.content.description !== COPY.intros.faq) {
    const faq = scrubDeep({ ...faqRow.content });
    faq.description = COPY.intros.faq;
    await prisma.pageSection.update({ where: { key: 'faq_header' }, data: { content: faq } });
    note('section faq_header (intro copy)');
  }

  // --- every other section, plus services/testimonials/faqs ----------------
  for (const s of await prisma.pageSection.findMany({})) {
    if (s.key === 'hero' || s.key === 'about' || s.key === 'faq_header') continue;
    const next = scrubDeep(s.content);
    if (JSON.stringify(next) !== JSON.stringify(s.content)) {
      await prisma.pageSection.update({ where: { key: s.key }, data: { content: next } });
      note(`section ${s.key} (scrubbed)`);
    }
  }
  for (const r of await prisma.service.findMany({})) {
    const d = {};
    for (const f of ['title', 'description', 'badge', 'buttonText', 'buttonLink', 'imageAlt']) {
      const n = scrub(r[f]); if (n !== r[f]) d[f] = n;
    }
    if (IMG.services[r.slug] && r.imageUrl !== IMG.services[r.slug]) d.imageUrl = IMG.services[r.slug];
    if (/^tel:/i.test(r.buttonLink || "") && r.buttonIcon !== IMG.serviceButtonIcon) d.buttonIcon = IMG.serviceButtonIcon;
    if (COPY.services[r.slug] && r.description !== COPY.services[r.slug]) d.description = COPY.services[r.slug];
    if (Object.keys(d).length) { await prisma.service.update({ where: { id: r.id }, data: d }); note(`service #${r.id}`); }
  }
  for (const r of await prisma.testimonial.findMany({})) {
    const d = {};
    for (const f of ['name', 'location', 'review']) { const n = scrub(r[f]); if (n !== r[f]) d[f] = n; }
    if (Object.keys(d).length) { await prisma.testimonial.update({ where: { id: r.id }, data: d }); note(`testimonial #${r.id}`); }
  }
  for (const r of await prisma.faq.findMany({})) {
    const d = {};
    for (const f of ['question', 'answer']) { const n = scrub(r[f]); if (n !== r[f]) d[f] = n; }
    if (Object.keys(d).length) { await prisma.faq.update({ where: { id: r.id }, data: d }); note(`faq #${r.id}`); }
  }

  // Record the revision so this never runs a second time and starts fighting
  // with edits made in the admin panel.
  if (marker) {
    await prisma.siteSetting.update({ where: { key: MARKER_KEY }, data: { value: REVISION } });
  } else {
    await prisma.siteSetting.create({
      data: { key: MARKER_KEY, value: REVISION, group: 'general', label: 'Content revision applied', type: 'text', order: 99 },
    });
  }

  content.invalidate();

  console.log(changes.length ? `\n${changes.length} change(s):` : '\nAlready up to date — nothing changed.');
  changes.forEach((c) => console.log('  ' + c));

  // Prove no stale contact details survive anywhere.
  const stale = [];
  const STALE = /24x7 Customer Support|92725|sac794905/;
  for (const r of await prisma.siteSetting.findMany({})) if (STALE.test(String(r.value))) stale.push('setting ' + r.key);
  for (const s of await prisma.pageSection.findMany({})) if (STALE.test(JSON.stringify(s.content))) stale.push('section ' + s.key);
  for (const r of await prisma.faq.findMany({})) if (STALE.test(r.question + r.answer)) stale.push('faq #' + r.id);
  for (const r of await prisma.testimonial.findMany({})) if (STALE.test([r.name, r.location, r.review].join(' '))) stale.push('testimonial #' + r.id);
  console.log(stale.length ? '\nSTILL STALE: ' + stale.join(', ') : '\nNo stale contact details remain.');
}

main()
  .catch((e) => {
    console.error('[content] update failed:', e.message);
    // Under --soft (postinstall) a failure must not fail the deploy: the site
    // still runs, and the update can be re-run by hand or on the next deploy.
    if (!SOFT) process.exitCode = 1;
    else console.error('[content] continuing anyway (--soft); re-run to retry.');
  })
  .finally(() => prisma.$disconnect());
