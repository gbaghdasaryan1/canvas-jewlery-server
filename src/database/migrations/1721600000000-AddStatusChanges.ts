import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStatusChanges1721600000000 implements MigrationInterface {
  name = 'AddStatusChanges1721600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "status_changes" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "orderId" uuid NOT NULL,
        "fromStatus" character varying(32),
        "toStatus" character varying(32) NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_status_changes" PRIMARY KEY ("id"),
        CONSTRAINT "FK_status_changes_order" FOREIGN KEY ("orderId")
          REFERENCES "orders" ("id") ON DELETE CASCADE
      )
    `);

    // The detail page reads one order's history in chronological order.
    await queryRunner.query(
      `CREATE INDEX "IDX_status_changes_order_created" ON "status_changes" ("orderId", "createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_status_changes_order_created"`);
    await queryRunner.query(`DROP TABLE "status_changes"`);
  }
}
