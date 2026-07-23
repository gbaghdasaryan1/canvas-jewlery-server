import { IsIn } from 'class-validator';
import { ORDER_STATUSES } from '../order-status';
import type { OrderStatus } from '../order-status';

export class UpdateOrderStatusDto {
  /**
   * An unknown status is a 400 from the validation pipe; a known status that is
   * illegal from the order's current state is a 409 from the service.
   */
  @IsIn(ORDER_STATUSES)
  status: OrderStatus;
}
