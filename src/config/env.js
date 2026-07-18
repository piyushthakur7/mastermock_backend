import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config({ path: './.env' });

const envSchema = z.object({
  PORT: z.string().default('3000'),
  MONGO_URI: z.string().min(1, 'Mongo URI is required'),
  CORS_ORIGIN: z.string().default('*'),
  ACCESS_TOKEN_SECRET: z
    .string()
    .min(10, 'Access token secret is too short')
    .default('development_secret_access'),
  ACCESS_TOKEN_EXPIRY: z.string().default('1d'),
  REFRESH_TOKEN_SECRET: z
    .string()
    .min(10, 'Refresh token secret is too short')
    .default('development_secret_refresh'),
  REFRESH_TOKEN_EXPIRY: z.string().default('10d'),
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  FRONTEND_URL: z.string().default('http://localhost:3000'),
  CLOUDINARY_CLOUD_NAME: z.string().optional().default(''),
  CLOUDINARY_API_KEY: z.string().optional().default(''),
  CLOUDINARY_API_SECRET: z.string().optional().default(''),
  RAZORPAY_KEY_ID: z.string().optional().default(''),
  RAZORPAY_KEY_SECRET: z.string().optional().default(''),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional().default(''),
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error('❌ Invalid environment variables:', _env.error.format());
  process.exit(1);
}

export const env = _env.data;

// Startup warnings for critical payment config
if (!_env.data.RAZORPAY_KEY_ID || !_env.data.RAZORPAY_KEY_SECRET) {
  console.warn(
    '⚠️  RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET is not set. Payment features will not work.',
  );
} else {
  const idIsTest = _env.data.RAZORPAY_KEY_ID.startsWith('rzp_test_');
  const idIsLive = _env.data.RAZORPAY_KEY_ID.startsWith('rzp_live_');
  if (!idIsTest && !idIsLive) {
    console.warn(
      '⚠️  RAZORPAY_KEY_ID does not start with rzp_test_ or rzp_live_. Verify it is correct.',
    );
  } else {
    console.log(
      `✅ Razorpay configured in ${idIsTest ? 'TEST' : 'LIVE'} mode.`,
    );
  }
}

if (!_env.data.RAZORPAY_WEBHOOK_SECRET) {
  console.warn(
    '⚠️  RAZORPAY_WEBHOOK_SECRET is not set. Webhook verification will fail.',
  );
}
