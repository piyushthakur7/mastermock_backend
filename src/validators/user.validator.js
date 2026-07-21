import { z } from 'zod';
import { optionalPhoneNumber } from './auth.validator.js';

export const updateAccountSchema = z.object({
  full_name: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(50)
    .optional(),
  phone_number: optionalPhoneNumber,
});

export const updateAvatarSchema = z.object({
  profile_picture: z.string().url('Invalid URL for profile picture'),
});

export const updateStatusSchema = z.object({
  status: z.enum(['active', 'suspended', 'unverified'], {
    errorMap: () => ({ message: 'Invalid status value' }),
  }),
});
