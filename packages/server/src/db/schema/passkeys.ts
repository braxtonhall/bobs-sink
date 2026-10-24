import { blob, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { identities } from "./identities.js";

export const passkeys = sqliteTable(
	"passkeys",
	{
		/** WebAuthn credential ID, base64url. */
		id: text("id").primaryKey(),
		identityId: text("identity_id")
			.notNull()
			.references(() => identities.id, { onDelete: "cascade" }),
		/** COSE-encoded public key. */
		publicKey: blob("public_key", { mode: "buffer" }).notNull(),
		counter: integer("counter").notNull(),
		transports: text("transports", { mode: "json" }).$type<string[]>(),
		backedUp: integer("backed_up", { mode: "boolean" }).notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
		lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }).notNull(),
	},
	(table) => [index("passkeys_identity_idx").on(table.identityId)],
);
