import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';

export const STAFF_API_KEY_HEADER = 'x-api-key';

@Injectable()
export class StaffApiKeyGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.header(STAFF_API_KEY_HEADER);
    const expected = this.configService.getOrThrow<string>('STAFF_API_KEY');

    if (!provided || !this.matches(provided, expected)) {
      throw new UnauthorizedException('Invalid API key');
    }

    return true;
  }

  private matches(provided: string, expected: string): boolean {
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);

    return a.length === b.length && timingSafeEqual(a, b);
  }
}
