import { IsString, Length, MaxLength } from 'class-validator';

/** Upper bound on a single translation value. Values ship to every visitor in
 *  the public bundle, so an unbounded `text` column is worth capping. */
export const MAX_VALUE_LENGTH = 8192;

/** Set (create or overwrite) one locale's value for one key. */
export class UpsertTranslationDto {
  @IsString()
  @Length(2, 5)
  locale: string;

  @IsString()
  @Length(1, 255)
  key: string;

  @IsString()
  @MaxLength(MAX_VALUE_LENGTH)
  value: string;
}
