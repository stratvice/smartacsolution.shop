'use strict';
/**
 * Database backup: one gzipped mysqldump per run, with rotation.
 *
 *   node scripts/backup-db.js
 *
 * Connection details come from DATABASE_URL, so there is nothing to configure
 * twice and no credential in this file or in the cron line. The password is
 * passed to mysqldump via MYSQL_PWD rather than argv, so it does not appear in
 * the process list where any other user on a shared host could read it.
 *
 * Backups are written OUTSIDE the deployed tree (BACKUP_DIR, defaulting to a
 * sibling of the app) for the same reason uploads are: a release-per-directory
 * host deletes the previous deploy, and a backup that dies with the thing it
 * was protecting is not a backup.
 */
require('../src/config/load-env');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const os = require('os');

const KEEP = Number(process.env.BACKUP_KEEP || 14);

function parseDatabaseUrl(raw) {
  if (!raw) throw new Error('DATABASE_URL is not set.');
  const u = new URL(raw);
  return {
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
    socket: u.searchParams.get('socket'),
    host: u.hostname,
    port: u.port || '3306',
  };
}

function backupDir() {
  if (process.env.BACKUP_DIR) return path.resolve(process.env.BACKUP_DIR);
  // Default: a "backups" folder beside the app's deploy root, not inside it.
  return path.join(path.dirname(path.dirname(path.join(__dirname, '..'))), 'backups');
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

/** Delete all but the newest KEEP backups. */
function rotate(dir) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^db-.*\.sql\.gz$/.test(f))
    .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  const stale = files.slice(KEEP);
  for (const s of stale) fs.unlinkSync(path.join(dir, s.f));
  return { kept: Math.min(files.length, KEEP), removed: stale.length };
}

function main() {
  const cfg = parseDatabaseUrl(process.env.DATABASE_URL);
  const dir = backupDir();
  fs.mkdirSync(dir, { recursive: true });

  const outPath = path.join(dir, `db-${cfg.database}-${stamp()}.sql.gz`);
  const tmpPath = path.join(os.tmpdir(), `backup-${process.pid}.sql`);

  const args = [
    '--user=' + cfg.user,
    '--single-transaction', // consistent snapshot without locking the site out
    '--quick',
    '--default-character-set=utf8mb4',
    '--no-tablespaces', // shared hosting rarely grants the PROCESS privilege
    '--result-file=' + tmpPath,
  ];
  if (cfg.socket) args.push('--socket=' + cfg.socket);
  else args.push('--host=' + cfg.host, '--port=' + cfg.port);
  args.push(cfg.database);

  execFile(
    'mysqldump',
    args,
    { env: { ...process.env, MYSQL_PWD: cfg.password }, maxBuffer: 1024 * 1024 * 64 },
    (err, _stdout, stderr) => {
      if (err) {
        // Never echo the dump's stderr wholesale; it can quote connection args.
        console.error('[backup] mysqldump failed:', String(stderr || err.message).slice(0, 200));
        try { fs.unlinkSync(tmpPath); } catch { /* nothing to clean up */ }
        process.exitCode = 1;
        return;
      }

      const raw = fs.createReadStream(tmpPath);
      const gz = zlib.createGzip({ level: 9 });
      const out = fs.createWriteStream(outPath);
      raw.pipe(gz).pipe(out);

      out.on('finish', () => {
        try { fs.unlinkSync(tmpPath); } catch { /* already gone */ }
        const size = fs.statSync(outPath).size;
        const { kept, removed } = rotate(dir);
        console.log(`[backup] wrote ${outPath} (${(size / 1024).toFixed(1)} KB)`);
        console.log(`[backup] keeping ${kept} backup(s); removed ${removed} older than the last ${KEEP}`);
      });
      out.on('error', (e) => {
        console.error('[backup] could not write archive:', e.message);
        process.exitCode = 1;
      });
    }
  );
}

try {
  main();
} catch (e) {
  console.error('[backup] failed:', e.message);
  process.exitCode = 1;
}
