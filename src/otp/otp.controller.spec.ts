import { BadGatewayException } from '@nestjs/common';
import { OtpController } from './otp.controller';
import { OtpService } from './otp.service';
import { SmsDeliveryError, SmsService } from '../sms/sms.service';

describe('OtpController', () => {
  let controller: OtpController;
  let otpService: {
    createAndStore: jest.Mock;
    discard: jest.Mock;
    verify: jest.Mock;
  };
  let smsService: { send: jest.Mock };

  const PHONE = '+37455123456';

  beforeEach(() => {
    otpService = {
      createAndStore: jest
        .fn()
        .mockResolvedValue({ id: 'otp-1', code: '123456', expiresInSec: 300 }),
      discard: jest.fn().mockResolvedValue(undefined),
      verify: jest.fn(),
    };
    smsService = { send: jest.fn().mockResolvedValue(undefined) };

    controller = new OtpController(
      otpService as unknown as OtpService,
      smsService as unknown as SmsService,
    );
  });

  describe('request', () => {
    it('sends the code and returns the TTL on success', async () => {
      const result = await controller.request({ phone: PHONE }, '1.2.3.4');

      expect(result).toEqual({ expiresInSec: 300 });
      expect(smsService.send).toHaveBeenCalledWith(
        PHONE,
        expect.stringContaining('123456'),
      );
      expect(otpService.discard).not.toHaveBeenCalled();
    });

    it('rolls back the code and 502s when delivery fails', async () => {
      smsService.send.mockRejectedValueOnce(new SmsDeliveryError(21266));

      await expect(
        controller.request({ phone: PHONE }, '1.2.3.4'),
      ).rejects.toBeInstanceOf(BadGatewayException);

      // The undelivered code is discarded so it neither lingers nor burns a slot.
      expect(otpService.discard).toHaveBeenCalledWith('otp-1');
    });

    it('does not swallow an unexpected non-delivery error', async () => {
      smsService.send.mockRejectedValueOnce(new Error('boom'));

      await expect(
        controller.request({ phone: PHONE }, '1.2.3.4'),
      ).rejects.toThrow('boom');
      expect(otpService.discard).not.toHaveBeenCalled();
    });
  });
});
