'use strict';
const { PrismaClient } = require('@prisma/client');
const env = require('../config/env');

const prisma = new PrismaClient({
  log: env.isProd ? ['error'] : ['error', 'warn'],
});

module.exports = prisma;
