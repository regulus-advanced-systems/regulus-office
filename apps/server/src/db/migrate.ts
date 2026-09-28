/**
 * `bun run db:migrate`: apply pending migrations to the office database
 * without starting the server. Honours OFFICE_DATA_DIR (default ./data) or an
 * explicit OFFICE_DB_PATH.
 */
import { closeDatabase, databasePathFor, openDatabase, runMigrations } from "./index.ts";

const path = process.env.OFFICE_DB_PATH ?? databasePathFor(process.env.OFFICE_DATA_DIR ?? "data");
const db = openDatabase({ path });
try {
  runMigrations(db);
  console.log(`migrations applied: ${path}`);
} finally {
  closeDatabase(db);
}
