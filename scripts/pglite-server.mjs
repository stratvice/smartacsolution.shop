/**
 * DEV-ONLY local Postgres.
 *
 * Runs PGlite (Postgres compiled to WASM) behind a real Postgres wire-protocol
 * socket, so Prisma can migrate and query it exactly like a hosted Postgres.
 * Use this only for local development/testing — point DATABASE_URL at your
 * real Postgres (Neon, Supabase, RDS…) for anything else.
 *
 *   node scripts/pglite-server.mjs
 *   DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5433/postgres"
 */
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.PGLITE_DIR || path.join(__dirname, '..', '.pglite-data');
const port = Number(process.env.PGLITE_PORT || 5433);

const db = await PGlite.create({ dataDir });
const server = new PGLiteSocketServer({ db, port, host: '0.0.0.0' });
await server.start();

console.log(`PGlite listening on 127.0.0.1:${port}`);
console.log(`data dir: ${dataDir}`);

async function stop() {
  await server.stop();
  await db.close();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
