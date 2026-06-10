import { z } from 'zod';

export const createResourceSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters'),
  description: z.string().optional(),
  course: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid course ID'),
  resource_type: z.enum(['pdf', 'video', 'notes', 'assignment', 'solution']),
});
