import { IsString, Matches } from 'class-validator';

const E164 = /^\+[1-9]\d{7,14}$/;

export class VerifyOtpDto {
  @IsString()
  @Matches(E164, {
    message: 'phone must be in E.164 format, e.g. +37455123456',
  })
  phone: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code: string;
}
