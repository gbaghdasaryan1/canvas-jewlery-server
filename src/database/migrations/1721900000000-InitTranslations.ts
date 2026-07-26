import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitTranslations1721900000000 implements MigrationInterface {
  name = 'InitTranslations1721900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "locales" (
        "code" character varying(5) NOT NULL,
        "label" character varying(16) NOT NULL,
        "nativeName" character varying(64) NOT NULL,
        "sortOrder" integer NOT NULL DEFAULT 0,
        "enabled" boolean NOT NULL DEFAULT true,
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_locales" PRIMARY KEY ("code")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "translations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "localeCode" character varying(5) NOT NULL,
        "key" character varying(255) NOT NULL,
        "value" text NOT NULL,
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_translations" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_translations_locale_key" ON "translations" ("localeCode", "key")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_translations_key" ON "translations" ("key")`,
    );

    // Seed the three shipping languages so the switcher order/labels match the
    // client's current LANGS / LANG_LABELS. Translation values are loaded by the
    // seed script (npm run seed:translations), not here.
    await queryRunner.query(`
      INSERT INTO "locales" ("code", "label", "nativeName", "sortOrder") VALUES
        ('hy', 'ՀԱՅ', 'Հայերեն', 0),
        ('ru', 'РУС', 'Русский', 1),
        ('en', 'ENG', 'English', 2)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_translations_key"`);
    await queryRunner.query(`DROP INDEX "UQ_translations_locale_key"`);
    await queryRunner.query(`DROP TABLE "translations"`);
    await queryRunner.query(`DROP TABLE "locales"`);
  }
}
