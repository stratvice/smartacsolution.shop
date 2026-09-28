'use strict';
/**
 * Cache-busting for the static files that do not carry a hash in their name.
 *
 * public/ is served with a seven-day max-age, which is right for bytes that
 * never change and wrong for style.css and the page scripts: a deploy changes
 * them, and every visitor who has been here before keeps the old copy for a
 * week. That is not theoretical — shipping markup that depended on new CSS
 * left returning visitors with unstyled links.
 *
 * Images already solve this by putting a content hash in the filename. These
 * are referenced by a fixed path, so the hash goes in the query string
 * instead: the URL changes whenever the bytes do, and not otherwise.
 *
 * Hashed once per process, which is safe because a deploy starts a new one and
 * builds into a fresh directory.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
const cache = new Map();

/**
 * `/style.css` -> `/style.css?v=1a2b3c4d`
 *
 * A file that cannot be read returns the plain path: a missing stylesheet is
 * worth a broken page, but not a 500.
 */
function asset(urlPath) {
  if (cache.has(urlPath)) return cache.get(urlPath);

  let out = urlPath;
  try {
    const clean = String(urlPath).split('?')[0].replace(/^\/+/, '');
    const file = path.join(PUBLIC_DIR, clean);
    // Stay inside public/: the argument comes from our own templates, but a
    // path helper that can read anything is a bad thing to leave lying around.
    if (file.startsWith(PUBLIC_DIR)) {
      const hash = crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 8);
      out = urlPath + (urlPath.includes('?') ? '&' : '?') + 'v=' + hash;
    }
  } catch (err) {
    /* fall through to the unversioned path */
  }

  cache.set(urlPath, out);
  return out;
}

module.exports = { asset };
