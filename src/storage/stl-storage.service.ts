import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { buildContentDisposition } from '../orders/stl-download';

export const STL_CONTENT_TYPE = 'model/stl';

export interface PresignedUrl {
  url: string;
  expiresInSec: number;
}

export interface PresignedDownload extends PresignedUrl {
  sizeBytes: number;
}

/**
 * Owns all S3 access for order STLs. Object keys are `<prefix><stem>.stl`, where
 * the stem is `[phone]-[barcode]` built from server-controlled values — never
 * from client input — so a key can neither be forged nor point outside the
 * bucket's prefix.
 *
 * Downloads are served as short-lived presigned GET URLs, so the bucket stays
 * private and the file bytes never pass th. rough this server.
 */
@Injectable()
export class StlStorageService implements OnModuleDestroy {
  private readonly logger = new Logger(StlStorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;
  private readonly presignTtlSec: number;

  constructor(private readonly configService: ConfigService) {
    this.bucket = this.configService.getOrThrow<string>('S3_BUCKET');
    this.prefix = this.configService.get<string>('S3_PREFIX', '');
    this.presignTtlSec = Number(
      this.configService.get<string>('S3_PRESIGN_TTL_SEC', '300'),
    );

    const endpoint = this.configService.get<string>('S3_ENDPOINT');

    this.client = new S3Client({
      region: this.configService.getOrThrow<string>('AWS_REGION'),
      // A custom endpoint (LocalStack/MinIO) needs path-style addressing.
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      credentials: {
        accessKeyId: this.configService.getOrThrow<string>('AWS_ACCESS_KEY_ID'),
        secretAccessKey: this.configService.getOrThrow<string>(
          'AWS_SECRET_ACCESS_KEY',
        ),
      },
    });
  }

  onModuleDestroy(): void {
    this.client.destroy();
  }

  /** Uploads the STL and returns an `s3://bucket/key` locator to persist. */
  async put(stem: string, body: Buffer): Promise<string> {
    const key = this.keyFor(stem);

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: STL_CONTENT_TYPE,
        ContentLength: body.length,
      }),
    );

    return `s3://${this.bucket}/${key}`;
  }

  /** Deletes the STL. A missing object is not an error (idempotent). */
  async delete(stem: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: this.keyFor(stem) }),
    );
  }

  /**
   * Confirms the object exists (so a row that outlived its file yields a clean
   * 404), then returns a short-lived presigned GET URL that forces a download
   * named `filename`.
   */
  async presignedDownload(
    stem: string,
    filename: string,
  ): Promise<PresignedDownload> {
    const key = this.keyFor(stem);
    let sizeBytes: number;

    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      sizeBytes = head.ContentLength ?? 0;
    } catch (error) {
      if (isNotFound(error)) {
        this.logger.error(
          `STL missing in S3 (s3://${this.bucket}/${key}) — storage has drifted from the database`,
        );
        throw new NotFoundException('STL file is no longer available');
      }
      throw error;
    }

    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentType: STL_CONTENT_TYPE,
        ResponseContentDisposition: buildContentDisposition(filename),
      }),
      { expiresIn: this.presignTtlSec },
    );

    return { url, expiresInSec: this.presignTtlSec, sizeBytes };
  }

  /**
   * A short-lived presigned GET URL for viewing the STL inline — e.g. an admin
   * 3D preview or an "open in browser" link. Unlike {@link presignedDownload}
   * it neither forces an attachment nor HEADs the object first, so it is cheap
   * enough to attach to every order-detail response. If the object has drifted
   * out of the bucket the URL simply fails when used; the surrounding order
   * still loads.
   */
  async presignedView(stem: string, filename: string): Promise<PresignedUrl> {
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: this.keyFor(stem),
        ResponseContentType: STL_CONTENT_TYPE,
        ResponseContentDisposition: buildContentDisposition(filename, 'inline'),
      }),
      { expiresIn: this.presignTtlSec },
    );

    return { url, expiresInSec: this.presignTtlSec };
  }

  private keyFor(stem: string): string {
    return `${this.prefix}${stem}.stl`;
  }
}

/** S3 signals a missing key as NoSuchKey/NotFound or a 404 in `$metadata`. */
function isNotFound(error: unknown): boolean {
  const { name, $metadata } = (error ?? {}) as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };

  return (
    name === 'NoSuchKey' ||
    name === 'NotFound' ||
    $metadata?.httpStatusCode === 404
  );
}
