import { z } from 'zod';

export const createMockTestSchema = z
  .object({
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
    difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
    access_type: z.enum(['free', 'paid']).default('free'),
    price: z.number().min(0).default(0),
    total_questions: z.number().min(1),
    passing_marks: z.number().min(1),
    negative_marking: z.boolean().default(false),
    negative_marks_per_wrong: z.number().min(0).default(0),
    total_marks: z.number().min(1),
    duration_minutes: z.number().min(1),
  })
  .refine((data) => data.access_type !== 'paid' || data.price > 0, {
    message: 'Price must be greater than 0 for paid tests',
    path: ['price'],
  });

export const updateMockTestSchema = createMockTestSchema.partial();

export const questionSchema = z.object({
  text: z.string().min(1, 'Question text is required'),
  marks: z.number().min(1).default(1),
  explanation: z.string().optional(),
  options: z
    .array(
      z.object({
        text: z.string().min(1, 'Option text is required'),
        is_correct: z.boolean(),
      }),
    )
    .min(2, 'At least 2 options are required'),
});

export const bulkUploadQuestionsSchema = z.object({
  questions: z
    .array(questionSchema)
    .min(1, 'At least one question is required'),
});
