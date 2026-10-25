import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Signed-in operators of the console. Only a hash of each session token is stored. */
export const operatorSessions = sqliteTable(
	"operator_sessions",
	{
		/** SHA-256 of the session token, base64url. */
		tokenHash: text("token_hash").primaryKey(),
		email: text("email").notNull(),
		/** The bobs-server account the email belongs to. */
		subject: text("subject").notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
	},
	(table) => [index("operator_sessions_expires_idx").on(table.expiresAt)],
);
