import { blob, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { documents } from "./documents.js";

/** Write-ahead log of accepted Yjs updates since a document's last snapshot. */
export const operations = sqliteTable(
	"operations",
	{
		documentId: text("document_id")
			.notNull()
			.references(() => documents.id, { onDelete: "cascade" }),
		seq: integer("seq").notNull(),
		payload: blob("payload", { mode: "buffer" }).notNull(),
		deviceKey: text("device_key").notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
	},
	(table) => [primaryKey({ columns: [table.documentId, table.seq] })],
);
