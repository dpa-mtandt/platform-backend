import 'dotenv/config';
import { z } from 'zod';

/**
 * Central, validated configuration. Fail fast at boot if the environment is
 * misconfigured rather than crashing deep inside a request handler.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4200),
  API_PREFIX: z.string().default('/api/v1'),

  // Public base URL of this API as the browser sees it (no trailing slash).
  // Used to build absolute media stream URLs for <video>/<iframe>.
  // Leave empty when FE and API share the same origin (or Vite proxies /api).
  // Example production: https://api.example.com
  PUBLIC_API_URL: z.string().optional().default(''),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  JWT_ACCESS_SECRET: z.string().min(10),
  JWT_REFRESH_SECRET: z.string().min(10),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  BCRYPT_SALT_ROUNDS: z.coerce.number().default(10),

  // Protected media (LMS). A separate short-lived token authorizes <video>/<iframe>
  // streaming (they can't send an Authorization header), so it rides in the URL.
  MEDIA_TOKEN_SECRET: z.string().min(10).default('dev-media-secret-change-me-0123456789'),
  MEDIA_TOKEN_TTL: z.string().default('3h'),
  MAX_UPLOAD_MB: z.coerce.number().default(500),

  // Cloudflare R2 (S3-compatible) — the ONLY store for binary media. Required in
  // production; uploads fail with 503 until these are set. Postgres holds metadata only.
  R2_ACCOUNT_ID: z.string().optional().default(''),
  R2_ACCESS_KEY_ID: z.string().optional().default(''),
  R2_SECRET_ACCESS_KEY: z.string().optional().default(''),
  R2_BUCKET: z.string().optional().default(''),
  R2_PUBLIC_URL: z.string().optional().default(''),

  // Email / SMTP (password-reset OTP). When unset, OTPs are surfaced in dev only.
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z.enum(['true', 'false']).default('false'),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  EMAIL_FROM: z.string().optional().default('MTANDT Platform <no-reply@mtandt.com>'),
  PASSWORD_RESET_OTP_EXPIRY_MINUTES: z.coerce.number().default(10),
  // Public URLs — set per environment (no localhost defaults). APP_URL is used in
  // password-reset email links; CORS_ORIGIN is the allowed browser origin(s).
  APP_URL: z.string().optional().default(''),

  CORS_ORIGIN: z.string().optional().default(''),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900_000),
  RATE_LIMIT_MAX: z.coerce.number().default(600),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().default(30),

  REFRESH_COOKIE_NAME: z.string().default('mtandt_refresh'),

  POWERBI_MODE: z.enum(['mock', 'real']).default('mock'),
  PBI_TENANT_ID: z.string().optional().default(''),
  PBI_CLIENT_ID: z.string().optional().default(''),
  PBI_CLIENT_SECRET: z.string().optional().default(''),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Invalid environment configuration:');
  // eslint-disable-next-line no-console
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const raw = parsed.data;

// Never ship known-weak secrets to production (OWASP A02).
if (raw.NODE_ENV === 'production') {
  const weak: string[] = [];
  if (raw.JWT_ACCESS_SECRET.includes('change-me')) weak.push('JWT_ACCESS_SECRET');
  if (raw.JWT_REFRESH_SECRET.includes('change-me')) weak.push('JWT_REFRESH_SECRET');
  if (raw.JWT_ACCESS_SECRET === raw.JWT_REFRESH_SECRET) weak.push('JWT_ACCESS_SECRET must differ from JWT_REFRESH_SECRET');
  if (raw.MEDIA_TOKEN_SECRET.includes('change-me')) weak.push('MEDIA_TOKEN_SECRET');
  if (weak.length) {
    // eslint-disable-next-line no-console
    console.error(`❌ Refusing to start in production with weak/default secrets: ${weak.join('; ')}`);
    process.exit(1);
  }
}

/** Strip trailing slash so we can safely concat `${publicApiUrl}${apiPrefix}/...`. */
const publicApiUrl = (raw.PUBLIC_API_URL || '').replace(/\/+$/, '');

export const config = {
  env: raw.NODE_ENV,
  isProd: raw.NODE_ENV === 'production',
  isDev: raw.NODE_ENV === 'development',
  port: raw.PORT,
  apiPrefix: raw.API_PREFIX,
  /** Browser-facing API origin (empty = same-origin / relative stream URLs). */
  publicApiUrl,
  databaseUrl: raw.DATABASE_URL,
  cors: {
    origin: raw.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean),
  },
  jwt: {
    accessSecret: raw.JWT_ACCESS_SECRET,
    refreshSecret: raw.JWT_REFRESH_SECRET,
    accessExpiresIn: raw.JWT_ACCESS_EXPIRES_IN,
    refreshExpiresIn: raw.JWT_REFRESH_EXPIRES_IN,
  },
  media: {
    tokenSecret: raw.MEDIA_TOKEN_SECRET,
    tokenTtl: raw.MEDIA_TOKEN_TTL,
    maxUploadMb: raw.MAX_UPLOAD_MB,
  },
  r2: {
    accountId: raw.R2_ACCOUNT_ID,
    accessKeyId: raw.R2_ACCESS_KEY_ID,
    secretAccessKey: raw.R2_SECRET_ACCESS_KEY,
    bucket: raw.R2_BUCKET,
    publicUrl: (raw.R2_PUBLIC_URL || '').replace(/\/+$/, ''),
  },
  appUrl: raw.APP_URL,
  email: {
    host: raw.SMTP_HOST,
    port: raw.SMTP_PORT,
    secure: raw.SMTP_SECURE === 'true',
    user: raw.SMTP_USER,
    pass: raw.SMTP_PASS,
    from: raw.EMAIL_FROM,
    configured: Boolean(raw.SMTP_HOST && raw.SMTP_USER && raw.SMTP_PASS && raw.SMTP_HOST !== 'smtp.example.com'),
  },
  passwordReset: {
    otpExpiryMinutes: raw.PASSWORD_RESET_OTP_EXPIRY_MINUTES,
  },
  bcryptSaltRounds: raw.BCRYPT_SALT_ROUNDS,
  rateLimit: {
    windowMs: raw.RATE_LIMIT_WINDOW_MS,
    max: raw.RATE_LIMIT_MAX,
    authMax: raw.AUTH_RATE_LIMIT_MAX,
  },
  refreshCookieName: raw.REFRESH_COOKIE_NAME,
  powerbi: {
    mode: raw.POWERBI_MODE,
    tenantId: raw.PBI_TENANT_ID,
    clientId: raw.PBI_CLIENT_ID,
    clientSecret: raw.PBI_CLIENT_SECRET,
  },
} as const;

export type AppConfig = typeof config;
