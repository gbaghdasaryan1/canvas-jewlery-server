import { IsObject, IsString, Length } from 'class-validator';

/**
 * Create a new translation key, optionally with values for one or more locales.
 * `values` maps locale code → string; locales omitted here simply have no row
 * yet and show up as "missing" in the admin. Unknown locales are rejected by the
 * service.
 */
export class CreateKeyDto {
  @IsString()
  @Length(1, 255)
  key: string;

  @IsObject()
  values: Record<string, string>;
}
