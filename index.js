import { env } from './src/config/env.js';
import { logger } from './src/utils/logger.js';
import app from './src/app.js';
import connectdb from './src/db/connection.js';

const PORT = env.PORT || process.env.PORT || 5000;

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
    logger.error('MongoDB connection failed !!! ', err);
  });

export default app;
