import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { identities } from "./identities.js";

/** Ed25519 keys that a passkey has authorized to sign on an identity's behalf. */
export const deviceKeys = sqliteTable(
	"device_keys",
	{
		/** Raw 32-byte Ed25519 public key, base64url. */
		publicKey: text("public_key").primaryKey(),
		identityId: text("identity_id")
			.notNull()
			.references(() => identities.id, { onDelete: "cascade" }),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
		lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }).notNull(),
	},
	(table) => [index("device_keys_identity_idx").on(table.identityId)],
);
