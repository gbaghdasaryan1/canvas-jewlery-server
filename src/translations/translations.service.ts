import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateKeyDto } from './dto/create-key.dto';
import { ListTranslationsQueryDto } from './dto/list-translations-query.dto';
import {
  MAX_VALUE_LENGTH,
  UpsertTranslationDto,
} from './dto/upsert-translation.dto';
import { Locale } from './entities/locale.entity';
import { Translation } from './entities/translation.entity';

export interface LocaleView {
  code: string;
  label: string;
  nativeName: string;
  sortOrder: number;
}

/** What the client fetches once and un-flattens into its nested dictionaries. */
export interface PublicBundle {
  /** Epoch ms of the newest change — lets the client cache and skip re-parsing. */
  version: number;
  locales: LocaleView[];
  resources: Record<string, Record<string, string>>;
}

export interface AdminKeyRow {
  key: string;
  values: Record<string, string>;
}

export interface AdminListResult {
  locales: LocaleView[];
  keys: AdminKeyRow[];
}

@Injectable()
export class TranslationsService {
  constructor(
    @InjectRepository(Translation)
    private readonly translations: Repository<Translation>,
    @InjectRepository(Locale)
    private readonly locales: Repository<Locale>,
  ) {}

  async getPublicBundle(): Promise<PublicBundle> {
    const [locales, rows] = await Promise.all([
      this.enabledLocales(),
      this.translations.find(),
    ]);

    const enabledCodes = new Set(locales.map((l) => l.code));
    const resources: Record<string, Record<string, string>> = {};
    for (const locale of locales) resources[locale.code] = {};

    let version = 0;
    for (const row of rows) {
      const updated = row.updatedAt?.getTime() ?? 0;
      if (updated > version) version = updated;
      // Skip rows for a locale that has been disabled — the client never asked
      // for it, and including it would break the un-flatten shape check.
      if (enabledCodes.has(row.localeCode)) {
        resources[row.localeCode][row.key] = row.value;
      }
    }

    return { version, locales: locales.map(toLocaleView), resources };
  }

  async listForAdmin(query: ListTranslationsQueryDto): Promise<AdminListResult> {
    const [locales, rows] = await Promise.all([
      this.enabledLocales(),
      this.translations.find(),
    ]);
    const localeCodes = locales.map((l) => l.code);

    const byKey = new Map<string, Record<string, string>>();
    for (const row of rows) {
      let values = byKey.get(row.key);
      if (!values) {
        values = {};
        byKey.set(row.key, values);
      }
      values[row.localeCode] = row.value;
    }

    const search = query.search?.trim().toLowerCase();
    let keys: AdminKeyRow[] = [...byKey.entries()].map(([key, values]) => ({
      key,
      values,
    }));

    if (query.missing) {
      keys = keys.filter((row) =>
        localeCodes.some((code) => (row.values[code] ?? '') === ''),
      );
    }

    if (search) {
      keys = keys.filter(
        (row) =>
          row.key.toLowerCase().includes(search) ||
          Object.values(row.values).some((v) =>
            v.toLowerCase().includes(search),
          ),
      );
    }

    keys.sort((a, b) => compareKeys(a.key, b.key));

    return { locales: locales.map(toLocaleView), keys };
  }

  async upsertValue(dto: UpsertTranslationDto): Promise<Translation> {
    await this.assertLocaleExists(dto.locale);

    let row = await this.translations.findOne({
      where: { localeCode: dto.locale, key: dto.key },
    });
    if (row) {
      row.value = dto.value;
    } else {
      row = this.translations.create({
        localeCode: dto.locale,
        key: dto.key,
        value: dto.value,
      });
    }
    // save() bumps @UpdateDateColumn, which drives the public bundle `version`.
    return this.translations.save(row);
  }

  async createKey(dto: CreateKeyDto): Promise<AdminKeyRow> {
    const entries = Object.entries(dto.values);
    // `values` is a free-form map, so the global DTO pipe can't vet its members.
    // Reject non-string or oversized values before touching the DB.
    for (const [locale, value] of entries) {
      if (typeof value !== 'string' || value.length > MAX_VALUE_LENGTH) {
        throw new BadRequestException(
          `Value for "${locale}" must be a string of at most ${MAX_VALUE_LENGTH} characters`,
        );
      }
    }
    for (const [locale] of entries) await this.assertLocaleExists(locale);

    for (const [locale, value] of entries) {
      await this.upsertValue({ locale, key: dto.key, value });
    }

    const rows = await this.translations.find({ where: { key: dto.key } });
    const values: Record<string, string> = {};
    for (const row of rows) values[row.localeCode] = row.value;
    return { key: dto.key, values };
  }

  async deleteKey(key: string): Promise<{ deleted: number }> {
    const trimmed = key?.trim();
    if (!trimmed) throw new BadRequestException('key is required');
    const result = await this.translations.delete({ key: trimmed });
    return { deleted: result.affected ?? 0 };
  }

  async listLocales(): Promise<LocaleView[]> {
    const locales = await this.enabledLocales();
    return locales.map(toLocaleView);
  }

  private enabledLocales(): Promise<Locale[]> {
    return this.locales.find({
      where: { enabled: true },
      order: { sortOrder: 'ASC' },
    });
  }

  private async assertLocaleExists(code: string): Promise<void> {
    const exists = await this.locales.exists({ where: { code } });
    if (!exists) throw new NotFoundException(`Unknown locale "${code}"`);
  }
}

function toLocaleView(locale: Locale): LocaleView {
  return {
    code: locale.code,
    label: locale.label,
    nativeName: locale.nativeName,
    sortOrder: locale.sortOrder,
  };
}

/**
 * Natural ordering for dot-path keys so array elements read 0,1,2,…,10 rather
 * than the lexical 0,1,10,2. Numeric segments compare numerically; everything
 * else compares as text.
 */
function compareKeys(a: string, b: string): number {
  const as = a.split('.');
  const bs = b.split('.');
  const len = Math.min(as.length, bs.length);
  for (let i = 0; i < len; i++) {
    const an = Number(as[i]);
    const bn = Number(bs[i]);
    const bothNumeric = !Number.isNaN(an) && !Number.isNaN(bn);
    const cmp = bothNumeric ? an - bn : as[i].localeCompare(bs[i]);
    if (cmp !== 0) return cmp;
  }
  return as.length - bs.length;
}
