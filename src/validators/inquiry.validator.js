import { z } from 'zod';

export const createInquirySchema = z.object({
  subject: z
    .string()
    .trim()
    .min(3, 'Subject must be at least 3 characters')
    .max(200),
  message: z
    .string()
    .trim()
    .min(5, 'Message must be at least 5 characters')
    .max(5000),
});

export const replyInquirySchema = z.object({
  message: z.string().trim().min(1, 'Reply message is required').max(5000),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).optional(),
});
