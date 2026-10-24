import { blob, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { documents } from "./documents.js";

/**
 * The server's final state for each ended epoch, as an encoded Y.Snapshot (state vector and delete set), so
 * stale clients can find exactly their unsynced edits and deletions.
 */
export const epochArchives = sqliteTable(
	"epoch_archives",
	{
		documentId: text("document_id")
			.notNull()
			.references(() => documents.id, { onDelete: "cascade" }),
		epoch: integer("epoch").notNull(),
		finalSnapshot: blob("final_snapshot", { mode: "buffer" }).notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.documentId, table.epoch] }),
		index("epoch_archives_created_idx").on(table.createdAt),
	],
);
