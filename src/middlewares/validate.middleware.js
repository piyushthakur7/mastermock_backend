import { ApiError } from '../utils/ApiError.js';

export const validate = (schema) => async (req, res, next) => {
  try {
    const parsedBody = await schema.parseAsync(req.body);
    req.body = parsedBody;
    next();
  } catch (err) {
    // Only a ZodError carries `errors`; anything else (a thrown refinement,
    // a programming mistake in a schema) used to crash here with
    // "cannot read properties of undefined" and surface as a 500.
    const issues = Array.isArray(err?.errors) ? err.errors : [];
    const message = issues.length
      ? issues.map((e) => e.message).join(', ')
      : err?.message || 'Validation failed';
    next(new ApiError(400, message, issues));
  }
};
