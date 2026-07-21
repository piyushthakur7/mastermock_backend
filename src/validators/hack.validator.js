import { z } from 'zod';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

const baseHackSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters'),
  description: z.string().optional(),
  course: objectId.optional(),
  category: objectId.optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
  access_type: z.enum(['free', 'paid']).default('free'),
  price: z.number().min(0).default(0),
  passing_marks: z.number().min(1),
  negative_marking: z.boolean().default(false),
  negative_marks_per_wrong: z.number().min(0).default(0),
  duration_minutes: z.number().min(1),
  // Accepted for backwards compatibility with the existing admin UI, but
  // ignored: both are derived from the question list by a pre-save hook.
  // They used to be free-form numbers that were never reconciled with the
  // questions actually attached, so scoring divided by a made-up denominator.
  total_questions: z.number().optional(),
  total_marks: z.number().optional(),
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

// Applies to updates as well as creates. `.partial()` dropped this on the
// update schema, so an admin could switch a test to paid without ever setting
// a price — the UI then showed a Buy button that failed with 400 "Invalid
// price" on every attempt to pay.
const paidPriceRefinement = {
  check: (data) => {
    if (data.access_type !== 'paid') return true;
    return typeof data.price === 'number' && data.price > 0;
  },
  options: {
    message: 'A paid test needs a price greater than 0',
    path: ['price'],
  },
};

export const createHackSchema = baseHackSchema
  .refine(paidPriceRefinement.check, paidPriceRefinement.options)
  .refine(scheduleWindowRefinement.check, scheduleWindowRefinement.options);

export const updateHackSchema = baseHackSchema
  .partial()
  .refine(paidPriceRefinement.check, paidPriceRefinement.options)
  .refine(scheduleWindowRefinement.check, scheduleWindowRefinement.options);

export const questionSchema = z.object({
  text: z.string().min(1, 'Question text is required'),
  marks: z.number().min(1).default(1),
  explanation: z.string().optional(),
  options: z
    .array(
      z.object({
        // Round-tripped by the admin UI so editing a question preserves each
        // option's identity — completed attempts reference options by _id.
        _id: objectId.optional(),
        text: z.string().min(1, 'Option text is required'),
        is_correct: z.boolean(),
      }),
    )
    .min(2, 'At least 2 options are required')
    // Nothing enforced this, so a question could be saved with every option
    // marked wrong: unanswerable, and with negative marking on it deducted
    // marks from everyone who attempted it.
    .refine((options) => options.some((o) => o.is_correct), {
      message: 'At least one option must be marked as correct',
    }),
});

export const bulkUploadQuestionsSchema = z.object({
  questions: z
    .array(questionSchema)
    .min(1, 'At least one question is required'),
});
