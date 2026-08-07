import { randomInt, createHash } from 'node:crypto';
import type { Prisma, User } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { config } from '../../config/env';
import { logger } from '../../config/logger';
import { emailConfigured, sendOtpEmail } from '../../config/email';
import { ApiError } from '../../utils/apiError';
import { verifyPassword, hashPassword } from '../../utils/password';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  newTokenId,
  hashToken,
  getTokenExpiry,
} from '../../utils/jwt';
import { resolveUserAccess } from '../../utils/rbac';

interface RequestContext {
  ip?: string;
  userAgent?: string;
}

const profileSelect = {
  id: true,
  employeeId: true,
  name: true,
  email: true,
  status: true,
  designation: true,
  phone: true,
  avatarUrl: true,
  bio: true,
  departmentId: true,
  companyId: true,
  lastLoginAt: true,
  createdAt: true,
  department: { select: { id: true, name: true, code: true } },
  company: { select: { id: true, name: true } },
} satisfies Prisma.UserSelect;

/**
 * The full session profile the frontend needs to render itself: the user, their
 * role keys, effective permission keys, super-admin flag, and the ordered list
 * of accessible module cards for the launcher. Everything is resolved from the
 * database, never from the token.
 */
export async function getSessionProfile(userId: string) {
  const access = await resolveUserAccess(userId);
  if (!access) throw ApiError.notFound('User not found');

  const [user, modules] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: profileSelect }),
    prisma.module.findMany({
      // Internal modules the user can access, PLUS any configured external app
      // (CRM/ERP/HCM) — those are shown to everyone once a URL is set.
      where: {
        isActive: true,
        OR: [{ key: { in: [...access.modules] } }, { isExternal: true, externalUrl: { not: null } }],
      },
      orderBy: { sortOrder: 'asc' },
      select: { key: true, name: true, description: true, icon: true, path: true, color: true, sortOrder: true, isCore: true, isExternal: true, externalUrl: true },
    }),
  ]);

  return {
    user,
    roles: access.roles,
    isSuperAdmin: access.isSuperAdmin,
    permissions: [...access.permissions],
    modules,
  };
}

async function issueTokens(user: Pick<User, 'id' | 'email'>, ctx: RequestContext) {
  const accessToken = signAccessToken({ sub: user.id, email: user.email });
  const jti = newTokenId();
  const refreshToken = signRefreshToken({ sub: user.id, jti });

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: getTokenExpiry(refreshToken),
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    },
  });

  return { accessToken, refreshToken };
}

const MAX_OTP_ATTEMPTS = 5;
const genOtp = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Validate the latest OTP for an email. Uniform "invalid or expired" errors so this
 *  never becomes an account-enumeration oracle. Increments attempts on a wrong code. */
async function assertValidResetOtp(email: string, otp: string) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() }, select: { id: true } });
  if (!user) throw ApiError.badRequest('Invalid or expired code');
  const token = await prisma.passwordResetToken.findFirst({
    where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!token) throw ApiError.badRequest('Invalid or expired code');
  if (token.attempts >= MAX_OTP_ATTEMPTS) throw ApiError.badRequest('Too many attempts. Request a new code.');
  if (token.otpHash !== sha256(otp)) {
    await prisma.passwordResetToken.update({ where: { id: token.id }, data: { attempts: { increment: 1 } } });
    throw ApiError.badRequest('Invalid or expired code');
  }
  return { userId: user.id, tokenId: token.id };
}

export const authService = {
  async login(email: string, password: string, ctx: RequestContext) {
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    // Uniform error for unknown email vs wrong password (no account-enumeration oracle).
    if (!user) {
      // Do a dummy compare to keep timing roughly constant.
      await verifyPassword(password, '$2a$10$xxxxxxxxxxxxxxxxxxxxxx.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
      throw ApiError.unauthorized('Invalid email or password');
    }
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) throw ApiError.unauthorized('Invalid email or password');
    if (user.status !== 'ACTIVE') throw ApiError.forbidden('Your account is not active. Contact an administrator.');

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const tokens = await issueTokens(user, ctx);
    const profile = await getSessionProfile(user.id);
    return { ...profile, ...tokens };
  },

  async refresh(token: string | undefined, ctx: RequestContext) {
    if (!token) throw ApiError.unauthorized('Refresh token is required');

    let payload;
    try {
      payload = verifyRefreshToken(token);
    } catch {
      throw ApiError.unauthorized('Invalid or expired refresh token');
    }

    const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw ApiError.unauthorized('Refresh token is no longer valid');
    }

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== 'ACTIVE') throw ApiError.unauthorized('Account unavailable');

    // Rotate: revoke the used token, issue a fresh pair.
    await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
    const tokens = await issueTokens(user, ctx);
    const profile = await getSessionProfile(user.id);
    return { ...profile, ...tokens };
  },

  async logout(token: string | undefined) {
    if (!token) return;
    await prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  },

  async me(userId: string) {
    return getSessionProfile(userId);
  },

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw ApiError.notFound('User not found');

    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) throw ApiError.badRequest('Current password is incorrect');

    const passwordHash = await hashPassword(newPassword);
    await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    // Invalidate all existing sessions after a password change.
    await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  },

  /**
   * Start a "forgot password" reset: issue a short-lived OTP and email it. Resolves the
   * same way whether or not the email exists (no enumeration). Returns { devOtp } only in
   * development when SMTP isn't configured, so the flow stays testable without email.
   */
  async requestPasswordReset(email: string): Promise<{ devOtp?: string }> {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true, name: true, email: true, status: true },
    });
    if (!user || user.status !== 'ACTIVE') return {};

    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });
    const otp = genOtp();
    await prisma.passwordResetToken.create({
      data: { userId: user.id, otpHash: sha256(otp), expiresAt: new Date(Date.now() + config.passwordReset.otpExpiryMinutes * 60_000) },
    });

    if (emailConfigured) {
      try {
        await sendOtpEmail(user.email, user.name, otp);
      } catch (err) {
        logger.error('Failed to send password-reset OTP email', err);
      }
      return {};
    }
    if (!config.isProd) {
      logger.warn(`[dev] Password-reset OTP for ${user.email}: ${otp}`);
      return { devOtp: otp };
    }
    logger.error('Password reset requested but SMTP is not configured — the OTP cannot be delivered.');
    return {};
  },

  /** Check an OTP without consuming it (lets the UI advance to the new-password step). */
  async verifyResetOtp(email: string, otp: string): Promise<void> {
    await assertValidResetOtp(email, otp);
  },

  /** Consume the OTP, set the new password, and revoke all existing sessions. */
  async resetPasswordWithOtp(email: string, otp: string, newPassword: string): Promise<void> {
    const { userId, tokenId } = await assertValidResetOtp(email, otp);
    const passwordHash = await hashPassword(newPassword);
    await prisma.$transaction([
      prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
      prisma.passwordResetToken.update({ where: { id: tokenId }, data: { usedAt: new Date() } }),
      prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
  },

  /** Self-service profile update — only fields a user may edit about themselves. */
  async updateProfile(
    userId: string,
    input: { name?: string; designation?: string | null; phone?: string | null; avatarUrl?: string | null; bio?: string | null },
  ) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw ApiError.notFound('User not found');
    await prisma.user.update({
      where: { id: userId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.designation !== undefined ? { designation: input.designation || null } : {}),
        ...(input.phone !== undefined ? { phone: input.phone || null } : {}),
        ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl || null } : {}),
        ...(input.bio !== undefined ? { bio: input.bio || null } : {}),
      },
    });
    return getSessionProfile(userId);
  },
};
