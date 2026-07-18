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

// The token secrets have development defaults so a fresh clone runs without
// setup. Those defaults are public (they are in this file), so anyone could
// sign a token for any user id — and user ids are handed out by the API. Fail
// fast rather than silently booting production with a known signing key.
const requireRealSecretsInProduction = (data, ctx) => {
  if (data.NODE_ENV !== 'production') return;

  const defaults = {
    ACCESS_TOKEN_SECRET: 'development_secret_access',
    REFRESH_TOKEN_SECRET: 'development_secret_refresh',
  };

  for (const [key, devDefault] of Object.entries(defaults)) {
    if (data[key] === devDefault) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${key} must be set to a real secret in production (it is currently the public development default)`,
      });
    }
  }
};

const _env = envSchema
  .superRefine(requireRealSecretsInProduction)
  .safeParse(process.env);

if (!_env.success) {
  console.error('❌ Invalid environment variables:', _env.error.format());
  process.exit(1);
}

export const env = _env.data;

if (_env.data.ACCESS_TOKEN_SECRET === 'development_secret_access') {
  console.warn(
    '⚠️  ACCESS_TOKEN_SECRET is the public development default. Anyone can forge a session token. Set it before deploying.',
  );
}

if (_env.data.CORS_ORIGIN === '*') {
  console.warn(
    '⚠️  CORS_ORIGIN is "*" while credentials are enabled. Browsers reject credentialed requests to a wildcard origin — set it to your frontend URL.',
  );
}

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
