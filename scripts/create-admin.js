#!/usr/bin/env node
'use strict';
/**
 * Creates (or updates) an admin account.
 *
 *   npm run create:admin                     -> interactive prompts
 *   npm run create:admin -- --email a@b.c --username admin --password 'Secret123'
 *
 * The password is read from a prompt (hidden) or --password, hashed with
 * bcrypt, and only the hash is ever written to the database.
 */
const readline = require('readline');
const prisma = require('../src/lib/prisma');
const { hashPassword, passwordProblem } = require('../src/lib/auth');
const env = require('../src/config/env');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

function ask(question, { hidden = false } = {}) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });

  if (!hidden) {
    return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a.trim()); }));
  }

  // Hidden input: suppress echo while the user types.
  return new Promise((resolve) => {
    const onData = (char) => {
      const s = String(char);
      if (s === '\n' || s === '\r' || s === '') {
        process.stdin.removeListener('data', onData);
      } else {
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
        process.stdout.write(question + '*'.repeat(rl.line.length));
      }
    };
    process.stdin.on('data', onData);
    rl.question(question, (a) => {
      rl.close();
      process.stdout.write('\n');
      resolve(a.trim());
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let email = args.email || env.seedAdmin.email;
  let username = args.username || env.seedAdmin.username;
  let password = args.password || env.seedAdmin.password;

  if (!args.email && !args.password) {
    console.log('\nCreate an admin account\n');
    const e = await ask(`Email [${email}]: `);
    if (e) email = e;
    const u = await ask(`Username [${username}]: `);
    if (u) username = u;
  }

  email = String(email).trim().toLowerCase();
  username = String(username).trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    console.error(`\n  Invalid email: ${email}\n`);
    process.exit(1);
  }
  if (username.length < 3) {
    console.error('\n  Username must be at least 3 characters.\n');
    process.exit(1);
  }

  while (!password) {
    password = await ask('Password: ', { hidden: true });
    const problem = passwordProblem(password);
    if (problem) {
      console.error(`  ${problem}`);
      password = '';
      continue;
    }
    const again = await ask('Confirm password: ', { hidden: true });
    if (again !== password) {
      console.error('  Passwords do not match.');
      password = '';
    }
  }

  const problem = passwordProblem(password);
  if (problem) {
    console.error(`\n  ${problem}\n`);
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const existing = await prisma.admin.findFirst({
    where: { OR: [{ email }, { username }] },
  });

  if (existing) {
    await prisma.admin.update({
      where: { id: existing.id },
      data: { email, username, passwordHash, isActive: true },
    });
    console.log(`\n  Updated existing admin "${username}" (${email}).`);
  } else {
    await prisma.admin.create({
      data: { email, username, passwordHash, name: args.name || null, role: 'ADMIN' },
    });
    console.log(`\n  Created admin "${username}" (${email}).`);
  }

  console.log(`  Sign in at ${env.appUrl}/admin/login\n`);
}

main()
  .catch((e) => {
    console.error('\n  Failed:', e.message, '\n');
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
