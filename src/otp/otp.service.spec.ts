import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { getRepositoryToken } from '@nestjs/typeorm';
import { createHmac } from 'node:crypto';
import { OtpService } from './otp.service';
import { Otp } from './entities/otp.entity';
import { VerificationToken } from './entities/verification-token.entity';

const SECRET = 'test-secret-that-is-at-least-32-chars-long';
const PHONE = '+37455123456';

function hashOf(phone: string, code: string): string {
  return createHmac('sha256', SECRET).update(`${phone}:${code}`).digest('hex');
}

/** `expect.any` is typed `any`; pin it once so matchers stay lint-clean. */
const ANY_DATE = expect.any(Date) as unknown as Date;

function mockRepo() {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn((entity: unknown) => entity),
    save: jest.fn((entity: unknown) => Promise.resolve(entity)),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    increment: jest.fn().mockResolvedValue({ affected: 1 }),
    delete: jest.fn().mockResolvedValue({ affected: 0 }),
  };
}

describe('OtpService', () => {
  let service: OtpService;
  let otpRepo: ReturnType<typeof mockRepo>;
  let tokenRepo: ReturnType<typeof mockRepo>;
  let jwt: JwtService;

  beforeEach(async () => {
    otpRepo = mockRepo();
    tokenRepo = mockRepo();
    jwt = new JwtService({ secret: SECRET });

    const moduleRef = await Test.createTestingModule({
      providers: [
        OtpService,
        { provide: getRepositoryToken(Otp), useValue: otpRepo },
        { provide: getRepositoryToken(VerificationToken), useValue: tokenRepo },
        { provide: JwtService, useValue: jwt },
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => SECRET, get: () => SECRET },
        },
      ],
    }).compile();

    service = moduleRef.get(OtpService);
  });

  describe('createAndStore', () => {
    it('stores a 6-digit code as a hash, never in plaintext', async () => {
      const { code, expiresInSec } = await service.createAndStore(
        PHONE,
        '1.2.3.4',
      );

      expect(code).toMatch(/^\d{6}$/);
      expect(expiresInSec).toBe(300);

      const saved = otpRepo.save.mock.calls[0][0] as Otp;
      expect(saved.codeHash).toBe(hashOf(PHONE, code));
      expect(JSON.stringify(saved)).not.toContain(code);
    });

    it('invalidates any previously live code for the phone', async () => {
      await service.createAndStore(PHONE, '1.2.3.4');

      expect(otpRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({ phone: PHONE }),
        expect.objectContaining({ consumedAt: ANY_DATE }),
      );
    });

    it('throttles once the per-phone limit is reached', async () => {
      otpRepo.count.mockResolvedValueOnce(3);

      await expect(service.createAndStore(PHONE, '1.2.3.4')).rejects.toThrow(
        ThrottlerException,
      );
      expect(otpRepo.save).not.toHaveBeenCalled();
    });

    it('throttles once the per-IP limit is reached', async () => {
      otpRepo.count
        .mockResolvedValueOnce(0) // per-phone
        .mockResolvedValueOnce(10); // per-IP

      await expect(service.createAndStore(PHONE, '1.2.3.4')).rejects.toThrow(
        ThrottlerException,
      );
    });

    it('returns the stored row id so a failed send can roll it back', async () => {
      otpRepo.save.mockResolvedValueOnce({ id: 'otp-123', phone: PHONE });

      const result = await service.createAndStore(PHONE, '1.2.3.4');

      expect(result.id).toBe('otp-123');
    });
  });

  describe('discard', () => {
    it('deletes the stored code by id', async () => {
      await service.discard('otp-123');

      expect(otpRepo.delete).toHaveBeenCalledWith('otp-123');
    });
  });

  describe('verify', () => {
    const liveOtp = (overrides: Partial<Otp> = {}): Otp =>
      ({
        id: 'otp-1',
        phone: PHONE,
        codeHash: hashOf(PHONE, '123456'),
        expiresAt: new Date(Date.now() + 60_000),
        attempts: 0,
        consumedAt: null,
        ...overrides,
      }) as Otp;

    it('returns a token bound to the phone on a correct code', async () => {
      otpRepo.findOne.mockResolvedValue(liveOtp());

      const token = await service.verify(PHONE, '123456');
      const payload = jwt.verify<{ sub: string; jti: string }>(token);

      expect(payload.sub).toBe(PHONE);
      expect(payload.jti).toEqual(expect.any(String));
    });

    it('burns the code after a successful verify', async () => {
      otpRepo.findOne.mockResolvedValue(liveOtp());

      await service.verify(PHONE, '123456');

      expect(otpRepo.update).toHaveBeenCalledWith('otp-1', {
        consumedAt: ANY_DATE,
      });
    });

    it('rejects a wrong code with 401', async () => {
      otpRepo.findOne.mockResolvedValue(liveOtp());

      await expect(service.verify(PHONE, '000000')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('counts a wrong guess as an attempt', async () => {
      otpRepo.findOne.mockResolvedValue(liveOtp());

      await expect(service.verify(PHONE, '000000')).rejects.toThrow();
      expect(otpRepo.increment).toHaveBeenCalledWith(
        { id: 'otp-1' },
        'attempts',
        1,
      );
    });

    it('rejects an expired code with 401', async () => {
      otpRepo.findOne.mockResolvedValue(
        liveOtp({ expiresAt: new Date(Date.now() - 1) }),
      );

      await expect(service.verify(PHONE, '123456')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throttles and burns the code once attempts are exhausted', async () => {
      otpRepo.findOne.mockResolvedValue(liveOtp({ attempts: 5 }));

      await expect(service.verify(PHONE, '123456')).rejects.toThrow(
        ThrottlerException,
      );
      expect(otpRepo.update).toHaveBeenCalledWith('otp-1', {
        consumedAt: ANY_DATE,
      });
    });

    it('rejects when no code was ever requested', async () => {
      otpRepo.findOne.mockResolvedValue(null);

      await expect(service.verify(PHONE, '123456')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('does not accept a code issued for a different phone', async () => {
      otpRepo.findOne.mockResolvedValue(
        liveOtp({ codeHash: hashOf('+37499999999', '123456') }),
      );

      await expect(service.verify(PHONE, '123456')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('consumeVerificationToken', () => {
    it('accepts a valid unused token and marks it consumed', async () => {
      otpRepo.findOne.mockResolvedValue({
        id: 'otp-1',
        phone: PHONE,
        codeHash: hashOf(PHONE, '123456'),
        expiresAt: new Date(Date.now() + 60_000),
        attempts: 0,
        consumedAt: null,
      });

      const token = await service.verify(PHONE, '123456');

      await expect(
        service.consumeVerificationToken(token, PHONE),
      ).resolves.toBeUndefined();
      expect(tokenRepo.update).toHaveBeenCalled();
    });

    it('rejects replay — the second use affects no rows', async () => {
      otpRepo.findOne.mockResolvedValue({
        id: 'otp-1',
        phone: PHONE,
        codeHash: hashOf(PHONE, '123456'),
        expiresAt: new Date(Date.now() + 60_000),
        attempts: 0,
        consumedAt: null,
      });

      const token = await service.verify(PHONE, '123456');
      await service.consumeVerificationToken(token, PHONE);

      tokenRepo.update.mockResolvedValueOnce({ affected: 0 });

      await expect(
        service.consumeVerificationToken(token, PHONE),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a token presented with a different phone', async () => {
      otpRepo.findOne.mockResolvedValue({
        id: 'otp-1',
        phone: PHONE,
        codeHash: hashOf(PHONE, '123456'),
        expiresAt: new Date(Date.now() + 60_000),
        attempts: 0,
        consumedAt: null,
      });

      const token = await service.verify(PHONE, '123456');

      await expect(
        service.consumeVerificationToken(token, '+37499999999'),
      ).rejects.toThrow(UnauthorizedException);
      expect(tokenRepo.update).not.toHaveBeenCalled();
    });

    it('rejects a token signed with a different secret', async () => {
      const forged = new JwtService({
        secret: 'a-completely-different-secret',
      }).sign({ sub: PHONE }, { jwtid: 'forged' });

      await expect(
        service.consumeVerificationToken(forged, PHONE),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects garbage', async () => {
      await expect(
        service.consumeVerificationToken('not-a-jwt', PHONE),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
