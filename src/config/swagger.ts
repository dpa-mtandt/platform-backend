import swaggerJsdoc from 'swagger-jsdoc';
import { config } from './env';

export const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'MTANDT Enterprise Platform API',
      version: '0.1.0',
      description:
        'Unified API for the MTANDT Enterprise Platform. Phase 0 exposes the shared core: auth, users, roles, permissions, modules, org, notifications, settings, and audit.',
    },
    servers: [{ url: config.apiPrefix }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
  },
  apis: ['src/modules/**/*.routes.ts'],
});
