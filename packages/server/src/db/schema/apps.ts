import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { AppPolicyOverrides } from "../../apps/AppPolicy.js";

/** Every RP ID the service has seen. A row with a policy is a registered app; without one it is implicit. */
export const apps = sqliteTable("apps", {
	id: text("id").primaryKey(),
	createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
	/** The operator's overrides of the registered defaults. */
	policy: text("policy", { mode: "json" }).$type<AppPolicyOverrides>(),
	registeredAt: integer("registered_at", { mode: "timestamp_ms" }),
	updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
});
