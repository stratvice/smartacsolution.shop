'use strict';
/**
 * Minimal Prisma-compatible data layer over mysql2.
 *
 * Why this exists: Prisma ships its query engine as a native Rust binary, and
 * that binary panics inside Hostinger's CloudLinux LVE container (both the
 * library and binary engine types, on a query as small as `SELECT 1`). The
 * hosting plan runs Node and MySQL perfectly well, so the fix is to drop the
 * native engine rather than the host.
 *
 * This module keeps the exact call shapes the rest of the app already uses —
 * `prisma.lead.findMany({ where, orderBy, take })` and friends — so no route,
 * service or script had to change. It implements only the subset of the Prisma
 * client this project actually calls; anything else throws loudly rather than
 * silently returning the wrong rows.
 *
 * Column metadata is introspected from the database on first use, so boolean
 * (TINYINT(1)) and JSON columns are converted in both directions without a
 * hand-maintained schema map.
 */
// Load .env here rather than in each entry point: scripts and the server
// both reach the database through this module. dotenv never overrides a
// variable the environment already set, so hPanel SetEnv still wins.
require('../config/load-env');
const mysql = require('mysql2/promise');

// ------------------------------------------------------------- connection

/** Parse DATABASE_URL, honouring the ?socket= form Hostinger requires. */
function parseUrl(raw) {
  if (!raw) throw new Error('DATABASE_URL is not set.');
  const u = new URL(raw);
  if (u.protocol !== 'mysql:') {
    throw new Error(`DATABASE_URL must start with mysql:// (got ${u.protocol}//)`);
  }
  const socketPath = u.searchParams.get('socket');
  const cfg = {
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
    dateStrings: false,
    supportBigNumbers: true,
    connectionLimit: Number(process.env.DB_POOL_SIZE || 5),
    waitForConnections: true,
    charset: 'utf8mb4',
  };
  // A socket beats host/port: Hostinger's MySQL does not listen on TCP.
  if (socketPath) cfg.socketPath = socketPath;
  else {
    cfg.host = u.hostname;
    cfg.port = Number(u.port || 3306);
  }
  return cfg;
}

let pool = null;
function getPool() {
  if (!pool) pool = mysql.createPool(parseUrl(process.env.DATABASE_URL));
  return pool;
}

async function raw(sql, params = []) {
  const [rows] = await getPool().query(sql, params);
  return rows;
}

// -------------------------------------------------------------- metadata

const MODELS = {
  admin: 'admins',
  pageSection: 'page_sections',
  service: 'services',
  testimonial: 'testimonials',
  faq: 'faqs',
  lead: 'leads',
  leadNote: 'lead_notes',
  media: 'media',
  siteSetting: 'site_settings',
};

/**
 * Columns holding JSON that the server may not report as such. MariaDB
 * implements JSON as LONGTEXT plus a json_valid() CHECK constraint, so
 * SHOW COLUMNS says "longtext" and type sniffing alone would hand the driver
 * a raw object (which stringifies to "[object Object]" and trips the check).
 */
const JSON_COLUMNS = {
  page_sections: ["content"],
};

const metaCache = new Map();

/** Column types for a table, read once and cached for the process lifetime. */
async function meta(table) {
  if (metaCache.has(table)) return metaCache.get(table);
  const cols = await raw(`SHOW COLUMNS FROM \`${table}\``);
  const info = { columns: [], bool: new Set(), json: new Set(), date: new Set() };
  for (const c of cols) {
    const type = String(c.Type).toLowerCase();
    info.columns.push(c.Field);
    if (type === 'tinyint(1)') info.bool.add(c.Field);
    else if (type === 'json') info.json.add(c.Field);
    else if (type.startsWith('datetime') || type.startsWith('timestamp')) info.date.add(c.Field);
  }
  for (const c of JSON_COLUMNS[table] || []) {
    if (info.columns.includes(c)) info.json.add(c);
  }
  info.hasUpdatedAt = info.columns.includes('updatedAt');
  metaCache.set(table, info);
  return info;
}

/** DB row -> the shape the app expects (booleans, parsed JSON). */
function fromRow(row, info) {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (info.bool.has(k)) out[k] = v === null ? null : Boolean(v);
    else if (info.json.has(k) && typeof v === 'string') {
      try {
        out[k] = JSON.parse(v);
      } catch {
        out[k] = v;
      }
    } else out[k] = v;
  }
  return out;
}

/** App value -> a value mysql2 can bind. */
function toParam(field, value, info) {
  if (value === undefined) return undefined;
  if (info.json.has(field)) return JSON.stringify(value === null ? null : value);
  if (typeof value === 'boolean') return value ? 1 : 0;
  // Any other plain object/array is JSON too: never let one reach the driver
  // and arrive as "[object Object]".
  if (value !== null && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    return JSON.stringify(value);
  }
  return value;
}

// ------------------------------------------------------- where / orderBy

const OPS = { gt: '>', gte: '>=', lt: '<', lte: '<=', equals: '=', not: '<>' };

/** Compile a Prisma-style `where` object into SQL + bound params. */
function buildWhere(where, info, params) {
  if (!where || !Object.keys(where).length) return '';
  const parts = [];

  for (const [key, val] of Object.entries(where)) {
    if (val === undefined) continue;

    if (key === 'OR' || key === 'AND') {
      const sub = val
        .map((w) => buildWhere(w, info, params))
        .filter(Boolean)
        .map((s) => `(${s})`);
      if (sub.length) parts.push(sub.join(key === 'OR' ? ' OR ' : ' AND '));
      continue;
    }

    const col = `\`${key}\``;
    if (val === null) {
      parts.push(`${col} IS NULL`);
    } else if (typeof val === 'object' && !(val instanceof Date) && !Array.isArray(val)) {
      for (const [op, operand] of Object.entries(val)) {
        if (operand === undefined) continue;
        if (op === 'contains') {
          parts.push(`${col} LIKE ?`);
          params.push(`%${operand}%`);
        } else if (op === 'startsWith') {
          parts.push(`${col} LIKE ?`);
          params.push(`${operand}%`);
        } else if (op === 'in') {
          if (!operand.length) parts.push('1=0');
          else {
            parts.push(`${col} IN (${operand.map(() => '?').join(',')})`);
            params.push(...operand);
          }
        } else if (op === 'mode') {
          // Collation is already case-insensitive; nothing to emit.
          continue;
        } else if (OPS[op]) {
          if (operand === null) {
            parts.push(op === 'not' ? `${col} IS NOT NULL` : `${col} IS NULL`);
          } else {
            parts.push(`${col} ${OPS[op]} ?`);
            params.push(toParam(key, operand, info));
          }
        } else {
          throw new Error(`Unsupported filter operator: ${key}.${op}`);
        }
      }
    } else {
      parts.push(`${col} = ?`);
      params.push(toParam(key, val, info));
    }
  }
  return parts.join(' AND ');
}

function buildOrder(orderBy) {
  if (!orderBy) return '';
  const list = Array.isArray(orderBy) ? orderBy : [orderBy];
  const parts = [];
  for (const o of list) {
    for (const [field, dir] of Object.entries(o)) {
      parts.push(`\`${field}\` ${String(dir).toLowerCase() === 'desc' ? 'DESC' : 'ASC'}`);
    }
  }
  return parts.length ? ` ORDER BY ${parts.join(', ')}` : '';
}

function buildSelect(select, info) {
  if (!select) return '*';
  const cols = Object.entries(select)
    .filter(([, v]) => v)
    .map(([k]) => `\`${k}\``);
  return cols.length ? cols.join(', ') : '*';
}

function limitClause(args) {
  let sql = '';
  if (args.take !== undefined) sql += ` LIMIT ${Number(args.take)}`;
  if (args.skip !== undefined) {
    if (args.take === undefined) sql += ' LIMIT 18446744073709551615';
    sql += ` OFFSET ${Number(args.skip)}`;
  }
  return sql;
}

// ---------------------------------------------------------------- models

function model(name, table) {
  const api = {
    async findMany(args = {}) {
      const info = await meta(table);
      const params = [];
      const where = buildWhere(args.where, info, params);
      let sql = `SELECT ${args.distinct ? 'DISTINCT ' : ''}${buildSelect(args.select, info)} FROM \`${table}\``;
      if (where) sql += ` WHERE ${where}`;
      sql += buildOrder(args.orderBy) + limitClause(args);
      const rows = (await raw(sql, params)).map((r) => fromRow(r, info));
      return args.include ? withInclude(rows, args.include) : rows;
    },

    async findFirst(args = {}) {
      const rows = await api.findMany({ ...args, take: 1 });
      return rows[0] || null;
    },

    async findUnique(args = {}) {
      return api.findFirst({ where: args.where, select: args.select, include: args.include });
    },

    async count(args = {}) {
      const info = await meta(table);
      const params = [];
      const where = buildWhere(args.where, info, params);
      let sql = `SELECT COUNT(*) AS n FROM \`${table}\``;
      if (where) sql += ` WHERE ${where}`;
      const rows = await raw(sql, params);
      return Number(rows[0].n);
    },

    async create(args) {
      const info = await meta(table);
      const data = { ...args.data };
      if (info.hasUpdatedAt && data.updatedAt === undefined) data.updatedAt = new Date();
      const fields = Object.keys(data).filter(
        (f) => info.columns.includes(f) && data[f] !== undefined
      );
      const sql =
        `INSERT INTO \`${table}\` (${fields.map((f) => `\`${f}\``).join(', ')}) ` +
        `VALUES (${fields.map(() => '?').join(', ')})`;
      const params = fields.map((f) => toParam(f, data[f], info));
      const [res] = await getPool().query(sql, params);
      return api.findFirst({ where: { id: res.insertId } });
    },

    async createMany(args) {
      const rows = Array.isArray(args.data) ? args.data : [args.data];
      let count = 0;
      for (const d of rows) {
        await api.create({ data: d });
        count++;
      }
      return { count };
    },

    async update(args) {
      const info = await meta(table);
      const data = { ...args.data };
      if (info.hasUpdatedAt && data.updatedAt === undefined) data.updatedAt = new Date();
      const fields = Object.keys(data).filter(
        (f) => info.columns.includes(f) && data[f] !== undefined
      );
      const params = fields.map((f) => toParam(f, data[f], info));
      const whereParams = [];
      const where = buildWhere(args.where, info, whereParams);
      if (!where) throw new Error(`update on ${name} requires a where clause`);
      const sql =
        `UPDATE \`${table}\` SET ${fields.map((f) => `\`${f}\` = ?`).join(', ')} WHERE ${where}`;
      await raw(sql, [...params, ...whereParams]);
      return api.findFirst({ where: args.where });
    },

    async upsert(args) {
      const existing = await api.findFirst({ where: args.where });
      if (existing) {
        // Prisma treats an empty `update` as "leave the row alone".
        if (args.update && Object.keys(args.update).length) {
          return api.update({ where: args.where, data: args.update });
        }
        return existing;
      }
      return api.create({ data: args.create });
    },

    async delete(args) {
      const info = await meta(table);
      const params = [];
      const where = buildWhere(args.where, info, params);
      if (!where) throw new Error(`delete on ${name} requires a where clause`);
      const row = await api.findFirst({ where: args.where });
      await raw(`DELETE FROM \`${table}\` WHERE ${where}`, params);
      return row;
    },

    async deleteMany(args = {}) {
      const info = await meta(table);
      const params = [];
      const where = buildWhere(args.where, info, params);
      const sql = `DELETE FROM \`${table}\`${where ? ` WHERE ${where}` : ''}`;
      const [res] = await getPool().query(sql, params);
      return { count: res.affectedRows };
    },

    /** Only the `by` + `_count: { _all: true }` form the dashboards use. */
    async groupBy(args) {
      const info = await meta(table);
      const by = args.by.map((f) => `\`${f}\``).join(', ');
      const params = [];
      const where = buildWhere(args.where, info, params);
      let sql = `SELECT ${by}, COUNT(*) AS _all FROM \`${table}\``;
      if (where) sql += ` WHERE ${where}`;
      sql += ` GROUP BY ${by}`;
      const rows = await raw(sql, params);
      return rows.map((r) => {
        const out = { _count: { _all: Number(r._all) } };
        for (const f of args.by) out[f] = r[f];
        return out;
      });
    },
  };
  return api;
}

/**
 * Relation loading. The app only ever pulls a lead's note trail (with each
 * note's author), so that is the single relation implemented here.
 */
async function withInclude(rows, include) {
  if (!rows.length || !include.leadNotes) return rows;
  const opts = include.leadNotes === true ? {} : include.leadNotes;
  const ids = rows.map((r) => r.id);
  const noteInfo = await meta('lead_notes');
  let sql = `SELECT * FROM \`lead_notes\` WHERE \`leadId\` IN (${ids.map(() => '?').join(',')})`;
  sql += buildOrder(opts.orderBy || { createdAt: 'desc' });
  if (opts.take) sql += ` LIMIT ${Number(opts.take)}`;
  const notes = (await raw(sql, ids)).map((r) => fromRow(r, noteInfo));

  // Attach each note's admin when the caller asked for it.
  const wantsAdmin = opts.include && opts.include.admin;
  if (wantsAdmin) {
    const adminIds = [...new Set(notes.map((n) => n.adminId).filter(Boolean))];
    let admins = [];
    if (adminIds.length) {
      const adminInfo = await meta('admins');
      admins = (
        await raw(
          `SELECT * FROM \`admins\` WHERE \`id\` IN (${adminIds.map(() => '?').join(',')})`,
          adminIds
        )
      ).map((r) => fromRow(r, adminInfo));
    }
    const byId = new Map(admins.map((a) => [a.id, a]));
    for (const n of notes) {
      const a = n.adminId ? byId.get(n.adminId) : null;
      n.admin = a ? { username: a.username, name: a.name } : null;
    }
  }

  const byLead = new Map(rows.map((r) => [r.id, []]));
  for (const n of notes) if (byLead.has(n.leadId)) byLead.get(n.leadId).push(n);
  for (const r of rows) r.leadNotes = byLead.get(r.id) || [];
  return rows;
}

// ---------------------------------------------------------------- client

const client = {
  /**
   * Prisma's array form receives promises that are already running, so this
   * awaits them together. Note this is not a real SQL transaction — the app
   * only uses it to batch independent setting writes.
   */
  async $transaction(ops) {
    if (typeof ops === 'function') throw new Error('$transaction(callback) is not supported');
    return Promise.all(ops);
  },

  /** Tagged-template form: prisma.$queryRaw`SELECT 1`. */
  async $queryRaw(strings, ...values) {
    const sql = Array.isArray(strings) ? strings.raw.join('?') : strings;
    return raw(sql, values);
  },

  async $queryRawUnsafe(sql, ...params) {
    return raw(sql, params);
  },

  async $executeRawUnsafe(sql, ...params) {
    const [res] = await getPool().query(sql, params);
    return res.affectedRows;
  },

  async $disconnect() {
    if (pool) {
      await pool.end();
      pool = null;
      metaCache.clear();
    }
  },
};

for (const [name, table] of Object.entries(MODELS)) client[name] = model(name, table);

module.exports = client;
