import { z } from 'zod';

export const startTestSchema = z.object({
  mock_test_id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid test ID'),
});

export const saveAnswerSchema = z.object({
  question_id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid question ID'),
  selected_option_id: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, 'Invalid option ID')
    .nullable()
    .optional(),
  is_marked_for_review: z.boolean().default(false),
});
