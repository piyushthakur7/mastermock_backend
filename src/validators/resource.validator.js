import { z } from 'zod';

export const createResourceSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters'),
  description: z.string().optional(),
  course: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, 'Invalid course ID')
    .optional(),
  category: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, 'Invalid category ID')
    .optional(),
  resource_type: z.enum(['pdf', 'video', 'notes', 'assignment', 'solution']),
  // multipart/form-data values arrive as strings even for numbers.
  access_type: z.enum(['free', 'paid']).optional(),
  price: z.coerce.number().min(0).optional(),
  discount_price: z.coerce.number().min(0).optional(),
});
