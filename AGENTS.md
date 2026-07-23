# Agent Guidance

## Project

- This is a NestJS 11 backend written in TypeScript with `src/` as the source root.
- Keep features modular: place each feature's module, controller, service, entities, DTOs, and tests together under `src/`.
- Use Nest dependency injection and constructor injection; register providers and imported modules in the owning module.
- The application currently initializes PostgreSQL through `TypeOrmModule.forRootAsync()` in `src/app.module.ts`.
- `autoLoadEntities` is enabled, so an entity must be registered through `TypeOrmModule.forFeature([Entity])` in a feature module to be discovered.

## Configuration and database

- Load configuration through the global `ConfigModule` and `ConfigService`; do not hardcode credentials or commit secrets.
- Use `.env.example` as the template for local database variables. Keep real `.env` values local.
- Keep `DB_SYNCHRONIZE=false` outside disposable local development. Prefer migrations for schema changes.
- PostgreSQL must be available for the application and e2e tests that import `AppModule`; unit tests should avoid unnecessary database connections.

## Commands

- `npm run build` — compile the application.
- `npm run start:dev` — run Nest in watch mode.
- `npm run lint` — run ESLint and apply its configured fixes.
- `npm run format` — format TypeScript source and tests.
- `npm run test` — run unit tests.
- `npm run test:e2e` — run e2e tests using `test/jest-e2e.json`.
- `npm run test:cov` — run tests with coverage.

Run the smallest relevant test suite after changes, then run `npm run build` for TypeScript or module changes.

## Style and testing

- Follow the existing Prettier and ESLint configuration; preserve single quotes and trailing commas.
- Name unit tests `*.spec.ts` and e2e tests `*.e2e-spec.ts`.
- Add or update tests with behavior changes, especially for controllers, services, repositories, and database queries.
- Avoid unrelated formatting or generated-file changes.

## Useful references

- Project scripts and dependencies: [package.json](package.json)
- Existing project documentation: [README.md](README.md)
- Database environment template: [.env.example](.env.example)
- NestJS configuration: [src/app.module.ts](src/app.module.ts)
