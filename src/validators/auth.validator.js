import { z } from 'zod';

export const registerSchema = z.object({
  full_name: z.string().min(2, 'Name must be at least 2 characters').max(50),
  email: z.string().email('Invalid email format'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(
      /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d@$!%*#?&]{8,}$/,
      'Password must contain at least one letter and one number',
    ),
  // Required: every student must give a mobile number when they sign up.
  // Accepts the forms people actually type — "+91 98765 43210",
  // "098765-43210" — and normalises to the bare 10 digits that get stored, so
  // the unique index can't be defeated by formatting alone.
  phone_number: z
    .string({ required_error: 'Mobile number is required' })
    .transform((v) => v.replace(/\D/g, '').replace(/^(?:91|0)(?=\d{10}$)/, ''))
    .refine((v) => /^[6-9]\d{9}$/.test(v), {
      message: 'Enter a valid 10-digit Indian mobile number',
    }),
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
});

export const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, 'Old password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email format'),
});

export const resetPasswordSchema = z.object({
  password: z.string().min(8, 'New password must be at least 8 characters'),
});
