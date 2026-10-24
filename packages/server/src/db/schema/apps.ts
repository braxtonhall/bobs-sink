import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Every RP ID the service has seen. Policies live in the apps file, not here. */
export const apps = sqliteTable("apps", {
	id: text("id").primaryKey(),
	createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});
