import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { Database } from "./connection.js";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

export function migrateDatabase(db: Database): void {
	migrate(db, { migrationsFolder });
}
