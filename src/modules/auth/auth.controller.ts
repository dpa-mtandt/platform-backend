import type { Request, Response, CookieOptions } from 'express';
import { authService } from './auth.service';
import { ok } from '../../utils/apiResponse';
import { recordAudit, clientIp } from '../../utils/audit';
import { config } from '../../config/env';

function refreshCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

function ctxFrom(req: Request) {
  return { ip: clientIp(req), userAgent: req.get('user-agent') ?? undefined };
}

export const authController = {
  async login(req: Request, res: Response) {
    const { email, password } = req.body;
    try {
      const result = await authService.login(email, password, ctxFrom(req));
      res.cookie(config.refreshCookieName, result.refreshToken, refreshCookieOptions());
      void recordAudit({
        action: 'LOGIN',
        module: 'auth',
        status: 'SUCCESS',
        description: 'Signed in',
        entityType: 'User',
        entityId: result.user?.id,
        userId: result.user?.id,
        userEmail: result.user?.email,
        userName: result.user?.name,
        userRoles: result.roles.join(','),
        ip: clientIp(req),
        userAgent: req.get('user-agent') ?? undefined,
      });
      // Never send the refresh token in the JSON body — it lives only in the
      // httpOnly cookie, so XSS can't read it.
      const { refreshToken: _rt, ...clientSafe } = result;
      return ok(res, clientSafe, 'Logged in');
    } catch (err) {
      void recordAudit({
        action: 'LOGIN',
        module: 'auth',
        status: 'FAILURE',
        description: 'Failed sign-in attempt',
        userEmail: String(email ?? '').toLowerCase() || null,
        ip: clientIp(req),
        userAgent: req.get('user-agent') ?? undefined,
      });
      throw err;
    }
  },

  async refresh(req: Request, res: Response) {
    const token = req.body?.refreshToken || req.cookies?.[config.refreshCookieName];
    const result = await authService.refresh(token, ctxFrom(req));
    res.cookie(config.refreshCookieName, result.refreshToken, refreshCookieOptions());
    const { refreshToken: _rt, ...clientSafe } = result;
    return ok(res, clientSafe, 'Token refreshed');
  },

  async logout(req: Request, res: Response) {
    const token = req.body?.refreshToken || req.cookies?.[config.refreshCookieName];
    await authService.logout(token);
    res.clearCookie(config.refreshCookieName, { path: '/' });
    void recordAudit({
      action: 'LOGOUT',
      module: 'auth',
      status: 'SUCCESS',
      description: 'Signed out',
      userId: req.user?.id ?? null,
      userEmail: req.user?.email ?? null,
      userRoles: req.user?.roles.join(',') ?? null,
      ip: clientIp(req),
      userAgent: req.get('user-agent') ?? undefined,
    });
    return ok(res, null, 'Logged out');
  },

  async me(req: Request, res: Response) {
    const profile = await authService.me(req.user!.id);
    return ok(res, profile);
  },

  async updateProfile(req: Request, res: Response) {
    const profile = await authService.updateProfile(req.user!.id, req.body);
    return ok(res, profile, 'Profile updated');
  },

  async changePassword(req: Request, res: Response) {
    const { currentPassword, newPassword } = req.body;
    await authService.changePassword(req.user!.id, currentPassword, newPassword);
    res.clearCookie(config.refreshCookieName, { path: '/' });
    return ok(res, null, 'Password changed. Please log in again.');
  },

  async forgotPassword(req: Request, res: Response) {
    const email = String(req.body.email ?? '');
    const result = await authService.requestPasswordReset(email);
    void recordAudit({
      action: 'PASSWORD_RESET_REQUEST',
      module: 'auth',
      status: 'SUCCESS',
      description: 'Password reset code requested',
      userEmail: email.toLowerCase() || null,
      ip: clientIp(req),
      userAgent: req.get('user-agent') ?? undefined,
    });
    // `result` carries devOtp only in development without SMTP; otherwise it's empty.
    return ok(res, result, 'If an account exists for that email, a reset code has been sent.');
  },

  async verifyOtp(req: Request, res: Response) {
    await authService.verifyResetOtp(req.body.email, req.body.otp);
    return ok(res, { valid: true }, 'Code verified');
  },

  async resetPassword(req: Request, res: Response) {
    await authService.resetPasswordWithOtp(req.body.email, req.body.otp, req.body.newPassword);
    void recordAudit({
      action: 'PASSWORD_RESET',
      module: 'auth',
      status: 'SUCCESS',
      description: 'Password reset via OTP',
      userEmail: String(req.body.email ?? '').toLowerCase() || null,
      ip: clientIp(req),
      userAgent: req.get('user-agent') ?? undefined,
    });
    return ok(res, null, 'Your password has been reset. Please sign in with your new password.');
  },
};
