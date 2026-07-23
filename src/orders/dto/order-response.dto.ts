import { Order } from '../entities/order.entity';
import { OrderOptionsDto } from './order-options.dto';
import { StatusChange } from '../entities/status-change.entity';

/**
 * The wire shape of an order. Built by explicit field mapping rather than by
 * serialising the entity, so a column added to `orders` later cannot leak by
 * default — notably `stlPath`, which is an absolute server filesystem path and
 * must never reach a client.
 */
export class OrderResponseDto {
  id: string;
  barcode: string;
  phone: string;
  status: string;
  options: OrderOptionsDto;
  stlOriginalName: string;
  stlSizeBytes: number;
  createdAt: Date;

  static fromEntity(order: Order): OrderResponseDto {
    return {
      id: order.id,
      barcode: order.barcode,
      phone: order.phone,
      status: order.status,
      options: order.options,
      stlOriginalName: order.stlOriginalName,
      stlSizeBytes: order.stlSizeBytes,
      createdAt: order.createdAt,
    };
  }
}

export class StatusChangeResponseDto {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  createdAt: Date;

  static fromEntity(change: StatusChange): StatusChangeResponseDto {
    return {
      id: change.id,
      fromStatus: change.fromStatus,
      toStatus: change.toStatus,
      createdAt: change.createdAt,
    };
  }
}

/** Detail view: the order plus its audit trail, newest change last. */
export class OrderDetailResponseDto extends OrderResponseDto {
  statusChanges: StatusChangeResponseDto[];

  /**
   * Short-lived presigned S3 URL for viewing the order's STL inline (e.g. an
   * admin 3D preview). Expires after {@link stlUrlExpiresInSec}; re-fetch the
   * order to get a fresh one. The dedicated `GET /:id/stl` endpoint remains the
   * authoritative forced-download link.
   */
  stlUrl: string;
  stlUrlExpiresInSec: number;

  static fromEntityWithHistory(
    order: Order,
    changes: StatusChange[],
    stl: { url: string; expiresInSec: number },
  ): OrderDetailResponseDto {
    return {
      ...OrderResponseDto.fromEntity(order),
      statusChanges: changes.map((change) =>
        StatusChangeResponseDto.fromEntity(change),
      ),
      stlUrl: stl.url,
      stlUrlExpiresInSec: stl.expiresInSec,
    };
  }
}

export class PaginatedOrdersDto {
  items: OrderResponseDto[];
  total: number;
  limit: number;
  offset: number;
}
