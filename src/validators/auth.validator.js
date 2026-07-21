import { z } from 'zod';

// A blank phone number must become `undefined`, not an empty string. The
// model's unique index is sparse, and a sparse index skips only *missing*
// values — an empty string is still indexed, so the second user to submit a
// blank phone field collided on a duplicate key and registration failed.
export const optionalPhoneNumber = z
  .string()
  .trim()
  .optional()
  .transform((value) =>
    value === '' || value === undefined ? undefined : value,
  )
  .refine(
    (value) => value === undefined || /^[+]?[0-9\s\-()]{7,20}$/.test(value),
    { message: 'Invalid phone number' },
  );

export const registerSchema = z.object({
  full_name: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(50),
  email: z.string().trim().toLowerCase().email('Invalid email format'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be at most 128 characters')
    .regex(
      /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d@$!%*#?&]{8,}$/,
      'Password must contain at least one letter and one number',
    ),
  phone_number: optionalPhoneNumber,
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email format'),
  password: z.string().min(1, 'Password is required').max(128),
});

export const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, 'Old password is required').max(128),
  newPassword: z
    .string()
    .min(8, 'New password must be at least 8 characters')
    .max(128)
    .regex(
      /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d@$!%*#?&]{8,}$/,
      'Password must contain at least one letter and one number',
    ),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email format'),
});

export const resetPasswordSchema = z.object({
  password: z
    .string()
    .min(8, 'New password must be at least 8 characters')
    .max(128)
    .regex(
      /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d@$!%*#?&]{8,}$/,
      'Password must contain at least one letter and one number',
    ),
});
