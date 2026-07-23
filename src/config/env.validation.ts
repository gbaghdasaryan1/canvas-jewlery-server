import { plainToInstance } from 'class-transformer';
import {
  IsBooleanString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  validateSync,
} from 'class-validator';
import { Type } from 'class-transformer';

export class EnvironmentVariables {
  @IsString()
  @IsOptional()
  DB_HOST?: string;

  @Type(() => Number)
  @IsInt()
  @IsOptional()
  DB_PORT?: number;

  @IsString()
  @IsOptional()
  DB_USERNAME?: string;

  @IsString()
  @IsOptional()
  DB_PASSWORD?: string;

  @IsString()
  @IsOptional()
  DB_DATABASE?: string;

  @IsBooleanString()
  @IsOptional()
  DB_SYNCHRONIZE?: string;

  /** Signs verification tokens and hashes OTP codes. Required — no default. */
  @IsString()
  @IsNotEmpty()
  @MinLength(32, { message: 'JWT_SECRET must be at least 32 characters' })
  JWT_SECRET: string;

  /** Shared secret for the staff-facing GET /orders endpoints. */
  @IsString()
  @IsNotEmpty()
  @MinLength(16, { message: 'STAFF_API_KEY must be at least 16 characters' })
  STAFF_API_KEY: string;

  @IsString()
  @IsOptional()
  TWILIO_ACCOUNT_SID?: string;

  @IsString()
  @IsOptional()
  TWILIO_AUTH_TOKEN?: string;

  @IsString()
  @IsOptional()
  TWILIO_FROM?: string;

  // S3 storage for order STLs. Required — the app has no local-disk fallback.
  @IsString()
  @IsNotEmpty()
  AWS_REGION: string;

  @IsString()
  @IsNotEmpty()
  S3_BUCKET: string;

  @IsString()
  @IsNotEmpty()
  AWS_ACCESS_KEY_ID: string;

  @IsString()
  @IsNotEmpty()
  AWS_SECRET_ACCESS_KEY: string;

  /** Optional key prefix, e.g. "stl/". Defaults to none. */
  @IsString()
  @IsOptional()
  S3_PREFIX?: string;

  /** Custom S3 endpoint for LocalStack/MinIO in dev. */
  @IsString()
  @IsOptional()
  S3_ENDPOINT?: string;

  /** Presigned download URL lifetime in seconds. */
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  S3_PRESIGN_TTL_SEC?: number;

  /** Comma-separated list of allowed frontend origins. */
  @IsString()
  @IsOptional()
  CORS_ORIGIN?: string;

  @Type(() => Number)
  @IsInt()
  @IsOptional()
  PORT?: number;
}

export function validateEnv(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: false,
  });

  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    const details = errors
      .map((error) => Object.values(error.constraints ?? {}).join(', '))
      .join('\n  - ');

    throw new Error(`Invalid environment configuration:\n  - ${details}`);
  }

  return validated;
}
