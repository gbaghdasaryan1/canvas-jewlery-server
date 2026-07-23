import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { ORDER_STATUSES } from '../order-status';
import type { OrderStatus } from '../order-status';

export const ORDER_SORTS = ['createdAt:desc', 'createdAt:asc'] as const;
export type OrderSort = (typeof ORDER_SORTS)[number];

export class ListOrdersQueryDto {
  /**
   * Not `@Max(200)`: the documented behaviour is that the server caps an
   * oversized limit rather than rejecting the request, so the ceiling is
   * applied in the service.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @IsIn(ORDER_STATUSES)
  status?: OrderStatus;

  /** Partial, case-insensitive match against `orders.phone`. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsIn(ORDER_SORTS)
  sort?: OrderSort;
}
