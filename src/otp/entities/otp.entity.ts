import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('otps')
@Index(['phone', 'createdAt'])
@Index(['requestIp', 'createdAt'])
export class Otp {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 20 })
  phone: string;

  /** HMAC-SHA256 of the code, keyed with JWT_SECRET. The plaintext is never stored. */
  @Column({ type: 'varchar', length: 64 })
  codeHash: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'timestamptz', nullable: true })
  consumedAt: Date | null;

  @Column({ type: 'varchar', length: 45, nullable: true })
  requestIp: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
