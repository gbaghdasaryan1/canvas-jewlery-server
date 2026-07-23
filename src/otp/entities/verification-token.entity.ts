import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

/**
 * Server-side record of an issued verification JWT. The JWT carries the `jti`;
 * this row is what makes it single-use — `consumedAt` is set when an order lands.
 */
@Entity('verification_tokens')
@Index(['phone'])
export class VerificationToken {
  /** Matches the `jti` claim of the issued JWT. */
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ type: 'varchar', length: 20 })
  phone: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  consumedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
