import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRawOptions1721700000000 implements MigrationInterface {
  name = 'AddRawOptions1721700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Verbatim copy of the received options JSON. NOT NULL with a '' default so
    // existing rows backfill cleanly; new inserts always supply the real value.
    await queryRunner.query(
      `ALTER TABLE "orders" ADD COLUMN "rawOptions" text NOT NULL DEFAULT ''`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "rawOptions"`);
  }
}
