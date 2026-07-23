import {
  BadGatewayException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
} from '@nestjs/common';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { OtpService } from './otp.service';
import { SmsDeliveryError, SmsService } from '../sms/sms.service';

@Controller('otp')
export class OtpController {
  constructor(
    private readonly otpService: OtpService,
    private readonly smsService: SmsService,
  ) {}

  @Post('request')
  @HttpCode(HttpStatus.OK)
  async request(
    @Body() dto: RequestOtpDto,
    @Ip() ip: string,
  ): Promise<{ expiresInSec: number }> {
    const { id, code, expiresInSec } = await this.otpService.createAndStore(
      dto.phone,
      ip ?? null,
    );

    try {
      await this.smsService.send(
        dto.phone,
        `Your verification code is ${code}. It expires in ${Math.round(expiresInSec / 60)} minutes.`,
      );
    } catch (error) {
      if (error instanceof SmsDeliveryError) {
        // The code was stored before the send; roll it back so an undelivered
        // code neither lingers nor counts against the rate limit. Surfaces as a
        // 502 (upstream provider), distinct from a 500 (a bug in this server).
        await this.otpService.discard(id);
        throw new BadGatewayException(
          'Could not send the verification code. Please try again.',
        );
      }
      throw error;
    }

    return { expiresInSec };
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verify(
    @Body() dto: VerifyOtpDto,
  ): Promise<{ verificationToken: string }> {
    const verificationToken = await this.otpService.verify(dto.phone, dto.code);

    return { verificationToken };
  }
}
