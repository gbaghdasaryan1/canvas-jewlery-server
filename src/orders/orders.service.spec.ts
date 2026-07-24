import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { OrdersService } from './orders.service';
import { Order } from './entities/order.entity';
import { StatusChange } from './entities/status-change.entity';
import { OtpService } from '../otp/otp.service';
import { StlStorageService } from '../storage/stl-storage.service';

const VALID_OPTIONS = {
  product: 'mountains',
  place: { name: 'Yerevan', lat: 40.1792, lng: 44.4991 },
  jewelryType: 'pendant',
  shape: 'circle',
  metal: 'silver',
  width: 25,
  relief: 3,
  thickness: 2,
  areaKm: 12,
  smooth: 1,
  hangPlace: 0,
  hangSize: 4,
  hangRotation: 90,
  hangHorizontal: true,
  ringRotation: 0,
  engraving: 'CAIRN',
  overlays: { buildings: true, streets: false },
  estimate: { amd: 45000, grams: 8.2 },
};

const ORDER_ID = '3f1a9c2e-7b4d-4c8a-9e1f-0a2b3c4d5e6f';

/** A persisted order row, including the stlPath that must never be serialised. */
function orderRow(overrides: Partial<Order> = {}): Order {
  return {
    id: ORDER_ID,
    barcode: '0000001',
    phone: '+37455123456',
    status: 'received',
    options: VALID_OPTIONS,
    stlPath: '/secret/storage/stl/model.stl',
    stlOriginalName: 'model.stl',
    stlSizeBytes: 134,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as Order;
}

function stlFile(): Express.Multer.File {
  const buffer = Buffer.alloc(84 + 50);
  buffer.writeUInt32LE(1, 80);

  return {
    originalname: 'model.stl',
    buffer,
    size: buffer.length,
  } as Express.Multer.File;
}

describe('OrdersService', () => {
  let service: OrdersService;
  let orderRepo: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    findAndCount: jest.Mock;
    findOne: jest.Mock;
    delete: jest.Mock;
  };
  let statusChangeRepo: { find: jest.Mock };
  let otpService: { consumeVerificationToken: jest.Mock };
  let stlStorage: {
    put: jest.Mock;
    delete: jest.Mock;
    presignedDownload: jest.Mock;
    presignedView: jest.Mock;
  };

  beforeEach(async () => {
    orderRepo = {
      create: jest.fn((entity: unknown) => entity),
      save: jest.fn((entity: unknown) => Promise.resolve(entity)),
      find: jest.fn(),
      findAndCount: jest.fn(),
      findOne: jest.fn(),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    statusChangeRepo = {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((entity: unknown) => entity),
      save: jest.fn((entity: unknown) => Promise.resolve(entity)),
    };
    otpService = {
      consumeVerificationToken: jest.fn().mockResolvedValue(undefined),
    };
    stlStorage = {
      // put echoes an s3:// locator built from the stem it was given.
      put: jest.fn((stem: string) =>
        Promise.resolve(`s3://bucket/${stem}.stl`),
      ),
      delete: jest.fn().mockResolvedValue(undefined),
      presignedDownload: jest.fn().mockResolvedValue({
        url: 'https://s3.example/presigned',
        expiresInSec: 300,
        sizeBytes: 134,
      }),
      presignedView: jest.fn().mockResolvedValue({
        url: 'https://s3.example/presigned-view',
        expiresInSec: 300,
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: getRepositoryToken(Order), useValue: orderRepo },
        {
          provide: getRepositoryToken(StatusChange),
          useValue: statusChangeRepo,
        },
        { provide: OtpService, useValue: otpService },
        { provide: StlStorageService, useValue: stlStorage },
        // Runs the transaction callback inline against the same mock repos, so
        // the status workflow is exercised without a database.
        {
          provide: DataSource,
          useValue: {
            transaction: (run: (manager: unknown) => unknown) =>
              run({
                getRepository: (entity: unknown) =>
                  entity === Order ? orderRepo : statusChangeRepo,
              }),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(OrdersService);
  });

  const create = (options: unknown, file = stlFile()) =>
    service.create({
      phone: '+37455123456',
      verificationToken: 'token',
      optionsJson:
        typeof options === 'string' ? options : JSON.stringify(options),
      file,
    });

  it('uploads the STL to S3 keyed [phone]-[barcode] and stores the locator', async () => {
    const order = await create(VALID_OPTIONS);

    expect(order.status).toBe('received');
    expect(stlStorage.put).toHaveBeenCalledWith(
      `+37455123456-${order.barcode}`,
      expect.any(Buffer),
    );
    // The buffer that reached storage is the 134-byte STL from stlFile().
    const putCalls = stlStorage.put.mock.calls as Array<[string, Buffer]>;
    expect(putCalls[0][1]).toHaveLength(134);
    expect(order.stlPath).toBe(`s3://bucket/+37455123456-${order.barcode}.stl`);
  });

  it('accepts a null estimate', async () => {
    const order = await create({ ...VALID_OPTIONS, estimate: null });
    expect(order.options.estimate).toBeNull();
  });

  describe('barcode', () => {
    it('assigns a unique 7-digit, zero-paddable barcode', async () => {
      const order = await create(VALID_OPTIONS);
      expect(order.barcode).toMatch(/^\d{7}$/);
    });

    it('retries with a fresh barcode on a unique-constraint collision', async () => {
      const collision = Object.assign(new Error('duplicate key'), {
        code: '23505',
        detail: 'Key (barcode)=(1234567) already exists.',
      });
      orderRepo.save
        .mockRejectedValueOnce(collision)
        .mockImplementationOnce((entity: unknown) => Promise.resolve(entity));

      const order = await create(VALID_OPTIONS);

      expect(orderRepo.save).toHaveBeenCalledTimes(2);
      expect(stlStorage.put).toHaveBeenCalledTimes(2);
      // The losing attempt's uploaded object is cleaned up.
      expect(stlStorage.delete).toHaveBeenCalledTimes(1);
      const calls = orderRepo.save.mock.calls as Array<[Order]>;
      expect(calls[0][0].barcode).not.toBe(calls[1][0].barcode);
      expect(order.barcode).toMatch(/^\d{7}$/);
    });

    it('does not retry on a non-barcode database error', async () => {
      orderRepo.save.mockRejectedValueOnce(
        Object.assign(new Error('phone constraint'), {
          code: '23505',
          detail: 'Key (phone)=(x) already exists.',
        }),
      );

      await expect(create(VALID_OPTIONS)).rejects.toThrow();
      expect(orderRepo.save).toHaveBeenCalledTimes(1);
    });
  });

  describe('options validation', () => {
    it('rejects malformed JSON', async () => {
      await expect(create('{ not json')).rejects.toThrow(BadRequestException);
    });

    it('rejects a JSON array', async () => {
      await expect(create('[]')).rejects.toThrow(BadRequestException);
    });

    it('rejects an unknown product', async () => {
      await expect(
        create({ ...VALID_OPTIONS, product: 'bracelet' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an out-of-range latitude', async () => {
      await expect(
        create({ ...VALID_OPTIONS, place: { name: 'x', lat: 200, lng: 0 } }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a missing nested object', async () => {
      const { overlays, ...withoutOverlays } = VALID_OPTIONS;
      void overlays;
      await expect(create(withoutOverlays)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('preserves unknown extra fields instead of dropping them', async () => {
      const order = await create({
        ...VALID_OPTIONS,
        futureField: 'keep me',
        nested: { anything: 1 },
      });

      expect(order.options).toMatchObject({
        futureField: 'keep me',
        nested: { anything: 1 },
      });
    });

    it('stores the raw options JSON verbatim', async () => {
      const raw = JSON.stringify({ ...VALID_OPTIONS, futureField: 'x' });
      const order = await service.create({
        phone: '+37455123456',
        verificationToken: 'token',
        optionsJson: raw,
        file: stlFile(),
      });

      expect(order.rawOptions).toBe(raw);
    });

    it('rejects a numeric field sent as a string', async () => {
      await expect(create({ ...VALID_OPTIONS, width: '25' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it.each(['jewelryType', 'shape', 'metal'])(
      'rejects an out-of-enum %s',
      async (field) => {
        await expect(
          create({ ...VALID_OPTIONS, [field]: 'not-a-valid-value' }),
        ).rejects.toThrow(BadRequestException);
      },
    );

    it('rejects a non-integer smooth', async () => {
      await expect(create({ ...VALID_OPTIONS, smooth: 1.5 })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a negative smooth', async () => {
      await expect(create({ ...VALID_OPTIONS, smooth: -1 })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('trims engraving and accepts it', async () => {
      const order = await create({ ...VALID_OPTIONS, engraving: '  hi  ' });
      expect(order.options.engraving).toBe('hi');
    });

    it('accepts an empty engraving', async () => {
      const order = await create({ ...VALID_OPTIONS, engraving: '' });
      expect(order.options.engraving).toBe('');
    });

    it('defaults a missing engraving to an empty string', async () => {
      const { engraving, ...withoutEngraving } = VALID_OPTIONS;
      void engraving;
      const order = await create(withoutEngraving);
      expect(order.options.engraving).toBe('');
    });

    it('rejects an engraving longer than 40 characters', async () => {
      await expect(
        create({ ...VALID_OPTIONS, engraving: 'x'.repeat(41) }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('file validation', () => {
    it('rejects a non-.stl filename', async () => {
      const file = { ...stlFile(), originalname: 'payload.png' };
      await expect(create(VALID_OPTIONS, file)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a .stl name whose contents are not STL', async () => {
      const file = {
        ...stlFile(),
        originalname: 'model.stl',
        buffer: Buffer.from('<?php echo 1; ?>'),
      };
      await expect(create(VALID_OPTIONS, file)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a disallowed content type', async () => {
      const file = { ...stlFile(), mimetype: 'image/png' };
      await expect(create(VALID_OPTIONS, file)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('accepts application/octet-stream', async () => {
      const file = { ...stlFile(), mimetype: 'application/octet-stream' };
      const order = await create(VALID_OPTIONS, file);
      expect(order.status).toBe('received');
    });
  });

  it('does not burn the verification token when validation fails', async () => {
    await expect(
      create({ ...VALID_OPTIONS, product: 'nope' }),
    ).rejects.toThrow();

    expect(otpService.consumeVerificationToken).not.toHaveBeenCalled();
  });

  // OTP verification is temporarily disabled (OTP_VERIFICATION_ENABLED = false
  // in orders.service.ts): an order is created from the phone alone and no
  // verification token is consumed. When OTP is re-enabled, restore the
  // "burns the verification token exactly once on success" assertion.
  it('does not consume a verification token while OTP is disabled', async () => {
    await create(VALID_OPTIONS);

    expect(otpService.consumeVerificationToken).not.toHaveBeenCalled();
  });

  describe('findAll', () => {
    beforeEach(() => {
      orderRepo.findAndCount.mockResolvedValue([[], 0]);
    });

    it('returns a pagination envelope with the effective limit and offset', async () => {
      const result = await service.findAll({ limit: 10, offset: 20 });

      expect(result).toEqual({ items: [], total: 0, limit: 10, offset: 20 });
    });

    it('caps the limit at 200 rather than rejecting it', async () => {
      const result = await service.findAll({ limit: 5000 });

      expect(result.limit).toBe(200);
      expect(orderRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ take: 200 }),
      );
    });

    it('defaults to 50 rows, offset 0, newest first', async () => {
      const result = await service.findAll({});

      expect(result).toMatchObject({ limit: 50, offset: 0 });
      expect(orderRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 50,
          skip: 0,
          order: { createdAt: 'DESC' },
        }),
      );
    });

    it('sorts ascending when asked', async () => {
      await service.findAll({ sort: 'createdAt:asc' });

      expect(orderRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ order: { createdAt: 'ASC' } }),
      );
    });

    it('filters by exact status', async () => {
      await service.findAll({ status: 'shipped' });

      expect(orderRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'shipped' } }),
      );
    });

    it('escapes LIKE wildcards in a phone search', async () => {
      await service.findAll({ phone: '50%_x' });

      const calls = orderRepo.findAndCount.mock.calls as Array<
        [{ where: { phone: { value: string } } }]
      >;
      expect(calls[0][0].where.phone.value).toBe('%50\\%\\_x%');
    });

    it('ignores a blank phone search', async () => {
      await service.findAll({ phone: '   ' });

      expect(orderRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it('never exposes stlPath', async () => {
      orderRepo.findAndCount.mockResolvedValue([[orderRow()], 1]);

      const result = await service.findAll({});

      expect(result.items[0]).not.toHaveProperty('stlPath');
      expect(JSON.stringify(result)).not.toContain('/secret/');
    });

    it('exposes the barcode in list items', async () => {
      orderRepo.findAndCount.mockResolvedValue([[orderRow()], 1]);

      const result = await service.findAll({});

      expect(result.items[0].barcode).toBe('0000001');
    });
  });

  describe('updateStatus', () => {
    beforeEach(() => {
      orderRepo.findOne.mockResolvedValue(orderRow({ status: 'received' }));
    });

    it('persists a legal transition and records it in the audit trail', async () => {
      const result = await service.updateStatus(ORDER_ID, 'in_production');

      expect(result.status).toBe('in_production');
      expect(orderRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'in_production' }),
      );
      expect(statusChangeRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: ORDER_ID,
          fromStatus: 'received',
          toStatus: 'in_production',
        }),
      );
    });

    it('locks the row so concurrent updates cannot both win', async () => {
      await service.updateStatus(ORDER_ID, 'in_production');

      expect(orderRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
      );
    });

    it('rejects an illegal transition with a 409 naming both ends', async () => {
      orderRepo.findOne.mockResolvedValue(orderRow({ status: 'shipped' }));

      await expect(service.updateStatus(ORDER_ID, 'received')).rejects.toThrow(
        new ConflictException(
          'Cannot change status from "shipped" to "received"',
        ),
      );
    });

    it('writes nothing when the transition is refused', async () => {
      orderRepo.findOne.mockResolvedValue(orderRow({ status: 'cancelled' }));

      await expect(service.updateStatus(ORDER_ID, 'shipped')).rejects.toThrow(
        ConflictException,
      );

      expect(orderRepo.save).not.toHaveBeenCalled();
      expect(statusChangeRepo.save).not.toHaveBeenCalled();
    });

    it('refuses to guess a transition for an unrecognised stored status', async () => {
      orderRepo.findOne.mockResolvedValue(orderRow({ status: 'refunded' }));

      await expect(service.updateStatus(ORDER_ID, 'shipped')).rejects.toThrow(
        /not a recognised status/,
      );
    });

    it('404s for an unknown order', async () => {
      orderRepo.findOne.mockResolvedValue(null);

      await expect(
        service.updateStatus(ORDER_ID, 'in_production'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    // orderRow() has phone +37455123456 and barcode 0000001.
    it('deletes the row and the STL object', async () => {
      orderRepo.findOne.mockResolvedValue(orderRow());

      await service.remove(ORDER_ID);

      expect(orderRepo.delete).toHaveBeenCalledWith({ id: ORDER_ID });
      expect(stlStorage.delete).toHaveBeenCalledWith('+37455123456-0000001');
    });

    it('derives the key from phone+barcode, not the stored stlPath', async () => {
      orderRepo.findOne.mockResolvedValue(
        orderRow({ stlPath: 's3://decoy/should-not-be-used.stl' }),
      );

      await service.remove(ORDER_ID);

      expect(stlStorage.delete).toHaveBeenCalledWith('+37455123456-0000001');
    });

    it('still deletes the row when object removal fails', async () => {
      orderRepo.findOne.mockResolvedValue(orderRow());
      stlStorage.delete.mockRejectedValueOnce(new Error('S3 down'));

      await expect(service.remove(ORDER_ID)).resolves.toBeUndefined();
      expect(orderRepo.delete).toHaveBeenCalled();
    });

    it('404s for an unknown order and deletes nothing', async () => {
      orderRepo.findOne.mockResolvedValue(null);

      await expect(service.remove(ORDER_ID)).rejects.toThrow(NotFoundException);
      expect(orderRepo.delete).not.toHaveBeenCalled();
      expect(stlStorage.delete).not.toHaveBeenCalled();
    });

    it.each(['received', 'in_production', 'shipped', 'cancelled'])(
      'allows deleting an order in %s',
      async (status) => {
        orderRepo.findOne.mockResolvedValue(orderRow({ status }));

        await expect(service.remove(ORDER_ID)).resolves.toBeUndefined();
      },
    );
  });

  describe('getStlDownloadLink', () => {
    it('returns a presigned URL for the phone+barcode key', async () => {
      orderRepo.findOne.mockResolvedValue(orderRow());

      const result = await service.getStlDownloadLink(ORDER_ID);

      expect(stlStorage.presignedDownload).toHaveBeenCalledWith(
        '+37455123456-0000001',
        '+37455123456-0000001.stl',
      );
      expect(result).toEqual({
        url: 'https://s3.example/presigned',
        expiresInSec: 300,
      });
    });

    it('derives the key from phone+barcode, not the stored stlPath', async () => {
      orderRepo.findOne.mockResolvedValue(
        orderRow({ stlPath: 's3://decoy/should-not-be-used.stl' }),
      );

      await service.getStlDownloadLink(ORDER_ID);

      expect(stlStorage.presignedDownload).toHaveBeenCalledWith(
        '+37455123456-0000001',
        expect.any(String),
      );
    });

    it('propagates a 404 when the object is gone', async () => {
      orderRepo.findOne.mockResolvedValue(orderRow());
      stlStorage.presignedDownload.mockRejectedValueOnce(
        new NotFoundException('STL file is no longer available'),
      );

      await expect(service.getStlDownloadLink(ORDER_ID)).rejects.toThrow(
        new NotFoundException('STL file is no longer available'),
      );
    });

    it('404s with the generic message when the order does not exist', async () => {
      orderRepo.findOne.mockResolvedValue(null);

      await expect(service.getStlDownloadLink(ORDER_ID)).rejects.toThrow(
        new NotFoundException('Order not found'),
      );
      expect(stlStorage.presignedDownload).not.toHaveBeenCalled();
    });

    it('logs but tolerates a size drift between S3 and the database', async () => {
      orderRepo.findOne.mockResolvedValue(orderRow({ stlSizeBytes: 999 }));
      stlStorage.presignedDownload.mockResolvedValueOnce({
        url: 'https://s3.example/presigned',
        expiresInSec: 300,
        sizeBytes: 7,
      });

      const result = await service.getStlDownloadLink(ORDER_ID);

      expect(result.url).toBe('https://s3.example/presigned');
    });
  });
});
