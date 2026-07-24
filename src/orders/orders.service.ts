import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { ValidationError, validateOrReject } from 'class-validator';
import { DataSource, FindOptionsWhere, ILike, Repository } from 'typeorm';
import { randomInt, randomUUID } from 'node:crypto';
import { Order, ORDER_STATUS_RECEIVED } from './entities/order.entity';
import { StatusChange } from './entities/status-change.entity';
import { OrderOptionsDto } from './dto/order-options.dto';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import {
  OrderDetailResponseDto,
  OrderResponseDto,
  PaginatedOrdersDto,
} from './dto/order-response.dto';
import { OrderStatus, canTransition, isOrderStatus } from './order-status';
import { stlDownloadFilename, stlFileStem } from './stl-download';
import { OtpService } from '../otp/otp.service';
import {
  PresignedUrl,
  StlStorageService,
} from '../storage/stl-storage.service';
import {
  hasStlExtension,
  isAllowedStlMimetype,
  isStlBuffer,
} from './stl.validation';

/**
 * Whether order creation requires a valid OTP verification token. Temporarily
 * disabled: orders are created from a phone number alone, with no SMS step.
 * Flip back to `true` (and make `verificationToken` required again in
 * CreateOrderDto) to re-enable OTP verification.
 */
const OTP_VERIFICATION_ENABLED = false;

/** Hard ceiling on page size, regardless of what the caller asks for. */
export const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;

/** Digits in an order barcode, and how many collisions to ride out. */
export const BARCODE_DIGITS = 7;
const BARCODE_UPPER_BOUND = 10 ** BARCODE_DIGITS; // 10_000_000
const BARCODE_MAX_ATTEMPTS = 8;

/** A zero-padded 7-digit barcode, e.g. "0042317". */
export function generateBarcode(): string {
  return randomInt(0, BARCODE_UPPER_BOUND)
    .toString()
    .padStart(BARCODE_DIGITS, '0');
}

/** True for a Postgres unique-violation (23505) on the barcode index. */
function isBarcodeUniqueViolation(error: unknown): boolean {
  const driver = (error as { driverError?: unknown }).driverError ?? error;
  const { code, detail, constraint } = (driver ?? {}) as {
    code?: string;
    detail?: string;
    constraint?: string;
  };

  return (
    code === '23505' &&
    (`${detail ?? ''}`.toLowerCase().includes('barcode') ||
      `${constraint ?? ''}`.toLowerCase().includes('barcode'))
  );
}

export interface StlDownloadLink {
  url: string;
  expiresInSec: number;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(StatusChange)
    private readonly statusChangeRepository: Repository<StatusChange>,
    private readonly otpService: OtpService,
    private readonly stlStorage: StlStorageService,
    private readonly dataSource: DataSource,
  ) {}

  async create(input: {
    phone: string;
    verificationToken?: string;
    optionsJson: string;
    file: Express.Multer.File;
  }): Promise<Order> {
    const options = await this.parseOptions(input.optionsJson);

    this.assertStlFile(input.file);

    // OTP verification is temporarily disabled: an order is created from the
    // phone number alone. When OTP_VERIFICATION_ENABLED is flipped back on this
    // throws 401 unless the token is valid, bound to this phone, and unused.
    // Done after cheap validation so a malformed request cannot burn a token.
    if (OTP_VERIFICATION_ENABLED) {
      await this.otpService.consumeVerificationToken(
        input.verificationToken ?? '',
        input.phone,
      );
    }

    const id = randomUUID();

    return this.persistWithUniqueBarcode(
      {
        id,
        phone: input.phone,
        status: ORDER_STATUS_RECEIVED,
        options,
        // The exact JSON string received, kept verbatim so unknown/new fields
        // survive even if the parsed view or DTO ever changes shape.
        rawOptions: input.optionsJson,
        stlOriginalName: input.file.originalname.slice(0, 255),
        stlSizeBytes: input.file.size,
      },
      input.file.buffer,
    );
  }

  /**
   * Assigns a fresh 7-digit barcode, uploads the STL to S3 under
   * `[phone]-[barcode].stl`, and inserts the row — retrying on the (rare)
   * unique-constraint collision.
   *
   * The object key needs the barcode, so the barcode is chosen per attempt and
   * the upload happens before the insert; a saved order therefore always has its
   * object. If the insert loses a barcode race, that attempt's object is removed
   * and a new barcode is tried. The DB unique index is the real guarantee — this
   * loop just turns a lost race into a new number rather than a 500.
   */
  private async persistWithUniqueBarcode(
    base: Omit<Order, 'barcode' | 'createdAt' | 'stlPath'>,
    buffer: Buffer,
  ): Promise<Order> {
    for (let attempt = 1; attempt <= BARCODE_MAX_ATTEMPTS; attempt++) {
      const barcode = generateBarcode();
      // Key derives only from server-controlled values (validated phone,
      // generated barcode), never from client input.
      const stem = stlFileStem(base.phone, barcode);

      const stlPath = await this.stlStorage.put(stem, buffer);

      try {
        return await this.orderRepository.save(
          this.orderRepository.create({ ...base, barcode, stlPath }),
        );
      } catch (error) {
        await this.stlStorage.delete(stem).catch(() => undefined);

        if (attempt < BARCODE_MAX_ATTEMPTS && isBarcodeUniqueViolation(error)) {
          this.logger.warn(
            `Barcode ${barcode} collided; retrying (attempt ${attempt}/${BARCODE_MAX_ATTEMPTS})`,
          );
          continue;
        }

        throw error;
      }
    }

    // Unreachable: the final attempt either returns or throws above.
    throw new ServiceUnavailableException(
      'Could not allocate a unique barcode; please retry',
    );
  }

  async findAll(query: ListOrdersQueryDto): Promise<PaginatedOrdersDto> {
    const limit = Math.min(query.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const offset = query.offset ?? 0;
    const where: FindOptionsWhere<Order> = {};

    if (query.status) {
      where.status = query.status;
    }

    const phone = query.phone?.trim();

    if (phone) {
      where.phone = ILike(`%${escapeLikePattern(phone)}%`);
    }

    const [rows, total] = await this.orderRepository.findAndCount({
      where,
      order: { createdAt: query.sort === 'createdAt:asc' ? 'ASC' : 'DESC' },
      take: limit,
      skip: offset,
    });

    return {
      items: rows.map((row) => OrderResponseDto.fromEntity(row)),
      total,
      limit,
      offset,
    };
  }

  async findOne(id: string): Promise<Order> {
    const order = await this.orderRepository.findOne({ where: { id } });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return order;
  }

  async findOneDetail(id: string): Promise<OrderDetailResponseDto> {
    const order = await this.findOne(id);

    const [changes, stl] = await Promise.all([
      this.findStatusHistory(id),
      this.stlViewLink(order),
    ]);

    return OrderDetailResponseDto.fromEntityWithHistory(order, changes, stl);
  }

  /**
   * A short-lived presigned S3 URL for viewing the order's STL inline. The
   * object key is re-derived from the order's own phone and barcode — never the
   * stored `stlPath` column. Signing is a local operation (no S3 round-trip),
   * so this is cheap enough to attach to every detail response.
   */
  private stlViewLink(order: Order): Promise<PresignedUrl> {
    return this.stlStorage.presignedView(
      stlFileStem(order.phone, order.barcode),
      stlDownloadFilename(order.phone, order.barcode),
    );
  }

  /**
   * Moves an order to `next`, refusing any transition the state machine does
   * not allow. The read and the write share one transaction with a row lock so
   * two concurrent PATCHes cannot both observe the same starting status and
   * both be accepted.
   */
  async updateStatus(
    id: string,
    next: OrderStatus,
  ): Promise<OrderDetailResponseDto> {
    return this.dataSource.transaction(async (manager) => {
      const orders = manager.getRepository(Order);
      const order = await orders.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });

      if (!order) {
        throw new NotFoundException('Order not found');
      }

      const current = order.status;

      // A status outside the state machine means the row predates the workflow
      // or was edited by hand; refuse rather than guess a transition for it.
      if (!isOrderStatus(current)) {
        throw new ConflictException(
          `Cannot change status from "${current}" to "${next}": "${current}" is not a recognised status`,
        );
      }

      if (!canTransition(current, next)) {
        throw new ConflictException(
          `Cannot change status from "${current}" to "${next}"`,
        );
      }

      order.status = next;
      await orders.save(order);

      const changes = manager.getRepository(StatusChange);
      await changes.save(
        changes.create({ orderId: id, fromStatus: current, toStatus: next }),
      );

      return OrderDetailResponseDto.fromEntityWithHistory(
        order,
        await changes.find({
          where: { orderId: id },
          order: { createdAt: 'ASC' },
        }),
        await this.stlViewLink(order),
      );
    });
  }

  /**
   * Permanently deletes an order: the row, its audit trail (via the
   * `status_changes` foreign key's ON DELETE CASCADE), and the STL on disk.
   *
   * The database row goes first. The reverse order would leave a row whose file
   * is missing if the second step failed — an order that looks fine in the list
   * but 404s on download. An orphaned file is the safer failure: harmless,
   * logged, and reclaimable.
   */
  async remove(id: string): Promise<void> {
    const order = await this.findOne(id);

    // Key re-derived from the order's own phone and barcode, not the stored
    // stlPath column.
    const stem = stlFileStem(order.phone, order.barcode);

    await this.orderRepository.delete({ id: order.id });

    try {
      await this.stlStorage.delete(stem);
    } catch (error) {
      // An orphaned object is the safer failure: harmless, logged, reclaimable.
      this.logger.error(
        `Deleted order ${order.id} but could not remove its STL object: ${String(error)}`,
      );
    }

    // Deletion is irreversible and leaves no audit row behind, so the log is
    // the only remaining trace that this order ever existed.
    this.logger.warn(
      `Deleted order ${order.id} (phone ${order.phone}, status ${order.status}, file ${order.stlOriginalName})`,
    );
  }

  findStatusHistory(orderId: string): Promise<StatusChange[]> {
    return this.statusChangeRepository.find({
      where: { orderId },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Returns a short-lived presigned S3 URL for the order's STL. The object key
   * is re-derived from the order's own phone and barcode — never the stored
   * `stlPath` column — and a missing object yields a clean 404.
   */
  async getStlDownloadLink(id: string): Promise<StlDownloadLink> {
    const order = await this.findOne(id);
    const stem = stlFileStem(order.phone, order.barcode);

    const { url, expiresInSec, sizeBytes } =
      await this.stlStorage.presignedDownload(
        stem,
        stlDownloadFilename(order.phone, order.barcode),
      );

    if (sizeBytes !== order.stlSizeBytes) {
      // Not fatal — the object is authoritative — but drift is worth an alert.
      this.logger.error(
        `STL size mismatch for order ${order.id}: database says ${order.stlSizeBytes} bytes, S3 has ${sizeBytes}`,
      );
    }

    return { url, expiresInSec };
  }

  private async parseOptions(raw: string): Promise<OrderOptionsDto> {
    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BadRequestException('options must be valid JSON');
    }

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new BadRequestException('options must be a JSON object');
    }

    const dto = plainToInstance(OrderOptionsDto, parsed, {
      enableImplicitConversion: false,
    });

    try {
      // Known fields are validated; unknown keys are deliberately neither
      // stripped nor rejected, so a field the frontend adds later still ingests
      // and round-trips. The verbatim payload is also kept in Order.rawOptions.
      await validateOrReject(dto, {
        whitelist: false,
        forbidNonWhitelisted: false,
      });
    } catch (errors) {
      const list: ValidationError[] = Array.isArray(errors)
        ? (errors as ValidationError[])
        : [errors as ValidationError];

      const details = list
        .map((error) => Object.values(error.constraints ?? {}).join(', '))
        .filter(Boolean)
        .join('; ');

      throw new BadRequestException(`Invalid options: ${details}`);
    }

    // engraving is optional on the wire but always stored as a string.
    dto.engraving ??= '';

    return dto;
  }

  private assertStlFile(file: Express.Multer.File): void {
    if (!file) {
      throw new BadRequestException('stl file is required');
    }

    if (!hasStlExtension(file.originalname)) {
      throw new BadRequestException('stl must be a .stl file');
    }

    if (!isAllowedStlMimetype(file.mimetype)) {
      throw new BadRequestException('stl has an unsupported content type');
    }

    if (!isStlBuffer(file.buffer)) {
      throw new BadRequestException('stl does not contain valid STL data');
    }
  }
}

/**
 * Neutralises LIKE wildcards in a search term. Without this, a phone search of
 * `%` matches every row and `_` matches any single character — surprising for
 * the user and needlessly expensive for the database.
 */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
