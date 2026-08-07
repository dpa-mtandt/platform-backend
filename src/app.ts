import express, { type Application, type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import swaggerUi from 'swagger-ui-express';

import { config } from './config/env';
import { swaggerSpec } from './config/swagger';
import { apiLimiter } from './middleware/rateLimit';
import { auditContext } from './middleware/audit';
import { notFound, errorHandler } from './middleware/error';
import apiRouter from './routes';

export function createApp(): Application {
  const app = express();

  if (config.isProd) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  const appOrigins = config.cors.origin;

  // ── Security headers (OWASP A05) ──────────────────────────────────────────
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          objectSrc: ["'none'"],
          scriptSrc: ["'self'"],
          scriptSrcAttr: ["'none'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'", ...appOrigins],
          frameAncestors: ["'self'", ...appOrigins],
          formAction: ["'self'"],
          upgradeInsecureRequests: config.isProd ? [] : null,
        },
      },
      // Required for <video src> / media when FE and API are on different origins.
      // Helmet defaults to same-origin, which blocks cross-origin media playback.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      crossOriginEmbedderPolicy: false,
      // Disable X-Frame-Options. Helmet defaults to SAMEORIGIN, which blocks the
      // frontend (different host) from embedding PDFs/docs in <iframe>. Framing is
      // controlled solely by CSP frame-ancestors (set above to the FE origins).
      xFrameOptions: false,
      hsts: config.isProd ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );

  app.use((_req: Request, res: Response, next: NextFunction) => {
    // Allow media features for same-origin and our frontend origins (video/docs embed).
    const origins = appOrigins.map((o) => o.replace(/^https?:\/\//, '')).join(' ');
    res.setHeader(
      'Permissions-Policy',
      `accelerometer=(), autoplay=(self "${origins}"), camera=(), display-capture=(), encrypted-media=(self "${origins}"), fullscreen=(self "${origins}"), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()`,
    );
    next();
  });

  app.use(cors({ origin: appOrigins, credentials: true }));

  // Gzip breaks byte-range video/document streaming (wrong Content-Length / 206).
  app.use(
    compression({
      filter: (req, res) => {
        const path = req.path || '';
        if (path.includes('/media/video') || path.includes('/media/doc')) return false;
        if (req.headers.range) return false;
        return compression.filter(req, res);
      },
    }),
  );

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(cookieParser());
  if (!config.isProd) app.use(morgan('dev'));

  // Health check (unversioned, unauthenticated).
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ success: true, status: 'ok', uptime: process.uptime(), env: config.env });
  });

  // API docs — non-production only.
  if (!config.isProd) {
    const docsCsp = helmet.contentSecurityPolicy({
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https:'],
        imgSrc: ["'self'", 'data:', 'https:'],
      },
    });
    app.use('/api/docs', docsCsp, swaggerUi.serve, swaggerUi.setup(swaggerSpec, { customSiteTitle: 'MTANDT Platform API' }));
    app.get('/api/docs.json', docsCsp, (_req, res) => res.json(swaggerSpec));
  }

  // Versioned API (rate-limited). auditContext attaches req.audit().
  app.use(config.apiPrefix, apiLimiter, auditContext, apiRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
