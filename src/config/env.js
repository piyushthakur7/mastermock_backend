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
  CLOUDINARY_CLOUD_NAME: z.string().optional().default(''),
  CLOUDINARY_API_KEY: z.string().optional().default(''),
  CLOUDINARY_API_SECRET: z.string().optional().default(''),
  REDIS_URL: z.string().optional().default('redis://localhost:6379'),
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error('❌ Invalid environment variables:', _env.error.format());
  process.exit(1);
}

export const env = _env.data;
