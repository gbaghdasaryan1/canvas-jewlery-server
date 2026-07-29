import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import dataSource from '../../database/data-source';
import { Locale } from '../entities/locale.entity';
import { Translation } from '../entities/translation.entity';

/**
 * Seeds the translation tables from the flat JSON bundles in this folder — the
 * canonical strings exported from the client dictionaries by
 * `scripts/flatten-dictionaries.mjs` in the canvas-jewlery repo.
 *
 * Default mode is INSERT-ONLY (`ON CONFLICT DO NOTHING`): it adds keys that
 * aren't in the DB yet and leaves existing rows untouched. This makes it safe to
 * run on every deploy (Heroku release phase) — new keys get added, but values a
 * translator edited in the admin are never clobbered. The DB is the source of
 * truth for existing keys; the dictionaries are the fallback + bootstrap.
 *
 * Set `SEED_OVERWRITE=true` to instead upsert every value (reset the DB to the
 * dictionary contents) — use this deliberately, it discards admin edits.
 *
 * Run:  npm run seed:translations         (dev, ts-node)
 *       npm run seed:translations:prod    (compiled, no ts-node — Heroku)
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
  const overwrite = process.env.SEED_OVERWRITE === 'true';
  const ds = await dataSource.initialize();
  const localeRepo = ds.getRepository(Locale);
  const translationRepo = ds.getRepository(Translation);

  // Locale metadata (labels/order) is safe to keep in sync on every run.
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
      if (overwrite) {
        await translationRepo.upsert(chunk, ['localeCode', 'key']);
      } else {
        // INSERT … ON CONFLICT (localeCode, key) DO NOTHING — preserves any
        // value edited in the admin, only fills in keys that don't exist yet.
        await translationRepo
          .createQueryBuilder()
          .insert()
          .values(chunk)
          .orIgnore()
          .execute();
      }
    }
    total += rows.length;
    console.log(`  ${locale.code}: ${rows.length} keys`);
  }

  await ds.destroy();
  console.log(
    `Seeded ${total} keys across ${LOCALES.length} locales ` +
      `(${overwrite ? 'overwrite' : 'insert-only'} mode).`,
  );
}

main().catch((err) => {
  console.error('Translation seed failed:', err);
  process.exit(1);
});
