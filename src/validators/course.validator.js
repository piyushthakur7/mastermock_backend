import { z } from 'zod';

export const createCourseSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters'),
  description: z.string().min(10, 'Description must be at least 10 characters'),
  price: z.number().min(0, 'Price must be a positive number').default(0),
  access_type: z.enum(['free', 'paid']).default('paid'),
  category: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid category ID'),
});

export const updateCourseSchema = z.object({
  title: z.string().min(3).optional(),
  description: z.string().min(10).optional(),
  price: z.number().min(0).optional(),
  access_type: z.enum(['free', 'paid']).optional(),
  category: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, 'Invalid category ID')
    .optional(),
});
