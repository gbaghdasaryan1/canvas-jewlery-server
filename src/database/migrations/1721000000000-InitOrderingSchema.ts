import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitOrderingSchema1721000000000 implements MigrationInterface {
  name = 'InitOrderingSchema1721000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // gen_random_uuid() is core in PG 13+; pgcrypto covers older servers.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.query(`
      CREATE TABLE "otps" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "phone" character varying(20) NOT NULL,
        "codeHash" character varying(64) NOT NULL,
        "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "attempts" integer NOT NULL DEFAULT 0,
        "consumedAt" TIMESTAMP WITH TIME ZONE,
        "requestIp" character varying(45),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_otps" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_otps_phone_created" ON "otps" ("phone", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_otps_ip_created" ON "otps" ("requestIp", "createdAt")`,
    );

    await queryRunner.query(`
      CREATE TABLE "verification_tokens" (
        "id" uuid NOT NULL,
        "phone" character varying(20) NOT NULL,
        "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "consumedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_verification_tokens" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_verification_tokens_phone" ON "verification_tokens" ("phone")`,
    );

    await queryRunner.query(`
      CREATE TABLE "orders" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "phone" character varying(20) NOT NULL,
        "status" character varying(32) NOT NULL DEFAULT 'received',
        "options" jsonb NOT NULL,
        "stlPath" character varying(512) NOT NULL,
        "stlOriginalName" character varying(255) NOT NULL,
        "stlSizeBytes" integer NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_orders" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_orders_phone" ON "orders" ("phone")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_orders_created" ON "orders" ("createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_orders_created"`);
    await queryRunner.query(`DROP INDEX "IDX_orders_phone"`);
    await queryRunner.query(`DROP TABLE "orders"`);
    await queryRunner.query(`DROP INDEX "IDX_verification_tokens_phone"`);
    await queryRunner.query(`DROP TABLE "verification_tokens"`);
    await queryRunner.query(`DROP INDEX "IDX_otps_ip_created"`);
    await queryRunner.query(`DROP INDEX "IDX_otps_phone_created"`);
    await queryRunner.query(`DROP TABLE "otps"`);
  }
}
