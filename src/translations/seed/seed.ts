import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import dataSource from '../../database/data-source';
import { Locale } from '../entities/locale.entity';
import { Translation } from '../entities/translation.entity';

/**
 * Seeds (or re-seeds) the translation tables from the flat JSON bundles in this
 * folder — the canonical strings exported from the client dictionaries by
 * `scripts/flatten-dictionaries.mjs` in the canvas-jewlery repo. Idempotent:
 * every row is upserted on (localeCode, key), so running it again only
 * overwrites values, never duplicates.
 *
 * Run:  npm run seed:translations
 */

interface SeedLocale {
  code: string;
  label: string;
  nativeName: string;
  sortOrder: number;
}

const LOCALES: SeedLocale[] = [
  { code: 'hy', label: 'ՀԱՅ', nativeName: 'Հայերեն', sortOrder: 0 },
  { code: 'ru', label: 'РУС', nativeName: 'Русский', sortOrder: 1 },
  { code: 'en', label: 'ENG', nativeName: 'English', sortOrder: 2 },
];

function readBundle(code: string): Record<string, string> {
  const path = join(__dirname, `${code}.json`);
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
}

async function main(): Promise<void> {
  const ds = await dataSource.initialize();
  const localeRepo = ds.getRepository(Locale);
  const translationRepo = ds.getRepository(Translation);

  await localeRepo.upsert(LOCALES, ['code']);

  let total = 0;
  for (const locale of LOCALES) {
    const bundle = readBundle(locale.code);
    const rows = Object.entries(bundle).map(([key, value]) => ({
      localeCode: locale.code,
      key,
      value,
    }));
    // Chunk to stay well under Postgres' bound-parameter ceiling.
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      await translationRepo.upsert(chunk, ['localeCode', 'key']);
    }
    total += rows.length;
    console.log(`  ${locale.code}: ${rows.length} keys`);
  }

  await ds.destroy();
  console.log(`Seeded ${total} translation rows across ${LOCALES.length} locales.`);
}

main().catch((err) => {
  console.error('Translation seed failed:', err);
  process.exit(1);
});
