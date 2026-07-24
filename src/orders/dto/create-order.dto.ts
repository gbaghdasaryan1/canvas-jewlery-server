import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * The multipart text fields. `options` arrives as a JSON string and is parsed
 * and validated separately against OrderOptionsDto.
 */
export class CreateOrderDto {
  @IsString()
  @Matches(E164, {
    message: 'phone must be in E.164 format, e.g. +37455123456',
  })
  phone: string;

  // Optional while OTP verification is disabled (see OTP_VERIFICATION_ENABLED
  // in orders.service.ts). Re-add a required token when re-enabling.
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  verificationToken?: string;

  @IsString()
  @MaxLength(20_000, { message: 'options payload is too large' })
  options: string;
}
