import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsDefined,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export const PRODUCTS = ['mountains', 'skyline', 'pendant'] as const;
export type Product = (typeof PRODUCTS)[number];

export const JEWELRY_TYPES = ['pendant', 'ring', 'bracelet'] as const;
export type JewelryType = (typeof JEWELRY_TYPES)[number];

export const SHAPES = ['rectangle', 'heart', 'circle'] as const;
export type Shape = (typeof SHAPES)[number];

export const METALS = ['gold', 'silver', 'platinum'] as const;
export type Metal = (typeof METALS)[number];

export const ENGRAVING_MAX_LENGTH = 40;

/** Defensive ceiling on smoothing passes; the contract only mandates integer >= 0. */
export const SMOOTH_MAX_PASSES = 100;

export class PlaceDto {
  @IsString()
  @MaxLength(200)
  name: string;

  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  lng: number;
}

export class OverlaysDto {
  @IsBoolean()
  buildings: boolean;

  @IsBoolean()
  streets: boolean;
}

/**
 * Client-side price preview. Persisted for support/debugging only — never read
 * back for billing. Real pricing is recomputed server-side at fulfilment.
 */
export class EstimateDto {
  @IsNumber()
  @Min(0)
  amd: number;

  @IsNumber()
  @Min(0)
  grams: number;
}

export class OrderOptionsDto {
  @IsIn(PRODUCTS)
  product: Product;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => PlaceDto)
  place: PlaceDto;

  @IsIn(JEWELRY_TYPES)
  jewelryType: JewelryType;

  @IsIn(SHAPES)
  shape: Shape;

  @IsIn(METALS)
  metal: Metal;

  @IsNumber()
  @Min(0)
  @Max(1000)
  width: number;

  @IsNumber()
  @Min(0)
  @Max(1000)
  relief: number;

  @IsNumber()
  @Min(0)
  @Max(1000)
  thickness: number;

  @IsNumber()
  @Min(0)
  @Max(10_000)
  areaKm: number;

  @IsInt()
  @Min(0)
  @Max(SMOOTH_MAX_PASSES)
  smooth: number;

  @IsNumber()
  @Min(-10_000)
  @Max(10_000)
  hangPlace: number;

  @IsNumber()
  @Min(0)
  @Max(1000)
  hangSize: number;

  @IsNumber()
  @Min(-360)
  @Max(360)
  hangRotation: number;

  @IsBoolean()
  hangHorizontal: boolean;

  @IsNumber()
  @Min(-360)
  @Max(360)
  ringRotation: number;

  // Trimmed when present; empty allowed; an absent value is defaulted to "" in
  // the service (class-transformer does not run @Transform for a missing key).
  // A present non-string is left intact so @IsString rejects it.
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(ENGRAVING_MAX_LENGTH)
  engraving: string;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => OverlaysDto)
  overlays: OverlaysDto;

  // Explicitly nullable — the client sends null before an estimate is computed.
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => EstimateDto)
  estimate: EstimateDto | null;
}
