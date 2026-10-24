import { lifecycles, visibilities } from "@bobs-sink/protocol";
import { blob, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { apps } from "./apps.js";
import { identities } from "./identities.js";

export const documents = sqliteTable(
	"documents",
	{
		id: text("id").primaryKey(),
		appId: text("app_id")
			.notNull()
			.references(() => apps.id),
		ownerId: text("owner_id")
			.notNull()
			.references(() => identities.id, { onDelete: "cascade" }),
		visibility: text("visibility", { enum: visibilities }).notNull(),
		lifecycle: text("lifecycle", { enum: lifecycles }).notNull(),
		epoch: integer("epoch").notNull(),
		/** Y.encodeStateAsUpdate at the last compaction. */
		snapshot: blob("snapshot", { mode: "buffer" }).notNull(),
		/** Highest operation seq folded into the snapshot. */
		snapshotSeq: integer("snapshot_seq").notNull(),
		/** Size of the encoded document at the last compaction, for storage accounting. */
		sizeBytes: integer("size_bytes").notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
		lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }).notNull(),
	},
	(table) => [
		index("documents_owner_idx").on(table.ownerId),
		index("documents_app_idx").on(table.appId),
		index("documents_lifecycle_used_idx").on(table.lifecycle, table.lastUsedAt),
	],
);
