import { eq } from "drizzle-orm";
import type { Executor } from "../db/connection.js";
import { passkeys } from "../db/schema/index.js";

export type Passkey = typeof passkeys.$inferSelect;

export class PasskeyRepository {
	constructor(private readonly db: Executor) {}

	create(passkey: Passkey): void {
		this.db.insert(passkeys).values(passkey).run();
	}

	find(credentialId: string): Passkey | undefined {
		return this.db.select().from(passkeys).where(eq(passkeys.id, credentialId)).get();
	}

	recordUse(credentialId: string, usage: { counter: number; backedUp: boolean; at: Date }): void {
		this.db
			.update(passkeys)
			.set({ counter: usage.counter, backedUp: usage.backedUp, lastUsedAt: usage.at })
			.where(eq(passkeys.id, credentialId))
			.run();
	}
}
