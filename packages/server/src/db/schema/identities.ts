import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { apps } from "./apps.js";

/** A person as seen through the passkeys of one app. The ID is the passkey's userHandle. */
export const identities = sqliteTable(
	"identities",
	{
		id: text("id").primaryKey(),
		appId: text("app_id")
			.notNull()
			.references(() => apps.id),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
	},
	(table) => [index("identities_app_created_idx").on(table.appId, table.createdAt)],
);
