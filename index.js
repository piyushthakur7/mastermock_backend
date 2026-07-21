import { env } from './src/config/env.js';
import { logger } from './src/utils/logger.js';
import app from './src/app.js';
import connectdb from './src/db/connection.js';

const PORT = env.PORT || process.env.PORT || 5000;

// Without these, a failure anywhere outside a request handler kills the
// process with nothing written to the log — the server just stops answering
// and the reverse proxy serves a bare 503 with no way to tell why.
process.on('unhandledRejection', (reason) => {
  logger.error(
    `UNHANDLED REJECTION: ${reason?.stack || reason?.message || reason}`,
  );
});

process.on('uncaughtException', (error) => {
  logger.error(`UNCAUGHT EXCEPTION: ${error?.stack || error?.message}`);
  // An uncaught exception leaves the process in an undefined state, so exit
  // and let the platform restart it — but only after the reason is recorded.
  process.exit(1);
});

console.log('Application starting...');
console.log('Connecting to MongoDB...');

connectdb()
  .then(() => {
    console.log('MongoDB connected successfully!');
    // Prevent starting custom HTTP server if deployed on Vercel (Vercel handles it)
    if (!process.env.VERCEL && !process.env.AWS_LAMBDA_FUNCTION_VERSION) {
      app.listen(PORT, () => {
        console.log(`Server successfully bound and running on port ${PORT}`);
        logger.info(`Server running at http://localhost:${PORT}/`);
      });
    }
  })
  .catch((err) => {
    console.error('MongoDB connection failed !!! ', err);
    logger.error(`MongoDB connection failed: ${err?.stack || err?.message}`);
    process.exit(1);
  });

export default app;
