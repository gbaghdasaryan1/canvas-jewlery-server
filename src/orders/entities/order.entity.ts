import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { OrderOptionsDto } from '../dto/order-options.dto';

export const ORDER_STATUS_RECEIVED = 'received';

@Entity('orders')
@Index(['createdAt'])
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Human-facing unique identifier: exactly 7 digits, zero-padded (so "0042317"
   * is valid). Unique-constrained at the DB; the service retries generation on
   * the rare collision. Distinct from the uuid `id`, which stays the internal PK.
   */
  @Index({ unique: true })
  @Column({ type: 'char', length: 7 })
  barcode: string;

  @Index()
  @Column({ type: 'varchar', length: 20 })
  phone: string;

  @Column({ type: 'varchar', length: 32, default: ORDER_STATUS_RECEIVED })
  status: string;

  @Column({ type: 'jsonb' })
  options: OrderOptionsDto;

  /**
   * The exact `options` JSON string as received, stored verbatim. Unknown/new
   * fields the frontend may add later are preserved here even if `options`
   * (the parsed/validated view) drops or reshapes them.
   */
  @Column({ type: 'text', default: '' })
  rawOptions: string;

  @Column({ type: 'varchar', length: 512 })
  stlPath: string;

  @Column({ type: 'varchar', length: 255 })
  stlOriginalName: string;

  @Column({ type: 'int' })
  stlSizeBytes: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
