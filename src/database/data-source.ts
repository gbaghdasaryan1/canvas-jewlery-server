import 'reflect-metadata';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import { buildDbConnectionOptions } from '../config/database.config';

config();

/**
 * Used by the TypeORM CLI for migrations. Connection settings come from the same
 * helper the running app uses (app.module.ts), so the two never drift. Works
 * both under ts-node (dev: `${__dirname}` is src/database) and compiled
 * (prod on Heroku: `${__dirname}` is dist/database) via the `.ts,.js` globs.
 */
export default new DataSource({
  ...buildDbConnectionOptions(),
  entities: [`${__dirname}/../**/*.entity{.ts,.js}`],
  migrations: [`${__dirname}/migrations/*{.ts,.js}`],
  synchronize: false,
});
