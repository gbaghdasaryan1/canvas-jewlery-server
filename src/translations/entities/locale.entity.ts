import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * A language the client can render. `code` is the client-facing id ("hy", "ru",
 * "en") that keys the translation bundle. `label` is the short switcher caption
 * (ՀԱՅ / РУС / ENG); `nativeName` is the full endonym. `sortOrder` fixes the
 * switcher order. New languages still need a matching client `Lang` union entry,
 * so this table is managed, not free-for-all.
 */
@Entity('locales')
export class Locale {
  @PrimaryColumn({ type: 'varchar', length: 5 })
  code: string;

  @Column({ type: 'varchar', length: 16 })
  label: string;

  @Column({ type: 'varchar', length: 64 })
  nativeName: string;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
