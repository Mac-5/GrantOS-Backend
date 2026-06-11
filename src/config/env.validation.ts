// src/config/env.validation.ts
// Validates all required environment variables at startup.
// The app will throw a clear error and refuse to start
// if any required variable is missing or malformed.

import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsString,
  Min,
  Max,
  validateSync,
  IsBoolean,
  IsOptional,
} from 'class-validator';

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV: Environment = Environment.Development;

  @IsInt()
  @Min(1024)
  @Max(65535)
  PORT: number = 3001;

  // ── Database ───────────────────────────────────────────────────────────────
  @IsString()
  DB_HOST: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  DB_PORT: number = 5432;

  @IsString()
  DB_USERNAME: string;

  @IsString()
  DB_PASSWORD: string;

  @IsString()
  DB_NAME: string;

  @IsBoolean()
  @IsOptional()
  DB_SYNCHRONIZE: boolean = false;

  // ── GitHub OAuth ──────────────────────────────────────────────────────────
  @IsString()
  GITHUB_CLIENT_ID: string;

  @IsString()
  GITHUB_CLIENT_SECRET: string;

  // The callback URL registered in your GitHub OAuth app settings.
  // Must point to: {API_BASE}/api/v1/identity/callback
  @IsString()
  GITHUB_CALLBACK_URL: string;

  // ── Oracle Wallet (ZK Attestation) ────────────────────────────────────────
  // Backend wallet private key — used to sign the GitHub metrics payload
  @IsString()
  ORACLE_PRIVATE_KEY: string;

  // Arbitrum One RPC URL
  @IsString()
  @IsOptional()
  ARBITRUM_RPC_URL: string;

  // ── AI Verifier (Claude) ───────────────────────────────────────────────────
  // Optional: when unset, AI milestone verification is disabled and the app
  // falls back to client-supplied verdicts.
  @IsString()
  @IsOptional()
  ANTHROPIC_API_KEY: string;

  // ── CORS ───────────────────────────────────────────────────────────────────
  @IsString()
  FRONTEND_URL: string;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(
      `❌ Environment validation failed:\n${errors
        .map((e) => Object.values(e.constraints ?? {}).join(', '))
        .join('\n')}`,
    );
  }

  return validatedConfig;
}
