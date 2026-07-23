import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Order } from './order.entity';

/**
 * Append-only audit trail of status movements. `fromStatus` is null only for
 * the synthetic row recording an order's initial state, if one is ever
 * backfilled — every row written by the API has both ends populated.
 */
@Entity('status_changes')
@Index(['orderId', 'createdAt'])
export class StatusChange {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  orderId: string;

  @ManyToOne(() => Order, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'orderId' })
  order: Order;

  @Column({ type: 'varchar', length: 32, nullable: true })
  fromStatus: string | null;

  @Column({ type: 'varchar', length: 32 })
  toStatus: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
