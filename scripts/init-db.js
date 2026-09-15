'use strict';
/**
 * Create the schema. Reads db/schema.sql and applies it statement by statement.
 *
 * Idempotent: every CREATE is `IF NOT EXISTS`, so re-running against a live
 * database is safe and leaves existing rows untouched.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const prisma = require('../src/lib/prisma');

async function main() {
  const file = path.join(__dirname, '..', 'db', 'schema.sql');
  const sql = fs.readFileSync(file, 'utf8');

  // Split on semicolons at end of line; the schema has no procedures or
  // semicolons inside string literals, so this is sufficient here.
  const statements = sql
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter((s) => s && !/^--/.test(s));

  let applied = 0;
  for (const stmt of statements) {
    await prisma.$executeRawUnsafe(stmt);
    applied++;
  }

  const tables = await prisma.$queryRawUnsafe('SHOW TABLES');
  console.log(`[init-db] applied ${applied} statements`);
  console.log(`[init-db] tables: ${tables.map((r) => Object.values(r)[0]).join(', ')}`);
}

main()
  .catch((err) => {
    console.error('[init-db] failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
