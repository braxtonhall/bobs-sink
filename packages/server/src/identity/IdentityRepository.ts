import { eq } from "drizzle-orm";
import type { Executor } from "../db/connection.js";
import { identities } from "../db/schema/index.js";

export type Identity = typeof identities.$inferSelect;

export class IdentityRepository {
	constructor(private readonly db: Executor) {}

	create(identity: Identity): void {
		this.db.insert(identities).values(identity).run();
	}

	find(id: string): Identity | undefined {
		return this.db.select().from(identities).where(eq(identities.id, id)).get();
	}
}
