import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderBarcode1721800000000 implements MigrationInterface {
  name = 'AddOrderBarcode1721800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Nullable first so the column can be backfilled before the NOT NULL/unique
    // constraints are applied.
    await queryRunner.query(
      `ALTER TABLE "orders" ADD COLUMN "barcode" char(7)`,
    );

    // Backfill any existing rows with sequential, unique 7-digit values
    // (0000001, 0000002, ...). New rows get random barcodes from the app.
    await queryRunner.query(`
      UPDATE "orders" o
      SET "barcode" = lpad(sub.rn::text, 7, '0')
      FROM (
        SELECT ctid, row_number() OVER (ORDER BY "createdAt") AS rn
        FROM "orders"
      ) sub
      WHERE o.ctid = sub.ctid
    `);

    await queryRunner.query(
      `ALTER TABLE "orders" ALTER COLUMN "barcode" SET NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_orders_barcode" ON "orders" ("barcode")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_orders_barcode"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "barcode"`);
  }
}
