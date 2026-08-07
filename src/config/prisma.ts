import { PrismaClient } from '@prisma/client';
import { config } from './env';

/**
 * Single shared PrismaClient. In dev we cache it on globalThis so hot-reload
 * (tsx watch) does not exhaust the connection pool with new clients.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: config.isDev ? ['warn', 'error'] : ['error'],
  });

if (config.isDev) globalForPrisma.prisma = prisma;
