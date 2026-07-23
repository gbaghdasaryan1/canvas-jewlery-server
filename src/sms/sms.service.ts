import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Twilio } from 'twilio';

/**
 * Thrown when the SMS provider rejects or fails a send. Callers translate this
 * into a 502 and roll back any state that assumed delivery. `providerCode` is
 * the Twilio error code (e.g. 21266) when available.
 */
export class SmsDeliveryError extends Error {
  constructor(readonly providerCode?: number) {
    super('SMS delivery failed');
    this.name = 'SmsDeliveryError';
  }
}

@Injectable()
export class SmsService implements OnModuleInit {
  private readonly logger = new Logger(SmsService.name);
  private client: Twilio | null = null;
  private from: string | undefined;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const accountSid = this.configService.get<string>('TWILIO_ACCOUNT_SID');
    const authToken = this.configService.get<string>('TWILIO_AUTH_TOKEN');
    this.from = this.configService.get<string>('TWILIO_FROM');

    if (accountSid && authToken && this.from) {
      this.client = new Twilio(accountSid, authToken);
      this.logger.log('Twilio client initialised');
      return;
    }

    this.logger.warn(
      'Twilio credentials absent — SMS will be logged to console instead of sent (dev mode)',
    );
  }

  async send(to: string, body: string): Promise<void> {
    if (!this.client || !this.from) {
      this.logger.warn(`[dev-sms] to=${to} body=${body}`);
      return;
    }

    try {
      await this.client.messages.create({ to, from: this.from, body });
    } catch (error) {
      const { code, message } = error as { code?: number; message?: string };
      this.logger.error(
        `Twilio send to ${to} failed${code ? ` (code ${code})` : ''}: ${
          message ?? String(error)
        }`,
      );
      throw new SmsDeliveryError(code);
    }
  }
}
