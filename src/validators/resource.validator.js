import { z } from 'zod';

export const createResourceSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(3, 'Title must be at least 3 characters')
      .max(200),
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
  })
  .refine((data) => data.access_type !== 'paid' || (data.price ?? 0) > 0, {
    message: 'A paid resource needs a price greater than 0',
    path: ['price'],
  })
  .refine(
    (data) =>
      data.discount_price === undefined ||
      data.discount_price <= (data.price ?? 0),
    {
      message: 'Discount price cannot exceed the price',
      path: ['discount_price'],
    },
  );
