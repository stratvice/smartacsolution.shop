'use strict';
/**
 * Wire replacement images into the seven image slots on the landing page.
 *
 *   node scripts/apply-images.js
 *
 * Drop files named 1..7 (any image extension) into public/images/new/, then run
 * this. It copies them into public/images/ under stable names and repoints both
 * the hero/about sections and the three service cards.
 *
 * Slots, matching the numbering used when the replacements were chosen:
 *   1        hero collage
 *   2, 3, 4  the About section's three images
 *   5, 6, 7  Split / Window / Ductless service cards
 *
 * Safe to re-run: only the slots with a file present are touched, and the file
 * name carries a content hash so a replaced image is never served from cache.
 */
require('../src/config/load-env');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const prisma = require('../src/lib/prisma');
const content = require('../src/services/content');

const SRC_DIR = path.join(__dirname, '..', 'public', 'images', 'new');
const OUT_DIR = path.join(__dirname, '..', 'public', 'images');
const EXTS = ['.webp', '.jpg', '.jpeg', '.png', '.avif', '.gif'];

const SLOTS = {
  1: { kind: 'hero', name: 'hero-collage', alt: null },
  2: { kind: 'about', index: 0, name: 'about-1', alt: 'Technician servicing a split AC' },
  3: { kind: 'about', index: 1, name: 'about-2', alt: 'Technician cleaning an AC unit' },
  4: { kind: 'about', index: 2, name: 'about-3', alt: 'Deep cleaning an AC indoor unit' },
  5: { kind: 'service', slug: 'split-ac-repair', name: 'split-ac-repair' },
  6: { kind: 'service', slug: 'window-ac-repair', name: 'window-ac-repair' },
  7: { kind: 'service', slug: 'ductless-ac-repair', name: 'ductless-ac-repair' },
};

/** Find the file for slot N regardless of extension. */
function findSource(n) {
  if (!fs.existsSync(SRC_DIR)) return null;
  for (const f of fs.readdirSync(SRC_DIR)) {
    const ext = path.extname(f).toLowerCase();
    if (path.basename(f, ext) === String(n) && EXTS.includes(ext)) return path.join(SRC_DIR, f);
  }
  return null;
}

/**
 * Copy into public/images with a content hash in the name. Browsers and the
 * CDN cache aggressively by URL, so reusing a file name would leave visitors
 * looking at the old picture.
 */
function publish(srcPath, baseName) {
  const buf = fs.readFileSync(srcPath);
  const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 8);
  const ext = path.extname(srcPath).toLowerCase();
  const fileName = `${baseName}-${hash}${ext}`;
  fs.writeFileSync(path.join(OUT_DIR, fileName), buf);
  return { url: `/images/${fileName}`, kb: Math.round(buf.length / 1024) };
}

async function main() {
  const applied = [];
  const missing = [];

  // Sections are JSON blobs, so read once, mutate, write once per section.
  const heroRow = await prisma.pageSection.findFirst({ where: { key: 'hero' } });
  const aboutRow = await prisma.pageSection.findFirst({ where: { key: 'about' } });
  const hero = heroRow ? { ...heroRow.content } : null;
  const about = aboutRow ? { ...aboutRow.content } : null;
  if (about) about.images = (about.images || []).map((i) => ({ ...i }));

  for (const [n, slot] of Object.entries(SLOTS)) {
    const src = findSource(n);
    if (!src) { missing.push(n); continue; }
    const { url, kb } = publish(src, slot.name);

    if (slot.kind === 'hero' && hero) {
      const previous = hero.imageUrl;
      hero.imageUrl = url;
      applied.push(`${n}  hero collage            -> ${url} (${kb} KB)`);

      // The social/search preview image usually points at the same file as the
      // hero. If it still points at the image just replaced, repoint it too --
      // otherwise a WhatsApp or Google preview keeps showing the old picture
      // long after the page itself changed, which is easy to miss.
      const og = await prisma.siteSetting.findFirst({ where: { key: 'seo_og_image' } });
      if (og && previous && og.value === previous) {
        await prisma.siteSetting.update({ where: { key: 'seo_og_image' }, data: { value: url } });
        applied.push(`   og:image (share preview) -> ${url}`);
      }
    } else if (slot.kind === 'about' && about) {
      if (!about.images[slot.index]) about.images[slot.index] = {};
      about.images[slot.index].url = url;
      if (slot.alt) about.images[slot.index].alt = slot.alt;
      applied.push(`${n}  about image ${slot.index + 1}          -> ${url} (${kb} KB)`);
    } else if (slot.kind === 'service') {
      const svc = await prisma.service.findFirst({ where: { slug: slot.slug } });
      if (!svc) { applied.push(`${n}  service ${slot.slug}: NOT FOUND, skipped`); continue; }
      await prisma.service.update({ where: { id: svc.id }, data: { imageUrl: url } });
      applied.push(`${n}  ${svc.title.padEnd(22)}-> ${url} (${kb} KB)`);
    }
  }

  if (hero) await prisma.pageSection.update({ where: { key: 'hero' }, data: { content: hero } });
  if (about) await prisma.pageSection.update({ where: { key: 'about' }, data: { content: about } });
  content.invalidate();

  console.log(applied.length ? '\nApplied:' : '\nNothing applied.');
  applied.forEach((l) => console.log('  ' + l));
  if (missing.length) console.log(`\nNo file found for slot(s): ${missing.join(', ')} — left unchanged.`);
  console.log(`\nDrop files named 1..7 into ${SRC_DIR}`);
}

main()
  .catch((e) => { console.error('apply-images failed:', e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
