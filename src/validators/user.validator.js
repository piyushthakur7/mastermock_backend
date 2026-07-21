import { z } from 'zod';

export const updateAccountSchema = z.object({
  full_name: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(50)
    .optional(),
  phone_number: z.string().optional(),
});

export const updateAvatarSchema = z.object({
  profile_picture: z.string().url('Invalid URL for profile picture'),
});

export const updateStatusSchema = z.object({
  status: z.enum(['active', 'suspended', 'unverified'], {
    errorMap: () => ({ message: 'Invalid status value' }),
  }),
});
