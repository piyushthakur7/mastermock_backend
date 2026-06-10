import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config({ path: './.env' });

const envSchema = z.object({
  PORT: z.string().default('3000'),
  MONGO_URI: z.string().url('Must be a valid URL'),
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
  AWS_REGION: z.string().optional().default('ap-south-1'),
  AWS_ACCESS_KEY_ID: z.string().optional().default(''),
  AWS_SECRET_ACCESS_KEY: z.string().optional().default(''),
  AWS_S3_BUCKET_NAME: z.string().optional().default(''),
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error('❌ Invalid environment variables:', _env.error.format());
  process.exit(1);
}

export const env = _env.data;
