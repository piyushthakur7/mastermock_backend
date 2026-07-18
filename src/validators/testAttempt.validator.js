import { z } from 'zod';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid test ID');

// The controller accepts hack_id or the legacy mock_test_id, but this schema
// used to require mock_test_id — and because validation replaces req.body with
// the parsed result, a hack_id sent on its own was rejected with a 400 and one
// sent alongside was stripped before the controller ever saw it.
export const startTestSchema = z
  .object({
    hack_id: objectId.optional(),
    mock_test_id: objectId.optional(),
  })
  .refine((data) => data.hack_id || data.mock_test_id, {
    message: 'hack_id is required',
    path: ['hack_id'],
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
