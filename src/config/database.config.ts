/**
 * Builds the Postgres connection fields shared by the running app
 * (app.module.ts) and the TypeORM CLI data source (data-source.ts), so the two
 * never drift.
 *
 * Two connection styles are supported:
 *  - `DATABASE_URL` (a single `postgres://…` string) — how Heroku Postgres and
 *    most managed providers expose credentials. SSL is enabled automatically.
 *  - individual `DB_HOST`/`DB_PORT`/`DB_USERNAME`/`DB_PASSWORD`/`DB_DATABASE`
 *    (local/dev). SSL only if `DB_SSL=true`.
 */
export interface DbConnectionOptions {
  type: 'postgres';
  url?: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  database?: string;
  ssl?: false | { rejectUnauthorized: boolean };
}

export function buildDbConnectionOptions(
  env: NodeJS.ProcessEnv = process.env,
): DbConnectionOptions {
  const url = env.DATABASE_URL?.trim();
  // Managed Postgres (Heroku, RDS, etc.) terminates TLS with certs Node doesn't
  // trust by default, so `rejectUnauthorized: false` is the pragmatic setting.
  const ssl =
    url || env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false;

  if (url) {
    return { type: 'postgres', url, ssl };
  }

  return {
    type: 'postgres',
    host: env.DB_HOST ?? 'localhost',
    port: Number(env.DB_PORT ?? 5432),
    username: env.DB_USERNAME ?? 'postgres',
    password: env.DB_PASSWORD,
    database: env.DB_DATABASE ?? 'canvas_jewelry',
    ssl,
  };
}
