import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit configuration: `bun run db:generate` diffs ./src/db/schema
 * against ./drizzle/meta and writes a new SQL migration. Migrations are
 * applied at boot by `runMigrations` (src/db/index.ts); drizzle-kit never
 * touches a live database here.
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  strict: true,
  verbose: true,
});
