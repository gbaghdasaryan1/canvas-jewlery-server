import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/** Filters for the admin key×locale listing. */
export class ListTranslationsQueryDto {
  /** Case-insensitive substring match on the key or any locale's value. */
  @IsString()
  @IsOptional()
  @MaxLength(255)
  search?: string;

  /** When true, only keys missing a value for at least one enabled locale. */
  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  missing?: boolean;
}
