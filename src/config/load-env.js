'use strict';
/**
 * Environment loading that survives atomic deploys.
 *
 * Hostinger (and any deploy system that builds into a new versioned directory
 * and flips a `current` symlink) throws away the previous directory, so a
 * `.env` written next to the app disappears on the next deploy and the server
 * stops booting.
 *
 * So: load the local `.env` first, then walk up the directory tree looking for
 * a `.env.shared` kept *outside* the versioned tree and use it to fill in
 * anything still unset. dotenv never overwrites a variable that is already
 * defined, so the precedence is:
 *
 *   real environment (hPanel SetEnv, systemd, CI)  >  ./.env  >  ../.env.shared
 *
 * Nothing here is required: with all three absent the app falls back to
 * config/env.js's own validation and fails with a clear message.
 */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const APP_ROOT = path.join(__dirname, '..', '..');
const SHARED_NAME = '.env.shared';
const MAX_LEVELS = 6;

let loaded = false;

function load() {
  if (loaded) return;
  loaded = true;

  const local = path.join(APP_ROOT, '.env');
  if (fs.existsSync(local)) dotenv.config({ path: local });
  else dotenv.config();

  // Walk upward for a shared file kept outside the versioned build directory.
  let dir = APP_ROOT;
  for (let i = 0; i < MAX_LEVELS; i++) {
    const candidate = path.join(dir, SHARED_NAME);
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate });
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached the filesystem root
    dir = parent;
  }
}

load();

module.exports = { load, APP_ROOT, SHARED_NAME };
