import { ConfigService } from '@nestjs/config';
import { SmsDeliveryError, SmsService } from './sms.service';

function makeService(config: Record<string, string | undefined>): SmsService {
  return new SmsService({
    get: (key: string) => config[key],
  } as unknown as ConfigService);
}

describe('SmsService', () => {
  describe('dev fallback (no Twilio credentials)', () => {
    it('logs instead of sending and does not throw', async () => {
      const service = makeService({});
      service.onModuleInit();

      await expect(
        service.send('+37455123456', 'hello'),
      ).resolves.toBeUndefined();
    });
  });

  describe('with a Twilio client', () => {
    function withClient(create: jest.Mock): SmsService {
      const service = makeService({
        TWILIO_ACCOUNT_SID: 'AC',
        TWILIO_AUTH_TOKEN: 'tok',
        TWILIO_FROM: '+15550000000',
      });
      // Skip onModuleInit's real Twilio construction; inject a fake client.
      (
        service as unknown as {
          client: { messages: { create: jest.Mock } };
          from: string;
        }
      ).client = { messages: { create } };
      (service as unknown as { from: string }).from = '+15550000000';
      return service;
    }

    it('sends via Twilio on the happy path', async () => {
      const create = jest.fn().mockResolvedValue({ sid: 'SM1' });
      const service = withClient(create);

      await service.send('+37455123456', 'code 123456');

      expect(create).toHaveBeenCalledWith({
        to: '+37455123456',
        from: '+15550000000',
        body: 'code 123456',
      });
    });

    it('wraps a Twilio failure in SmsDeliveryError carrying the provider code', async () => {
      const create = jest.fn().mockRejectedValue(
        Object.assign(new Error("'To' and 'From' cannot be the same"), {
          code: 21266,
        }),
      );
      const service = withClient(create);

      await expect(service.send('+37455123456', 'x')).rejects.toMatchObject({
        name: 'SmsDeliveryError',
        providerCode: 21266,
      });
      await expect(service.send('+37455123456', 'x')).rejects.toBeInstanceOf(
        SmsDeliveryError,
      );
    });
  });
});
