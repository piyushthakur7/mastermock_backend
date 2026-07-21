import { z } from 'zod';

const baseHackSchema = z.object({
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
  // Scheduled window. Validation replaces req.body with the parsed result, so
  // omitting these here silently discarded the admin's schedule on save.
  start_time: z.string().datetime({ offset: true }).nullable().optional(),
  end_time: z.string().datetime({ offset: true }).nullable().optional(),
});

const scheduleWindowRefinement = {
  check: (data) =>
    !data.start_time ||
    !data.end_time ||
    new Date(data.end_time) > new Date(data.start_time),
  options: {
    message: 'End time must be after start time',
    path: ['end_time'],
  },
};

export const createHackSchema = baseHackSchema
  .refine((data) => data.access_type !== 'paid' || data.price > 0, {
    message: 'Price must be greater than 0 for paid tests',
    path: ['price'],
  })
  .refine(scheduleWindowRefinement.check, scheduleWindowRefinement.options);

export const updateHackSchema = baseHackSchema
  .partial()
  .refine(scheduleWindowRefinement.check, scheduleWindowRefinement.options);

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
