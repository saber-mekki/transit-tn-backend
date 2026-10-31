// Central configuration: loads .env and validates required variables.
// Import this before anything that reads process.env.
import dotenv from 'dotenv';

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';
const DEV_JWT_SECRET = 'dev-only-insecure-jwt-secret';

const missing = ['DATABASE_URL', 'JWT_SECRET'].filter(name => !process.env[name]);
if (missing.length > 0) {
  if (isProduction) {
    // Refuse to start: without JWT_SECRET anyone could forge tokens with a public default
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  console.warn(`⚠️  Missing environment variables: ${missing.join(', ')} (see .env.example)`);
}

if (isProduction && (process.env.JWT_SECRET || '').length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters in production');
}

const optional = ['RESEND_API_KEY', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'GROQ_API_KEY', 'GMAIL_USER'];
const missingOptional = optional.filter(name => !process.env[name]);
if (missingOptional.length > 0) {
  console.warn(`ℹ️  Optional features disabled, missing: ${missingOptional.join(', ')}`);
}

export const config = {
  isProduction,
  port: Number(process.env.PORT) || 3001,
  jwtSecret: process.env.JWT_SECRET || DEV_JWT_SECRET,
};
