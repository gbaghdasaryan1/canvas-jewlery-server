import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, MoreThan, Repository } from 'typeorm';
import {
  createHmac,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { Otp } from './entities/otp.entity';
import { VerificationToken } from './entities/verification-token.entity';

export const OTP_TTL_SEC = 60;
export const VERIFICATION_TOKEN_TTL_SEC = 60;

const REQUEST_WINDOW_SEC = 60;
const MAX_REQUESTS_PER_PHONE = 3;
const MAX_REQUESTS_PER_IP = 10;

const MAX_VERIFY_ATTEMPTS = 5;

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    @InjectRepository(Otp)
    private readonly otpRepository: Repository<Otp>,
    @InjectRepository(VerificationToken)
    private readonly tokenRepository: Repository<VerificationToken>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Returns the freshly generated code alongside the TTL so the controller can
   * hand the code to the SMS transport without it ever leaving the server.
   */
  async createAndStore(
    phone: string,
    ip: string | null,
  ): Promise<{ id: string; code: string; expiresInSec: number }> {
    await this.assertWithinRateLimits(phone, ip);

    // Only the newest code for a phone should ever be live.
    await this.otpRepository.update(
      { phone, consumedAt: IsNull() },
      { consumedAt: new Date() },
    );

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');

    const otp = await this.otpRepository.save(
      this.otpRepository.create({
        phone,
        codeHash: this.hashCode(phone, code),
        expiresAt: new Date(Date.now() + OTP_TTL_SEC * 1000),
        attempts: 0,
        consumedAt: null,
        requestIp: ip,
      }),
    );

    void this.purgeStaleRows();

    return { id: otp.id, code, expiresInSec: OTP_TTL_SEC };
  }

  /**
   * Drops a stored code whose SMS could not be delivered, so a failed send
   * neither leaves an undeliverable code live nor counts against the per-phone
   * or per-IP rate limit.
   */
  async discard(id: string): Promise<void> {
    await this.otpRepository.delete(id);
  }

  async verify(phone: string, code: string): Promise<string> {
    const otp = await this.otpRepository.findOne({
      where: { phone, consumedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });

    // Same generic message for every failure mode — do not tell an attacker
    // whether the code was wrong, expired, or never requested.
    if (!otp) {
      throw new UnauthorizedException('Invalid or expired code');
    }

    if (otp.attempts >= MAX_VERIFY_ATTEMPTS) {
      await this.otpRepository.update(otp.id, { consumedAt: new Date() });
      throw new ThrottlerException('Too many attempts. Request a new code.');
    }

    if (otp.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Invalid or expired code');
    }

    await this.otpRepository.increment({ id: otp.id }, 'attempts', 1);

    if (!this.matchesCode(phone, code, otp.codeHash)) {
      throw new UnauthorizedException('Invalid or expired code');
    }

    await this.otpRepository.update(otp.id, { consumedAt: new Date() });

    return this.issueVerificationToken(phone);
  }

  /** Validates the JWT, checks the server-side record, and burns it. */
  async consumeVerificationToken(token: string, phone: string): Promise<void> {
    let payload: { sub?: string; jti?: string };

    try {
      payload = await this.jwtService.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired verification token');
    }

    if (!payload.jti || payload.sub !== phone) {
      throw new UnauthorizedException('Invalid or expired verification token');
    }

    // Conditional update doubles as the concurrency guard: only one caller can
    // flip consumedAt from NULL, so a replayed token affects zero rows.
    const result = await this.tokenRepository.update(
      {
        id: payload.jti,
        phone,
        consumedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
      { consumedAt: new Date() },
    );

    if (!result.affected) {
      throw new UnauthorizedException('Invalid or expired verification token');
    }
  }

  private async issueVerificationToken(phone: string): Promise<string> {
    const jti = randomUUID();

    await this.tokenRepository.save(
      this.tokenRepository.create({
        id: jti,
        phone,
        expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_SEC * 1000),
        consumedAt: null,
      }),
    );

    return this.jwtService.signAsync(
      { sub: phone },
      { jwtid: jti, expiresIn: VERIFICATION_TOKEN_TTL_SEC },
    );
  }

  private async assertWithinRateLimits(
    phone: string,
    ip: string | null,
  ): Promise<void> {
    const since = new Date(Date.now() - REQUEST_WINDOW_SEC * 1000);

    const byPhone = await this.otpRepository.count({
      where: { phone, createdAt: MoreThan(since) },
    });

    if (byPhone >= MAX_REQUESTS_PER_PHONE) {
      throw new ThrottlerException(
        'Too many codes requested for this number. Try again later.',
      );
    }

    if (ip) {
      const byIp = await this.otpRepository.count({
        where: { requestIp: ip, createdAt: MoreThan(since) },
      });

      if (byIp >= MAX_REQUESTS_PER_IP) {
        throw new ThrottlerException('Too many requests. Try again later.');
      }
    }
  }

  private hashCode(phone: string, code: string): string {
    // Phone is mixed in so a hash cannot be replayed against another number.
    return createHmac('sha256', this.secret())
      .update(`${phone}:${code}`)
      .digest('hex');
  }

  private matchesCode(phone: string, code: string, expected: string): boolean {
    const candidate = Buffer.from(this.hashCode(phone, code), 'hex');
    const stored = Buffer.from(expected, 'hex');

    return (
      candidate.length === stored.length && timingSafeEqual(candidate, stored)
    );
  }

  private secret(): string {
    return this.configService.getOrThrow<string>('JWT_SECRET');
  }

  /** Best-effort housekeeping; failures here must not break the request. */
  private async purgeStaleRows(): Promise<void> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    try {
      await this.otpRepository.delete({ createdAt: LessThan(cutoff) });
      await this.tokenRepository.delete({ createdAt: LessThan(cutoff) });
    } catch (error) {
      this.logger.warn(`Failed to purge stale OTP rows: ${error}`);
    }
  }
}
