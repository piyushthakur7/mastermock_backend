class ApiError extends Error {
  constructor(
    statusCode,
    message = 'Something went wrong',
    errors = [],
    stack = '',
    errorCode = undefined,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.data = null;
    this.message = message;
    this.success = false;
    this.errors = errors;
    // Optional stable identifier (e.g. 'FILE_MISSING') so clients can render a
    // specific state instead of pattern-matching on human-readable text.
    // Deliberately NOT named `code` — that collides with MongoDB driver error
    // codes, which the global handler inspects for duplicate keys.
    this.errorCode = errorCode;
    // Marks this as a deliberate, client-safe error. Without it the global
    // handler cannot tell an intentional 4xx from an internal fault, and ends
    // up echoing raw driver messages (collection names, index shapes, dup
    // keys) back to the caller.
    this.isOperational = true;

    if (stack) {
      this.stack = stack;
    } else {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export { ApiError };
