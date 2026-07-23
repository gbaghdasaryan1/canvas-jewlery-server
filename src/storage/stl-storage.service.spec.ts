import { NotFoundException } from '@nestjs/common';
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StlStorageService } from './stl-storage.service';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(),
}));

const mockedGetSignedUrl = getSignedUrl as jest.MockedFunction<
  typeof getSignedUrl
>;

const CONFIG: Record<string, string> = {
  S3_BUCKET: 'test-bucket',
  S3_PREFIX: 'stl/',
  S3_PRESIGN_TTL_SEC: '300',
  AWS_REGION: 'us-east-1',
  AWS_ACCESS_KEY_ID: 'key',
  AWS_SECRET_ACCESS_KEY: 'secret',
};

function makeService(send: jest.Mock): StlStorageService {
  const configService = {
    get: (key: string, fallback?: string) => CONFIG[key] ?? fallback,
    getOrThrow: (key: string) => {
      if (CONFIG[key] === undefined) throw new Error(`missing ${key}`);
      return CONFIG[key];
    },
  };

  const service = new StlStorageService(configService as never);
  // Swap the real S3 client for a mock whose send() we control.
  (service as unknown as { client: { send: jest.Mock } }).client = { send };
  return service;
}

const STEM = '+37455123456-0042317';

describe('StlStorageService', () => {
  beforeEach(() => mockedGetSignedUrl.mockReset());

  describe('put', () => {
    it('uploads under <prefix><stem>.stl and returns an s3:// locator', async () => {
      const send = jest.fn().mockResolvedValue({});
      const service = makeService(send);

      const locator = await service.put(STEM, Buffer.from('solid'));

      expect(locator).toBe('s3://test-bucket/stl/+37455123456-0042317.stl');
      const calls = send.mock.calls as Array<[PutObjectCommand]>;
      const command = calls[0][0];
      expect(command).toBeInstanceOf(PutObjectCommand);
      expect(command.input.Key).toBe('stl/+37455123456-0042317.stl');
      expect(command.input.Bucket).toBe('test-bucket');
      expect(command.input.ContentType).toBe('model/stl');
    });
  });

  describe('delete', () => {
    it('deletes the derived key', async () => {
      const send = jest.fn().mockResolvedValue({});
      const service = makeService(send);

      await service.delete(STEM);

      const calls = send.mock.calls as Array<[DeleteObjectCommand]>;
      const command = calls[0][0];
      expect(command).toBeInstanceOf(DeleteObjectCommand);
      expect(command.input.Key).toBe('stl/+37455123456-0042317.stl');
    });
  });

  describe('presignedDownload', () => {
    it('heads the object, then returns a presigned URL and its size', async () => {
      const send = jest.fn().mockResolvedValue({ ContentLength: 134 });
      const service = makeService(send);
      mockedGetSignedUrl.mockResolvedValue('https://s3.example/signed');

      const result = await service.presignedDownload(
        STEM,
        '+37455123456-0042317.stl',
      );

      const headCalls = send.mock.calls as Array<[HeadObjectCommand]>;
      expect(headCalls[0][0]).toBeInstanceOf(HeadObjectCommand);
      expect(result).toEqual({
        url: 'https://s3.example/signed',
        expiresInSec: 300,
        sizeBytes: 134,
      });
      expect(mockedGetSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { expiresIn: 300 },
      );
    });

    it('404s when the object is missing', async () => {
      const notFound = Object.assign(new Error('not found'), {
        name: 'NotFound',
        $metadata: { httpStatusCode: 404 },
      });
      const service = makeService(jest.fn().mockRejectedValue(notFound));

      await expect(service.presignedDownload(STEM, 'x.stl')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockedGetSignedUrl).not.toHaveBeenCalled();
    });

    it('rethrows a non-404 head failure', async () => {
      const boom = Object.assign(new Error('access denied'), {
        name: 'AccessDenied',
        $metadata: { httpStatusCode: 403 },
      });
      const service = makeService(jest.fn().mockRejectedValue(boom));

      await expect(service.presignedDownload(STEM, 'x.stl')).rejects.toThrow(
        'access denied',
      );
    });
  });
});
