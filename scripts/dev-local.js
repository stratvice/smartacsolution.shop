'use strict';
/**
 * One-command local environment.
 *
 *   npm run dev:local
 *
 * Starts a throwaway MySQL (downloaded on first run, cached afterwards),
 * creates the schema, seeds the site content, creates a preview admin login,
 * and starts the app against it. Nothing here touches production: the database
 * lives in a temp directory and is discarded when this process exits.
 *
 * This exists because the project targets MySQL but most machines do not have
 * one installed, and the previous PGlite dev database went away with the
 * PostgreSQL migration.
 */
const { createDB } = require('mysql-memory-server');
const { spawn } = require('child_process');
const path = require('path');

const APP_ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 3000);
const ADMIN_USER = 'preview';
const ADMIN_PASS = 'PreviewLocal1';

function run(script, env) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join('scripts', script)], {
      cwd: APP_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${script} failed:\n${out.slice(-600)}`))
    );
  });
}

async function main() {
  console.log('[dev] starting a local MySQL (first run downloads it, this can take a few minutes)…');
  const db = await createDB({ dbName: 'websaf_dev', logLevel: 'ERROR' });
  console.log(`[dev] MySQL up on port ${db.port}`);

  // Deliberately NOT written to .env: this URL changes every run, and .env is
  // where production-shaped config lives.
  const env = {
    ...process.env,
    DATABASE_URL: `mysql://${db.username}@127.0.0.1:${db.port}/${db.dbName}`,
    JWT_SECRET: 'local-preview-only-' + 'x'.repeat(40),
    NODE_ENV: 'development',
    COOKIE_SECURE: 'false',
    APP_URL: `http://localhost:${PORT}`,
    PORT: String(PORT),
    // Keep a local preview out of the real analytics property.
    ANALYTICS_DISABLED: '1',
  };

  // Start from an empty database every time.
  //
  // Two things conspire otherwise: mysql-memory-server can reuse its data
  // directory between runs (on Windows it cannot always delete it on exit),
  // and db:seed deliberately never overwrites an existing value — that is
  // correct for production, where it must not clobber admin edits. Together
  // they mean a change to a seed default would silently not appear in the
  // preview, which is the one thing a preview must never do.
  console.log('[dev] resetting database…');
  const mysql = require('mysql2/promise');
  const reset = await mysql.createConnection({
    host: '127.0.0.1',
    port: db.port,
    user: db.username,
    database: db.dbName,
    multipleStatements: true,
  });
  const [tables] = await reset.query('SHOW TABLES');
  if (tables.length) {
    const names = tables.map((r) => '`' + Object.values(r)[0] + '`').join(', ');
    await reset.query('SET FOREIGN_KEY_CHECKS = 0; DROP TABLE ' + names + '; SET FOREIGN_KEY_CHECKS = 1;');
    console.log(`[dev] dropped ${tables.length} table(s) from a previous run`);
  }
  await reset.end();

  console.log('[dev] creating schema…');
  await run('init-db.js', env);
  console.log('[dev] seeding content…');
  await run('seed.js', env);

  // Replacement images, if any have been staged. Runs after the seed so it
  // overwrites the seeded defaults rather than being overwritten by them.
  const fs = require('fs');
  const staged = path.join(APP_ROOT, 'public', 'images', 'new');
  if (fs.existsSync(staged) && fs.readdirSync(staged).some((f) => /^[1-7]\./i.test(f))) {
    console.log('[dev] applying staged images…');
    const out = await run('apply-images.js', env);
    out.split('\n').filter((l) => /->/.test(l)).forEach((l) => console.log('   ' + l.trim()));
  }

  console.log('[dev] creating preview admin…');
  await new Promise((resolve, reject) => {
    const p = spawn(
      process.execPath,
      ['scripts/create-admin.js', '--email', 'preview@example.com', '--username', ADMIN_USER, '--password', ADMIN_PASS],
      { cwd: APP_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(out.slice(-400)))));
  });

  const server = spawn(process.execPath, ['src/server.js'], {
    cwd: APP_ROOT,
    env,
    stdio: 'inherit',
  });

  console.log(`
  ${'='.repeat(58)}
  LOCAL PREVIEW  —  http://localhost:${PORT}
  Admin          —  http://localhost:${PORT}/admin/login
  Login          —  ${ADMIN_USER} / ${ADMIN_PASS}

  Throwaway database. Nothing here touches production.
  Ctrl+C to stop.
  ${'='.repeat(58)}
`);

  const shutdown = async () => {
    server.kill();
    try { await db.stop(); } catch { /* already gone */ }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  server.on('close', shutdown);
}

main().catch((e) => {
  console.error('[dev] failed:', e.message);
  process.exit(1);
});
