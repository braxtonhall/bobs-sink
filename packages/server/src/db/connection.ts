import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type { RunResult } from "better-sqlite3";
import * as schema from "./schema/index.js";

export type Database = ReturnType<typeof openDatabase>;

/** The database itself or a transaction on it; repositories accept either. */
export type Executor = BaseSQLiteDatabase<"sync", RunResult, typeof schema>;

/** Opens a SQLite database. Pass ":memory:" for an in-memory database. */
export function openDatabase(path: string) {
	if (path !== ":memory:") {
		mkdirSync(dirname(path), { recursive: true });
	}
	const client = new BetterSqlite3(path);
	client.pragma("journal_mode = WAL");
	client.pragma("synchronous = NORMAL");
	client.pragma("foreign_keys = ON");
	client.pragma("busy_timeout = 5000");
	return drizzle({ client, schema });
}
