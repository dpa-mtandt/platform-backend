import { Router } from 'express';
import { authController } from './auth.controller';
import { loginSchema, refreshSchema, changePasswordSchema, updateProfileSchema, forgotPasswordSchema, verifyOtpSchema, resetPasswordSchema } from './auth.validation';
import { validate } from '../../middleware/validate';
import { authenticate, optionalAuth } from '../../middleware/authenticate';
import { authLimiter } from '../../middleware/rateLimit';
import { asyncHandler } from '../../utils/asyncHandler';

const router = Router();

/**
 * @openapi
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Authenticate and receive access + refresh tokens plus the session profile
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, example: user@example.com }
 *               password: { type: string, example: "••••••••" }
 *     responses:
 *       200: { description: Logged in }
 *       401: { description: Invalid credentials }
 */
router.post('/login', authLimiter, validate({ body: loginSchema }), asyncHandler(authController.login));

/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     tags: [Auth]
 *     summary: Rotate the refresh token and get a fresh session profile + tokens
 *     responses:
 *       200: { description: Token refreshed }
 *       401: { description: Invalid refresh token }
 */
router.post('/refresh', authLimiter, validate({ body: refreshSchema }), asyncHandler(authController.refresh));

// ── Forgot / reset password (OTP by email) — public, rate-limited ─────────────
router.post('/forgot-password', authLimiter, validate({ body: forgotPasswordSchema }), asyncHandler(authController.forgotPassword));
router.post('/verify-otp', authLimiter, validate({ body: verifyOtpSchema }), asyncHandler(authController.verifyOtp));
router.post('/reset-password', authLimiter, validate({ body: resetPasswordSchema }), asyncHandler(authController.resetPassword));

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Revoke the current refresh token
 *     responses:
 *       200: { description: Logged out }
 */
router.post('/logout', optionalAuth, asyncHandler(authController.logout));

/**
 * @openapi
 * /auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Get the current session profile (user + roles + permissions + modules)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Session profile }
 *       401: { description: Unauthorized }
 */
router.get('/me', authenticate, asyncHandler(authController.me));

/**
 * @openapi
 * /auth/me:
 *   patch:
 *     tags: [Auth]
 *     summary: Update the current user's own profile
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Updated session profile }
 */
router.patch('/me', authenticate, validate({ body: updateProfileSchema }), asyncHandler(authController.updateProfile));

/**
 * @openapi
 * /auth/change-password:
 *   post:
 *     tags: [Auth]
 *     summary: Change the current user's password (revokes all sessions)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Password changed }
 */
router.post(
  '/change-password',
  authenticate,
  validate({ body: changePasswordSchema }),
  asyncHandler(authController.changePassword),
);

export default router;
