import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * One translated string: the `value` for a dot-path `key` (e.g. "hero.title.l1",
 * array elements as "promos.0") in a given `localeCode`. The client fetches every
 * row, un-flattens the keys back into the nested dictionary shape it renders, and
 * the admin edits rows one value at a time. Interpolation is expressed as
 * `{name}` placeholders inside `value`, filled in on the client.
 */
@Entity('translations')
@Index('UQ_translations_locale_key', ['localeCode', 'key'], { unique: true })
export class Translation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 5 })
  localeCode: string;

  @Index('IDX_translations_key')
  @Column({ type: 'varchar', length: 255 })
  key: string;

  @Column({ type: 'text' })
  value: string;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
