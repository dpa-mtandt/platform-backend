import { z } from 'zod';

const strongPassword = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Must contain an uppercase letter')
  .regex(/[a-z]/, 'Must contain a lowercase letter')
  .regex(/[0-9]/, 'Must contain a number');

const otpCode = z.string().regex(/^\d{6}$/, 'Enter the 6-digit code');

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'Password is required'),
});

// ── Forgot / reset password (OTP) ────────────────────────────────────────────
export const forgotPasswordSchema = z.object({ email: z.string().email() });
export const verifyOtpSchema = z.object({ email: z.string().email(), otp: otpCode });
export const resetPasswordSchema = z.object({ email: z.string().email(), otp: otpCode, newPassword: strongPassword });

export const refreshSchema = z.object({
  refreshToken: z.string().optional(),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Must contain an uppercase letter')
      .regex(/[a-z]/, 'Must contain a lowercase letter')
      .regex(/[0-9]/, 'Must contain a number'),
  })
  .refine((d) => d.currentPassword !== d.newPassword, {
    message: 'New password must differ from the current one',
    path: ['newPassword'],
  });

export const updateProfileSchema = z.object({
  name: z.string().min(2).optional(),
  designation: z.string().max(120).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  avatarUrl: z.union([z.string().url(), z.literal(''), z.null()]).optional(),
  bio: z.string().max(500).nullable().optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
