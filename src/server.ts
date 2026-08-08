import { createApp } from './app';
import { config } from './config/env';
import { prisma } from './config/prisma';
import { logger } from './config/logger';

// Prisma returns BigInt for byte-size columns (e.g. media sizeBytes). JSON.stringify
// throws on BigInt, so teach it to serialize as a plain number for API responses.
(BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function () {
  return Number(this);
};

async function bootstrap() {
  try {
    await prisma.$connect();
    logger.info('✓ Connected to PostgreSQL');
  } catch (err) {
    logger.error('Failed to connect to the database. Is PostgreSQL running and DATABASE_URL correct?', err);
    process.exit(1);
  }

  // All protected media lives in Cloudflare R2 — no local disk to prepare on boot.

  // Ensure the external-app modules (CRM / ERP / HCM) exist so a super admin can set
  // their links from Admin → Modules. Idempotent: `update: {}` never clobbers an
  // admin's configured name/URL on redeploy. Each card stays hidden from users until
  // its externalUrl is set.
  const EXTERNAL_APPS = [
    { key: 'CRM', name: 'CRM', description: 'Customer relationship management', icon: 'Contact', color: '#2563eb', sortOrder: 100 },
    { key: 'ERP', name: 'ERP', description: 'Enterprise resource planning', icon: 'Boxes', color: '#7c3aed', sortOrder: 101 },
    { key: 'HCM', name: 'HCM', description: 'Human capital management', icon: 'UsersRound', color: '#059669', sortOrder: 102 },
  ];
  try {
    for (const a of EXTERNAL_APPS) {
      await prisma.module.upsert({
        where: { key: a.key },
        update: {},
        create: { ...a, isExternal: true, isActive: true, isCore: false },
      });
    }
  } catch (err) {
    logger.error('Failed to ensure external-app modules', err);
  }

  // Normalize the Training module's display name (older data seeded it as
  // "Learning & Training" / "LMS"). The key stays "LMS" for routes & permissions.
  try {
    await prisma.module.updateMany({
      where: { key: 'LMS', OR: [{ name: { contains: 'Learning' } }, { name: 'LMS' }] },
      data: { name: 'Training' },
    });
  } catch (err) {
    logger.error('Failed to normalize the Training module name', err);
  }

  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info(`🚀 MTANDT Platform API listening on port ${config.port}`);
    logger.info(`   API base : ${config.apiPrefix}`);
    logger.info(`   Docs     : /api/docs`);
    logger.info(`   Env      : ${config.env}`);
  });

  const shutdown = async (signal: string) => {
    logger.warn(`${signal} received — shutting down gracefully...`);
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void bootstrap();
